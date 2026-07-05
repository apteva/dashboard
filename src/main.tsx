import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
// Side-effect imports: each module installs a window.__apteva*
// bridge at load. Without these explicit imports, nothing in
// production references the modules' named exports, and the bundler
// tree-shakes the bridge code away — at runtime, components that
// expect window.__aptevaAppEvents / __aptevaTelemetryBus see
// undefined and fall back to opening their own EventSources, which
// hits Chrome's per-origin HTTP/1.1 cap fast.
import "./hooks/useAppEvents";
import "./hooks/useTelemetryBus";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
