// Inline chat components: the dashboard side of the
// `respond(components=…)` flow. The agent attaches a render hint to
// a chat message; the chat panel mounts the matching component below
// the message bubble. See app-sdk/manifest.go UIComponent for the
// app side.
//
// Lookup uses two pieces of state the chat panel passes in:
//   - apps[]              — installed apps, with manifest_json
//                           parsed → ui_components list
//   - resolveComponent()  — turns (app, name) into a React component
//                           by importing the sidecar's bundle
//
// Components mount inside a <Suspense> + per-component error boundary
// so one buggy component can't crash the chat. We don't sandbox via
// iframe in v1 — first-party only. Marketplace components are a v2
// concern.

import {
  Component,
  ComponentType,
  ErrorInfo,
  LazyExoticComponent,
  ReactNode,
  Suspense,
  lazy,
  useEffect,
  useState,
} from "react";
import type { ChatComponent } from "../../api";

// ─── manifest-side types ────────────────────────────────────────────

export interface UIComponentSpec {
  name: string;            // "file-card"
  entry: string;           // "/ui/FileCard.mjs"
  slots?: string[];        // ["chat.message_attachment"]
}

// We get app rows from /api/apps. The handler now exposes
// ui_components directly off the row (mirroring the existing
// ui_panels field) so we don't need to parse manifest_json
// client-side — and don't need the full manifest payload at all.
export interface InstalledAppRow {
  install_id: number;
  name: string;
  version: string;
  ui_components?: UIComponentSpec[];
}

function componentsFor(app: InstalledAppRow): UIComponentSpec[] {
  return (app.ui_components ?? []).filter((c) => c.name && c.entry);
}

// ─── Component module cache ─────────────────────────────────────────

interface NativeComponentProps {
  /** Forwarded from the agent's respond(components=) call. */
  [key: string]: unknown;
  /** Injected by the host so the component can scope its fetches/events. */
  projectId?: string;
  installId?: number;
}

const moduleCache = new Map<string, LazyExoticComponent<ComponentType<NativeComponentProps>>>();

function loadComponent(
  appName: string,
  entry: string,
  version: string,
): LazyExoticComponent<ComponentType<NativeComponentProps>> {
  const url = version
    ? `/api/apps/${appName}${entry}?v=${encodeURIComponent(version)}`
    : `/api/apps/${appName}${entry}`;
  let cached = moduleCache.get(url);
  if (cached) return cached;
  cached = lazy(async () => {
    const mod = await import(/* @vite-ignore */ url);
    const Component = (mod.default || mod.Component) as ComponentType<NativeComponentProps>;
    if (!Component) {
      throw new Error(`component ${appName}@${entry} has no default export`);
    }
    return { default: Component };
  });
  moduleCache.set(url, cached);
  return cached;
}

// ─── Public renderer ────────────────────────────────────────────────

interface ChatComponentMountProps {
  comp: ChatComponent;
  apps: InstalledAppRow[];
  projectId: string;
  /** Optional slot the component is being rendered in — checked
   *  against the manifest's slots allowlist. Defaults to
   *  chat.message_attachment which is the only slot today. */
  slot?: string;
}

/**
 * Mounts one ChatComponent. Looks up the app + component spec in the
 * installed-apps registry, resolves the module, mounts it with props
 * + projectId + installId injected. Wraps in Suspense + error
 * boundary so a missing module or render-time throw fails contained.
 */
export function ChatComponentMount({
  comp,
  apps,
  projectId,
  slot = "chat.message_attachment",
}: ChatComponentMountProps): ReactNode {
  const app = apps.find((a) => a.name === comp.app);
  if (!app) {
    return <ComponentMissing reason={`app "${comp.app}" not installed`} />;
  }
  const components = componentsFor(app);
  const spec = components.find((c) => c.name === comp.name);
  if (!spec) {
    return <ComponentMissing reason={`component "${comp.app}:${comp.name}" not declared`} />;
  }
  if (spec.slots && !spec.slots.includes(slot)) {
    return <ComponentMissing reason={`component "${comp.app}:${comp.name}" not allowed in slot "${slot}"`} />;
  }
  const Lazy = loadComponent(app.name, spec.entry, app.version);
  return (
    <ComponentBoundary appName={app.name} componentName={comp.name}>
      <Suspense fallback={<ComponentSkeleton />}>
        <Lazy
          {...(comp.props ?? {})}
          projectId={projectId}
          installId={app.install_id}
        />
      </Suspense>
    </ComponentBoundary>
  );
}

/**
 * Renders a list of ChatComponents stacked vertically with a small
 * gap. Used by the chat panel for an agent message that carries
 * multiple attachments.
 */
export function ChatComponentList({
  components,
  apps,
  projectId,
}: {
  components: ChatComponent[];
  apps: InstalledAppRow[];
  projectId: string;
}): ReactNode {
  if (!components || components.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2 max-w-full">
      {components.map((c, i) => (
        <ChatComponentMount key={i} comp={c} apps={apps} projectId={projectId} />
      ))}
    </div>
  );
}

// ─── Fallbacks ───────────────────────────────────────────────────────

function ComponentSkeleton() {
  return (
    <div className="border border-border rounded p-2 animate-pulse text-text-dim text-xs">
      Loading…
    </div>
  );
}

function ComponentMissing({ reason }: { reason: string }) {
  // We render quietly — the text part of the message still goes
  // through, so the user gets the agent's message even if a
  // particular component can't be rendered. This is the more useful
  // failure mode than a red error: the agent might have referenced
  // a stale install or a component that's been removed.
  return (
    <div className="border border-border/40 rounded p-2 text-text-dim text-xs italic">
      [component unavailable: {reason}]
    </div>
  );
}

interface BoundaryState {
  err: Error | null;
}

class ComponentBoundary extends Component<
  { appName: string; componentName: string; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { err: null };
  static getDerivedStateFromError(err: Error): BoundaryState {
    return { err };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(
      `[chat-component ${this.props.appName}:${this.props.componentName}] crashed: ${err.message}`,
      info.componentStack || "",
    );
  }
  render() {
    if (this.state.err) {
      return (
        <div className="border border-error/40 rounded p-2 text-error text-xs">
          [{this.props.appName}:{this.props.componentName}] crashed —{" "}
          <span className="text-text-dim">{this.state.err.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── React-friendly hook to fetch installed apps once ───────────────

/**
 * Lightweight "give me the list of installed apps for this project"
 * hook. The chat panel passes the result into ChatComponentList.
 * Refetches only when the project changes — installed apps don't
 * churn at component render frequency.
 */
export function useInstalledApps(projectId: string | null | undefined): InstalledAppRow[] {
  const [apps, setApps] = useState<InstalledAppRow[]>([]);
  useEffect(() => {
    if (!projectId) {
      setApps([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/apps?project_id=${encodeURIComponent(projectId)}`, {
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((rows: unknown) => {
        if (cancelled) return;
        const arr = Array.isArray(rows) ? rows : [];
        setApps(
          arr.map((r: any) => ({
            install_id: r.install_id ?? r.id ?? 0,
            name: String(r.name ?? ""),
            version: String(r.version ?? ""),
            ui_components: Array.isArray(r.ui_components) ? r.ui_components : [],
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return apps;
}
