// Vendor entrypoint for `react/jsx-runtime`. Same purpose as
// react.entry.ts — gives panels a single ESM module to import
// instead of pointing the importmap at deep node_modules paths.
//
// Why we enumerate (Fragment, jsx, jsxs) by hand instead of
// `export * from "react/jsx-runtime"`: the runtime's package entry
// is CommonJS (jsx-runtime.js → require + module.exports). Bun's
// CJS→ESM interop converts that to a default export only — `export
// *` against it picks up nothing, panels die at mount with
//   "react/jsx-runtime does not provide an export named 'jsx'".

// @ts-ignore - jsx-runtime exports default+named on the CJS module;
// TypeScript's view of "react/jsx-runtime" lists named only, so a
// default import looks wrong. The runtime ships both.
import * as JsxRuntime from "react/jsx-runtime";
export const Fragment = (JsxRuntime as any).Fragment;
export const jsx = (JsxRuntime as any).jsx;
export const jsxs = (JsxRuntime as any).jsxs;
