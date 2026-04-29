// Dynamic panel loader. Apps ship their UI as ES modules in their
// own repo (see apps/mcp/<name>/ui/<Name>Panel.tsx). The sidecar
// serves the built bundle at <entry>; the dashboard imports it at
// runtime here and mounts the default-exported component inside its
// own React tree.
//
// Why dynamic + cross-repo: the apps system promises self-contained
// apps. A panel that lives in the dashboard tree would bind app
// changes to dashboard releases — wrong direction. With dynamic
// import + an importmap (see dashboard/build.ts → vendor/), every
// panel uses the host's React copy and theme tokens without
// bundling its own.
//
// Trust model: same as iframe — app sidecars are first-party-ish
// (registry-curated, source-built). The host runs the panel as a
// real React component with no sandbox, but the platform proxy + the
// install token still gate every API call the panel makes.

import { lazy, Suspense } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

export interface NativePanelProps {
  appName: string;
  installId: number;
  projectId: string;
  instanceId?: number;
}

// Cache lazy components by URL so navigating away and back doesn't
// re-import the panel module on every mount.
const cache = new Map<string, LazyExoticComponent<ComponentType<NativePanelProps>>>();

// resolvePanelComponent returns a Suspense-wrapped React component
// for the given app's panel entry. Returns null if the entry is
// empty or doesn't look like a JS module — caller falls back to the
// iframe path.
export function resolvePanelComponent(
  appName: string,
  entry: string,
): ComponentType<NativePanelProps> | null {
  if (!entry) return null;
  if (!isModuleEntry(entry)) return null;

  const url = `/api/apps/${appName}${entry}`;
  let cached = cache.get(url);
  if (!cached) {
    cached = lazy(async () => {
      const mod = await import(/* @vite-ignore */ url);
      const Component = (mod.default || mod.Panel) as ComponentType<NativePanelProps>;
      if (!Component) {
        throw new Error(`panel ${appName}@${entry} has no default export`);
      }
      return { default: Component };
    });
    cache.set(url, cached);
  }
  const Lazy = cached;

  // Wrap the lazy component so callers don't have to remember Suspense.
  const Wrapped: ComponentType<NativePanelProps> = (props) => (
    <Suspense fallback={<div className="p-6 text-text-dim text-sm">Loading panel…</div>}>
      <Lazy {...props} />
    </Suspense>
  );
  Wrapped.displayName = `NativePanel(${appName})`;
  return Wrapped;
}

// isModuleEntry — entries pointing at JS modules (.mjs / .js) are
// loaded natively; .html stays on the iframe path. The convention is
// `entry: /ui/<Name>Panel.mjs` for native, `/ui/<Name>Panel.html`
// for iframe.
function isModuleEntry(entry: string): boolean {
  return entry.endsWith(".mjs") || entry.endsWith(".js");
}

// Back-compat wrapper kept so old callsites don't break during the
// migration. Slot is unused now (the manifest's entry decides how to
// load); the function returns the same component for any slot since
// each (app, slot) combination has its own entry in the manifest.
export function getNativePanel(
  appName: string,
  _slot: string,
): ComponentType<NativePanelProps> | null {
  // The manifest is what drives this — the dashboard fetches it via
  // /api/apps and walks ui_panels. Callers that already have the
  // panel.entry should use resolvePanelComponent directly.
  return null;
}
