import { $ } from "bun";
import { rmSync, mkdirSync } from "fs";

// Step 0: Clean old builds
rmSync("./dist", { recursive: true, force: true });
mkdirSync("./dist", { recursive: true });

// Step 0.5: Code-gen the vendor entry files from React's actual
// runtime surface so we never miss an internal symbol. See
// scripts/gen-vendor-entries.ts — the generator enumerates every
// key Object.keys(require(<module>)) returns and emits a TS file
// that re-exports each as a real ESM named export. Stops the
// "does not provide an export named X" / "Cannot read properties
// of undefined" class of bug for good.
console.log("Generating vendor entry files...");
{
  const proc = Bun.spawn(["bun", "run", "./scripts/gen-vendor-entries.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error("vendor entry generation failed");
    process.exit(code);
  }
}

// Step 1: Build Tailwind CSS
console.log("Building CSS...");
await $`bunx @tailwindcss/cli -i ./src/index.css -o ./dist/style.css --minify`.quiet();

// Step 2: Bundle JS/TSX
//
// Externalize React so the host and every dynamically-imported
// panel resolve to the SAME React instance via the importmap.
// Without this the main bundle ships its own copy of React, the
// panel imports another copy from /vendor/react.mjs, hooks from
// the panel hit a null dispatcher in the host's render context,
// and the browser throws "Invalid hook call. … You might have
// more than one copy of React in the same app." React's hook
// system relies on a module-level dispatcher pointer — that only
// works when every component that calls a hook shares one React.
console.log("Building JS...");
const result = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  external: [
    "react",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "react-dom",
    "react-dom/client",
  ],
  // NODE_ENV=production so JSX compiles to `jsx()` from the prod
  // runtime (vendor/react-jsx-runtime.mjs exports Fragment / jsx /
  // jsxs). Without this, Bun emits `jsxDEV()` from the dev runtime
  // — which the importmap routes to the same vendor file that
  // doesn't export jsxDEV → SyntaxError on every component load.
  // Also strips React's dev-only warnings = smaller bundle.
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  naming: {
    entry: "[name]-[hash].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Step 2.5: Vendor bundles for panel importmap.
//
// Panels live in each app's repo and are loaded dynamically via
// `import(<panel.entry>)`. They reference React with bare specifiers
// (`import { useState } from "react"`) and rely on the importmap in
// index.html to resolve those to the dashboard's bundled copy.
// Without this, every panel would either bundle its own React (size +
// version skew) or break.
console.log("Building vendor (react, react/jsx-runtime) for panel importmap...");
mkdirSync("./dist/vendor", { recursive: true });
// Split into two builds so we can externalize "react" for the
// jsx-runtime and react-dom entries (they'll resolve "react" via
// the importmap → /vendor/react.mjs at runtime, sharing the one
// React instance) while NOT externalizing "react" for the entry
// that's *supposed* to BE that one React. If we used a single
// build with external: ["react", …], vendor/react.mjs would end
// up importing "react" externally and the importmap would route
// that bare specifier back to /vendor/react.mjs — a cycle.
const vendorReact = await Bun.build({
  entrypoints: ["./vendor/react.entry.ts"],
  outdir: "./dist/vendor",
  target: "browser",
  format: "esm",
  minify: true,
  splitting: false,
  naming: "[name].mjs",
  define: { "process.env.NODE_ENV": '"production"' },
  // No `external` — this entry IS the React the importmap points
  // every other consumer at, so it must contain React's source.
});
if (!vendorReact.success) {
  console.error("Vendor (react) build failed:");
  for (const log of vendorReact.logs) console.error(log);
  process.exit(1);
}

const vendor = await Bun.build({
  entrypoints: [
    "./vendor/react-jsx-runtime.entry.ts",
    "./vendor/react-dom.entry.ts",
    "./vendor/react-dom-client.entry.ts",
  ],
  outdir: "./dist/vendor",
  target: "browser",
  format: "esm",
  minify: true,
  splitting: false,
  naming: "[name].mjs",
  define: { "process.env.NODE_ENV": '"production"' },
  // jsx-runtime + react-dom both internally `require('react')` —
  // externalize so they pick up vendor/react.mjs via the importmap
  // at runtime instead of bundling their own (which would defeat
  // the whole single-instance setup).
  external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
})
if (!vendor.success) {
  console.error("Vendor build failed:");
  for (const log of vendor.logs) console.error(log);
  process.exit(1);
}

// Run after Bun's name-rewriting step (rename below) so the verifier
// imports react.mjs at its final path. Inserted later — see the
// renames block.
// Bun's `[name]` keeps the `.entry` segment — rename to clean filenames
// the importmap can address.
const { renameSync, existsSync } = await import("fs");
const renames: [string, string][] = [
  ["./dist/vendor/react.entry.mjs", "./dist/vendor/react.mjs"],
  ["./dist/vendor/react-jsx-runtime.entry.mjs", "./dist/vendor/react-jsx-runtime.mjs"],
  ["./dist/vendor/react-dom.entry.mjs", "./dist/vendor/react-dom.mjs"],
  ["./dist/vendor/react-dom-client.entry.mjs", "./dist/vendor/react-dom-client.mjs"],
];
for (const [from, to] of renames) {
  if (existsSync(from)) renameSync(from, to);
}

// Verify the built vendor/react.mjs actually exports every name the
// entry promised. Runs against the Bun runtime that produced it; a
// failure here means a typo in vendor/react.entry.ts (or a React
// API that genuinely went away) — better to fail the dashboard
// build now than ship broken panels.
{
  const verifyURL = new URL("./scripts/verify-vendor.ts", import.meta.url).pathname;
  const proc = Bun.spawn(["bun", "run", verifyURL], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error("vendor verification failed");
    process.exit(code);
  }
}

// Step 3: Generate index.html with hashed paths
const jsOutput = result.outputs.find((o) => o.path.endsWith(".js"));
const jsFile = jsOutput ? jsOutput.path.split("/").pop() : "main.js";

const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Apteva</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="preload" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=block" as="style" />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=block" rel="stylesheet" />
    <link rel="stylesheet" href="/style.css" />
    <!-- Importmap so dynamically-loaded panel modules import React from the host -->
    <script type="importmap">
      {
        "imports": {
          "react": "/vendor/react.mjs",
          "react/jsx-runtime": "/vendor/react-jsx-runtime.mjs",
          "react/jsx-dev-runtime": "/vendor/react-jsx-runtime.mjs",
          "react-dom": "/vendor/react-dom.mjs",
          "react-dom/client": "/vendor/react-dom-client.mjs"
        }
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/${jsFile}"></script>
  </body>
</html>`;

await Bun.write("./dist/index.html", html);

console.log("\nBuild complete:");
for (const output of result.outputs) {
  const size = (output.size / 1024).toFixed(1);
  console.log(`  ${output.path.split("/").pop()} (${size} KB)`);
}
console.log("  style.css");
console.log("  index.html");
