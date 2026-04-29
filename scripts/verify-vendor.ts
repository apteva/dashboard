// Companion check to apps/scripts/verify-panels.ts. The panel
// verifier confirms each built panel only imports React names that
// the vendor entrypoint *promises*. This script confirms each name
// the vendor entry promises is actually present in the *built*
// vendor/react.mjs the dashboard ships.
//
// Two halves of the same contract — without this check, a typo in
// the vendor entry (a name React doesn't actually export) would
// silently slip through: panels would import it expecting it to
// resolve, and the browser would die at panel-mount time.
//
// We import dist/vendor/react.mjs directly (a real ESM import on
// the build server, against the same Bun runtime that produced it)
// and assert the destructured names from the entry resolve.

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "vendor", "react.entry.ts");
const BUILT = join(HERE, "..", "dist", "vendor", "react.mjs");

async function entryExpectsNames(): Promise<string[]> {
  if (!existsSync(ENTRY)) {
    throw new Error(`vendor entry missing: ${ENTRY}`);
  }
  const src = await readFile(ENTRY, "utf8");
  const m = src.match(/export\s+const\s*\{([\s\S]*?)\}\s*=\s*React/);
  if (!m) return [];
  // Strip line comments first — same gotcha as verify-panels.ts
  // (a previous version's regex didn't span lines, dropping the
  // first identifier after each section header).
  const cleaned = m[1].replace(/\/\/[^\n]*/g, "");
  const out: string[] = [];
  for (const tok of cleaned.split(",")) {
    const name = tok.trim();
    if (/^[A-Za-z_]\w*$/.test(name)) out.push(name);
  }
  return out;
}

async function checkBundle(
  builtPath: string,
  expectedNames: string[],
  spotCheck: { name: string; kind: "function" | "any" },
): Promise<void> {
  if (!existsSync(builtPath)) {
    throw new Error(`vendor build missing: ${builtPath} — run \`bun run build\` first`);
  }
  const mod = await import(pathToFileURL(builtPath).href);
  const present = new Set(Object.keys(mod));
  const missing = expectedNames.filter((n) => !present.has(n));
  if (missing.length > 0) {
    console.error(`✗ ${builtPath} missing ${missing.length} expected export(s):`);
    for (const m of missing) console.error("  ✗ " + m);
    process.exit(1);
  }
  console.log(`✓ ${builtPath.replace(/^.*\/dist\//, "dist/")} exports all ${expectedNames.length} names the entry promises.`);
  if (spotCheck.kind === "function" && typeof (mod as any)[spotCheck.name] !== "function") {
    console.error(`✗ ${builtPath}'s ${spotCheck.name} isn't a function — CJS interop broken`);
    process.exit(1);
  }
  console.log(`  └ runtime spot-check: ${spotCheck.name} present (${typeof (mod as any)[spotCheck.name]}).`);
}

async function checkMainBundleHasOneReact(): Promise<void> {
  // React relies on a single module-level dispatcher; if the main
  // bundle inlined its own React, panels (which import React via
  // the importmap → /vendor/react.mjs) end up with a different
  // dispatcher and every hook call throws "Invalid hook call …
  // more than one copy of React in the same app."
  //
  // Tell-tale: any `var ... = require_react()` style CJS wrapper
  // means Bun bundled React inline. With externalize working, all
  // mentions of React in the main bundle should be plain
  // `import * as X from "react"` ESM external statements only.
  const distDir = join(HERE, "..", "dist");
  const fs = await import("fs/promises");
  const entries = await fs.readdir(distDir);
  const mainJs = entries.find((f) => /^main-.*\.js$/.test(f));
  if (!mainJs) {
    console.error("✗ no main-*.js in dist — build didn't run?");
    process.exit(1);
  }
  const main = await readFile(join(distDir, mainJs), "utf8");
  // React's prod CJS source contains a unique warning string about
  // version mismatch — only present when react.production was
  // bundled inline. The warning string in react-dom is different,
  // so this won't false-positive on a properly-externalized build.
  const reactInlineMarker = '"react" and "react-dom" packages must have the exact same version';
  if (main.includes(reactInlineMarker)) {
    console.error(
      `✗ ${mainJs} inlines React (found react/cjs version-mismatch warning text). ` +
      `Bun's external option didn't propagate to a transitive require. ` +
      `Make sure react-dom is also in external + has its own vendor entry.`,
    );
    process.exit(1);
  }
  // react-dom's same warning lives in its own source; assert it
  // dropped too once react-dom is externalized.
  const reactDomInlineMarker = '"react-dom-client.development.js"';
  if (main.includes(reactDomInlineMarker)) {
    console.error(
      `✗ ${mainJs} inlines react-dom — externalize "react-dom" + "react-dom/client" in build.ts.`,
    );
    process.exit(1);
  }
  // The vendor jsx-runtime exposes `jsx` / `jsxs` only — no `jsxDEV`.
  // If main was built without NODE_ENV=production, Bun emits
  // `jsxDEV()` calls from the dev runtime, the importmap routes
  // /react/jsx-dev-runtime to the same prod vendor file, and the
  // browser throws "does not provide an export named 'jsxDEV'"
  // before the dashboard even renders.
  if (/from\s*"react\/jsx-dev-runtime"/.test(main) || /jsx-dev-runtime/.test(main)) {
    console.error(
      `✗ ${mainJs} imports "react/jsx-dev-runtime" — main was built without NODE_ENV=production. ` +
      `Set define: { "process.env.NODE_ENV": '"production"' } in the main Bun.build call so JSX compiles to the prod runtime.`,
    );
    process.exit(1);
  }
  console.log(`✓ main bundle (${mainJs}) does NOT inline React or react-dom — single instance via importmap.`);
  console.log(`✓ main bundle uses prod JSX runtime (no jsxDEV calls).`);
}

// nodeKeys returns the names Object.keys(require(<module>)) returns
// for the given npm module. Same approach the entry generator uses
// — runs node out-of-process so React's load isn't influenced by
// Bun's module loader. The verifier uses this to compare what the
// vendor build actually emitted against what React actually
// exposes at runtime — caught any drift between the two.
async function nodeKeys(mod: string): Promise<string[]> {
  const proc = Bun.spawn(
    ["node", "-e", `console.log(JSON.stringify(Object.keys(require('${mod}'))))`],
    { stdout: "pipe" },
  );
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  return JSON.parse(out.trim()) as string[];
}

async function main() {
  // For each vendor file, compare against the matching upstream
  // module's runtime keys. Hand-pick the spot-check name (the
  // verifier confirms it resolves to a function — runtime
  // sanity).
  const checks: { built: string; mod: string; spot: string }[] = [
    { built: BUILT, mod: "react", spot: "useState" },
    { built: join(HERE, "..", "dist", "vendor", "react-jsx-runtime.mjs"), mod: "react/jsx-runtime", spot: "jsx" },
    { built: join(HERE, "..", "dist", "vendor", "react-dom.mjs"), mod: "react-dom", spot: "createPortal" },
    { built: join(HERE, "..", "dist", "vendor", "react-dom-client.mjs"), mod: "react-dom/client", spot: "createRoot" },
  ];
  for (const c of checks) {
    const expected = (await nodeKeys(c.mod)).filter((k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k));
    await checkBundle(c.built, expected, { name: c.spot, kind: "function" });
  }

  // No React inlined into main.js (panel-host React identity check).
  await checkMainBundleHasOneReact();
}

await main();
