// Vendor entrypoint that re-exports the dashboard's bundled React
// copy as a clean ESM module. Panels (loaded dynamically from app
// sidecars) resolve `import { useState } from "react"` through the
// importmap to /vendor/react.mjs (this file's build output) — so
// every panel uses the host's exact React without bundling its own.
//
// Why a re-export shim instead of pointing the importmap straight
// at node_modules: Bun.build only emits a self-contained bundle
// when given an entry it can resolve from the project graph. This
// re-export is the smallest such entry.

export * from "react";
import * as React from "react";
export default React;
