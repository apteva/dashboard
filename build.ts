import { $ } from "bun";
import { rmSync, mkdirSync } from "fs";

// Step 0: Clean old builds
rmSync("./dist", { recursive: true, force: true });
mkdirSync("./dist", { recursive: true });

// Step 1: Build Tailwind CSS
console.log("Building CSS...");
await $`bunx @tailwindcss/cli -i ./src/index.css -o ./dist/style.css --minify`.quiet();

// Step 2: Bundle JS/TSX
console.log("Building JS...");
const result = await Bun.build({
  entrypoints: ["./src/main.tsx"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "linked",
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
const vendor = await Bun.build({
  entrypoints: [
    "./vendor/react.entry.ts",
    "./vendor/react-jsx-runtime.entry.ts",
  ],
  outdir: "./dist/vendor",
  target: "browser",
  format: "esm",
  minify: true,
  splitting: false,
  naming: "[name].mjs",
});
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
          "react/jsx-dev-runtime": "/vendor/react-jsx-runtime.mjs"
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
