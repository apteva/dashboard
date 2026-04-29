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

async function main() {
  if (!existsSync(BUILT)) {
    throw new Error(`vendor build missing: ${BUILT} — run \`bun run build\` first`);
  }
  const expected = await entryExpectsNames();
  const mod = await import(pathToFileURL(BUILT).href);
  const present = new Set(Object.keys(mod));

  const missing: string[] = [];
  for (const name of expected) {
    if (!present.has(name)) missing.push(name);
  }
  if (missing.length > 0) {
    console.error(`vendor build missing ${missing.length} expected export(s):`);
    for (const m of missing) console.error("  ✗ " + m);
    process.exit(1);
  }
  console.log(`✓ vendor/react.mjs exports all ${expected.length} names the entry promises.`);

  // Spot-check the runtime API too — defaults shouldn't be undefined.
  if (typeof (mod as any).useState !== "function") {
    console.error("✗ vendor/react.mjs's useState isn't a function — CJS interop broken");
    process.exit(1);
  }
  console.log("✓ runtime spot-check: useState resolves to a function.");
}

await main();
