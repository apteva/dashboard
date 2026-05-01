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

import { Component, lazy, Suspense } from "react";
import type { ComponentType, LazyExoticComponent, ReactNode } from "react";

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

  // Wrap the lazy component in Suspense + a panel-scoped error
  // boundary. The boundary catches both module-import failures (panel
  // .mjs missing, syntax error, missing default export) and runtime
  // throws inside the panel's render tree, so a broken sidecar app
  // doesn't take down the surrounding dashboard view. The user sees
  // a small contained error card with the panel name; everything
  // around it (sidebar, header, other tabs) keeps working.
  const Wrapped: ComponentType<NativePanelProps> = (props) => (
    <PanelErrorBoundary appName={appName} entry={entry}>
      <Suspense fallback={<div className="p-6 text-text-dim text-sm">Loading panel…</div>}>
        <Lazy {...props} />
      </Suspense>
    </PanelErrorBoundary>
  );
  Wrapped.displayName = `NativePanel(${appName})`;
  return Wrapped;
}

// PanelErrorBoundary — confines a panel module's failure modes to its
// own card. React class component because hooks can't catch render
// errors. Resets when the (appName, entry) pair changes — that's how
// "uninstall + reinstall" or app-version bumps recover without a full
// page reload (the cache.delete path on the host re-issues the entry,
// which propagates as a new key here).
interface PanelErrorBoundaryProps {
  appName: string;
  entry: string;
  children: ReactNode;
}
interface PanelErrorBoundaryState {
  err: Error | null;
}
class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): PanelErrorBoundaryState {
    return { err };
  }

  componentDidUpdate(prev: PanelErrorBoundaryProps) {
    // App version bumped or operator switched between apps — clear
    // the captured error so the new module gets a fresh attempt
    // instead of staying stuck on the previous failure.
    if (prev.appName !== this.props.appName || prev.entry !== this.props.entry) {
      if (this.state.err) this.setState({ err: null });
    }
  }

  componentDidCatch(err: Error, info: { componentStack?: string }) {
    // Surface the failure once; the user-visible card carries the
    // app name + message so support can correlate.
    console.error(
      `[panel ${this.props.appName}] crashed: ${err.message}`,
      info.componentStack || "",
    );
  }

  render() {
    if (this.state.err) {
      return (
        <div className="p-4">
          <div className="rounded border border-border bg-bg-card p-4 max-w-2xl">
            <div className="text-text font-medium text-sm mb-1">
              The {this.props.appName} panel crashed.
            </div>
            <div className="text-text-dim text-xs mb-3">
              The rest of the dashboard is unaffected. See the browser console for the full stack trace.
            </div>
            <pre className="text-xs text-text-muted whitespace-pre-wrap break-words bg-bg-input rounded p-2 max-h-40 overflow-auto">
              {this.state.err.message}
            </pre>
            <button
              onClick={() => this.setState({ err: null })}
              className="mt-3 px-3 py-1 text-xs border border-border rounded hover:border-accent"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
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
