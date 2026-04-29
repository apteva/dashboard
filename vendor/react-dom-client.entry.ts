// Vendor entrypoint for `react-dom/client`. Same CJS-interop dance
// as react.entry.ts — react-dom's main entries are CommonJS and
// `export *` against them yields only a default. Enumerate the few
// surface APIs the dashboard uses (createRoot, hydrateRoot).
//
// Why react-dom needs to be a vendor module too: the dashboard's
// main bundle imports react-dom; if react-dom stays *inlined* in
// the main bundle, Bun's CJS bundler resolves react-dom's internal
// `require('react')` at build time and bakes a copy of React into
// the bundle — defeating externalize on the panel side. Pushing
// react-dom out to its own vendor module lets the importmap route
// react-dom's `import 'react'` through to /vendor/react.mjs, so
// every component shares the same React (one dispatcher).

// @ts-ignore — same as react-jsx-runtime.entry.ts; the runtime
// ships both default + named on the CJS object.
import * as ReactDOMClient from "react-dom/client";
export const createRoot = (ReactDOMClient as any).createRoot;
export const hydrateRoot = (ReactDOMClient as any).hydrateRoot;
