// Vendor entrypoint that re-exports the dashboard's bundled React
// copy as a clean ESM module. Panels (loaded dynamically from app
// sidecars) resolve `import { useState } from "react"` through the
// importmap to /vendor/react.mjs (this file's build output) — so
// every panel uses the host's exact React without bundling its own.
//
// Why we enumerate the API by hand instead of `export * from "react"`:
// React's package entry is CommonJS (index.js → require/module.exports).
// When Bun bundles CJS into ESM, the converted module exposes only a
// `default` export — `export *` against it picks up nothing, and panels
// loaded against this vendor file die with
//   "react does not provide an export named 'useCallback'".
// Listing the public API explicitly forces every named binding into
// the ESM surface. The list is stable; a React major bump is the only
// time it'd need touching.

import React from "react";
export default React;

export const {
  // Hooks (the part panels use most)
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useReducer,
  useContext,
  useLayoutEffect,
  useImperativeHandle,
  useTransition,
  useDeferredValue,
  useId,
  useSyncExternalStore,
  useDebugValue,
  useActionState,
  useOptimistic,
  useInsertionEffect,
  // Component APIs
  Component,
  PureComponent,
  Fragment,
  StrictMode,
  Profiler,
  Suspense,
  Activity,
  Children,
  // Element creation
  createElement,
  cloneElement,
  isValidElement,
  createRef,
  createContext,
  forwardRef,
  memo,
  lazy,
  // Concurrent / new APIs
  startTransition,
  use,
  cache,
  // Misc
  version,
} = React as typeof React & {
  // Some of the above (Activity, useEffectEvent, etc.) are only on
  // recent React versions; cast keeps tsc happy without forcing a
  // strict React 19+ minimum here.
  [k: string]: unknown;
};
