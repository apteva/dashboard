// Vendor entrypoint for `react-dom` (the legacy / portal surface
// — distinct from `react-dom/client` which holds createRoot +
// hydrateRoot). Tooltip libraries, dialogs, anything using
// portals imports `createPortal` from here.
//
// Same CJS-interop pattern as the other vendor entries — list the
// names by hand because Bun's CJS→ESM conversion gives only a
// default. The set below is the public react-dom API in v19.

// @ts-ignore — runtime ships both default + named on the CJS object.
import * as ReactDOM from "react-dom";

export const createPortal = (ReactDOM as any).createPortal;
export const flushSync = (ReactDOM as any).flushSync;
export const preconnect = (ReactDOM as any).preconnect;
export const prefetchDNS = (ReactDOM as any).prefetchDNS;
export const preinit = (ReactDOM as any).preinit;
export const preinitModule = (ReactDOM as any).preinitModule;
export const preload = (ReactDOM as any).preload;
export const preloadModule = (ReactDOM as any).preloadModule;
export const requestFormReset = (ReactDOM as any).requestFormReset;
export const unstable_batchedUpdates = (ReactDOM as any).unstable_batchedUpdates;
export const useFormState = (ReactDOM as any).useFormState;
export const useFormStatus = (ReactDOM as any).useFormStatus;
export const version = (ReactDOM as any).version;
