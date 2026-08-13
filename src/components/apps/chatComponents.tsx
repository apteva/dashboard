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
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AppIdentityProvider } from "@apteva/ui-kit";
import { chat, type ChatComponent, type ChatMessageRow } from "../../api";
import {
  ApprovalReviewModal,
  parseApprovalReview,
} from "../approvals/ApprovalReviewModal";
import { Modal } from "../Modal";

// ─── manifest-side types ────────────────────────────────────────────

export interface UIComponentSpec {
  name: string;            // "file-card"
  entry: string;           // "/ui/FileCard.mjs"
  slots?: string[];        // ["chat.message_attachment"]
  label?: string;
  description?: string;
  suggested?: boolean;
  visibility?: "attached" | "project";
  refresh_topics?: string[];
  default_width?: 1 | 2;
  supported_sizes?: Array<"half" | "full">;
  default_size?: "half" | "full";
  props_schema?: Record<string, unknown>;
  settings_schema?: Record<string, unknown>;
}

// We get app rows from /api/apps. The handler now exposes
// ui_components directly off the row (mirroring the existing
// ui_panels field) so we don't need to parse manifest_json
// client-side — and don't need the full manifest payload at all.
//
// `source` is "builtin" | "github" | "local" | "integration". The
// "integration" value is synthesised server-side for any project
// connection whose template declares ui_components — those rows
// load their bundles from /api/integrations/<slug>/ instead of
// /api/apps/<slug>/.
export interface InstalledAppRow {
  install_id: number;
  name: string;
  display_name?: string;
  version: string;
  icon?: string;
  icon_style?: "image" | "monochrome";
  source?: string;
  status?: string;
  surfaces?: {
    mcp_tool_names?: string[];
  };
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

interface ComponentModuleScope {
  installId?: number;
  projectId?: string;
}

export function buildChatComponentModuleURL(
  appName: string,
  entry: string,
  version: string,
  source?: string,
  scope?: ComponentModuleScope,
): string {
  // Integration components are embedded dashboard assets rather than
  // per-install sidecar modules, so install/project routing does not apply.
  const integration = source === "integration";
  const base = integration
    ? `/api/integrations/${appName}${entry}`
    : `/api/apps/${appName}${entry}`;
  const params = new URLSearchParams();
  if (version) params.set("v", version);
  if (!integration && scope?.installId) params.set("install_id", String(scope.installId));
  if (!integration && scope?.projectId) params.set("project_id", scope.projectId);
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

function loadComponent(
  appName: string,
  entry: string,
  version: string,
  source?: string,
  scope?: ComponentModuleScope,
): LazyExoticComponent<ComponentType<NativeComponentProps>> {
  // Integrations live under a different path than apps. The server
  // serves /api/integrations/<slug>/ui/<file> from the embedded
  // integrations dist tree; apps come from the per-install sidecar
  // proxy at /api/apps/<slug>/<entry>.
  const url = buildChatComponentModuleURL(appName, entry, version, source, scope);
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
  messageId?: number;
  onMessageUpdated?: (message: ChatMessageRow) => void;
  onActionComplete?: () => void;
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
  messageId,
  onMessageUpdated,
  onActionComplete,
  slot = "chat.message_attachment",
}: ChatComponentMountProps): ReactNode {
  if (comp.app === "channel-chat" && comp.name === "approval-card") {
    return (
      <ApprovalCard
        props={comp.props ?? {}}
        messageId={messageId}
        onMessageUpdated={onMessageUpdated}
        onActionComplete={onActionComplete}
      />
    );
  }
  if (comp.app === "channel-chat" && comp.name === "report-card") {
    return <ReportCard props={comp.props ?? {}} />;
  }
  if (comp.app === "channel-chat" && comp.name === "alert-card") {
    return <AlertCard props={comp.props ?? {}} />;
  }
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
  const Lazy = loadComponent(app.name, spec.entry, app.version, app.source, {
    installId: app.install_id,
    projectId,
  });
  return (
    <ComponentBoundary appName={app.name} componentName={comp.name}>
      <Suspense fallback={<ComponentSkeleton />}>
        <AppIdentityProvider
          value={{
            name: app.name,
            displayName: app.display_name || app.name,
            iconUrl: app.icon,
            iconStyle: app.icon_style,
          }}
        >
          <Lazy
            {...(comp.props ?? {})}
            projectId={projectId}
            installId={app.install_id}
          />
        </AppIdentityProvider>
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
  messageId,
  onMessageUpdated,
  onActionComplete,
}: {
  components: ChatComponent[];
  apps: InstalledAppRow[];
  projectId: string;
  messageId?: number;
  onMessageUpdated?: (message: ChatMessageRow) => void;
  onActionComplete?: () => void;
}): ReactNode {
  if (!components || components.length === 0) return null;
  return (
    <div className="mt-3 flex w-full min-w-0 max-w-full flex-col gap-2">
      {components.map((c, i) => (
        // Composite key: app + name keep components stable across
        // renders even if the array changes shape (e.g. an inserted
        // attachment shifts later items left); the index suffix
        // disambiguates two of the same component on one message.
        // Pure index-keying made React reuse DOM nodes for the wrong
        // entry whenever the array mutated mid-flight.
        <div key={`${c.app}:${c.name}:${i}`} className="chat-component-frame">
          <ChatComponentMount
            comp={c}
            apps={apps}
            projectId={projectId}
            messageId={messageId}
            onMessageUpdated={onMessageUpdated}
            onActionComplete={onActionComplete}
          />
        </div>
      ))}
    </div>
  );
}

function ApprovalCard({
  props,
  messageId,
  onMessageUpdated,
  onActionComplete,
}: {
  props: Record<string, unknown>;
  messageId?: number;
  onMessageUpdated?: (message: ChatMessageRow) => void;
  onActionComplete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = Number(props.message_id || messageId || 0);
  const approval = useMemo(() => parseApprovalReview(props), [props]);
  const statusLabel = approval.status === "approved"
    ? "Approved"
    : approval.status === "denied"
      ? "Denied"
      : approval.status === "acted"
        ? "Completed"
        : "Pending";

  return (
    <>
      <div className="w-full max-w-2xl rounded-xl border border-accent/35 bg-bg-card/90 p-3 sm:p-4">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-accent font-bold">
              Approval
            </div>
            <h3 className="text-sm text-text font-bold mt-0.5 break-words">{approval.title}</h3>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide border ${
              approval.status === "pending"
                ? "border-yellow/40 text-yellow bg-yellow/10"
                : approval.status === "approved"
                  ? "border-green/40 text-green bg-green/10"
                  : approval.status === "denied"
                    ? "border-red/40 text-red bg-red/10"
                    : "border-text-muted/40 text-text-muted bg-bg-subtle"
            }`}
          >
            {statusLabel}
          </span>
        </div>
        {approval.body && (
          <p className="mt-3 line-clamp-2 text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
            {approval.body}
          </p>
        )}
        <button
          type="button"
          disabled={!id}
          onClick={() => setOpen(true)}
          className="touch-target mt-3 inline-flex items-center rounded-lg border border-accent/30 px-3 text-xs font-bold text-accent hover:bg-accent/10 hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {approval.status === "pending" ? "Review" : "View decision"}
        </button>
      </div>

      <ApprovalReviewModal
        open={open}
        approval={approval}
        onClose={() => setOpen(false)}
        onAction={async (actionId, note) => {
          if (!id) throw new Error("Approval message is unavailable.");
          const res = await chat.messageAction(id, actionId, note);
          onMessageUpdated?.(res.message);
          onActionComplete?.();
        }}
      />
    </>
  );
}

function ReportCard({ props }: { props: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const title = String(props.title || "Report");
  const summary = String(props.summary || "");
  const period = String(props.period || "");
  const rawSections = Array.isArray(props.sections) ? props.sections : [];
  const sections = rawSections
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const sectionTitle = String(obj.title || "").trim();
      const body = String(obj.body || "").trim();
      if (!sectionTitle && !body) return null;
      return { title: sectionTitle, body };
    })
    .filter(Boolean) as Array<{ title: string; body: string }>;
  const tags = (Array.isArray(props.tags) ? props.tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);

  return (
    <>
      <div className="w-full max-w-2xl rounded-xl border border-accent/25 bg-bg-card/90 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-accent font-bold">Report</div>
            <h3 className="text-sm text-text font-bold mt-0.5 break-words">{title}</h3>
            {period && <div className="mt-1 text-[11px] text-text-dim">{period}</div>}
          </div>
        </div>
        {summary && (
          <p className="mt-3 text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
            {summary}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="touch-target mt-3 inline-flex items-center rounded-lg border border-accent/30 px-3 text-xs font-bold text-accent hover:bg-accent/10 hover:text-accent-hover"
        >
          Open report
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} width="max-w-3xl">
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-border flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-accent font-bold">Report</div>
            <h2 className="mt-1 text-lg font-bold text-text break-words">{title}</h2>
            {period && <div className="mt-1 text-xs text-text-dim">{period}</div>}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="touch-target shrink-0 inline-flex h-11 items-center text-text-muted hover:text-text border border-border rounded-lg px-3 text-xs"
          >
            Close
          </button>
        </div>
        <div className="page-safe-bottom overflow-auto px-4 py-4 sm:px-5 space-y-5">
          {summary && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-text-dim mb-1">Summary</h3>
              <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
                {summary}
              </p>
            </section>
          )}
          {sections.length > 0 && (
            <div className="space-y-4">
              {sections.map((section, index) => (
                <section key={`${section.title || "section"}-${index}`}>
                  {section.title && (
                    <h3 className="text-[11px] uppercase tracking-wide text-text-dim mb-1">
                      {section.title}
                    </h3>
                  )}
                  {section.body && (
                    <p className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
                      {section.body}
                    </p>
                  )}
                </section>
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function AlertCard({ props }: { props: Record<string, unknown> }) {
  const title = String(props.title || "Alert");
  const body = String(props.body || "");
  const severity = String(props.severity || "info").toLowerCase();
  const tone =
    severity === "critical" || severity === "error"
      ? "border-red/35 bg-red/10 text-red"
      : severity === "warning" || severity === "warn"
        ? "border-yellow/35 bg-yellow/10 text-yellow"
        : "border-accent/25 bg-bg-card/90 text-accent";

  return (
    <div className={`w-full max-w-2xl rounded-xl border p-3 sm:p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide font-bold">
            Alert
          </div>
          <h3 className="text-sm text-text font-bold mt-0.5 break-words">{title}</h3>
        </div>
        <span className="shrink-0 rounded-full border border-current/30 px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {severity}
        </span>
      </div>
      {body && (
        <p className="mt-3 text-sm text-text-muted leading-relaxed whitespace-pre-wrap break-words">
          {body}
        </p>
      )}
    </div>
  );
}

// ─── Fallbacks ───────────────────────────────────────────────────────

function ComponentSkeleton() {
  return (
    <div className="space-y-2 rounded border border-border p-3" aria-label="Loading component">
      <div className="h-2.5 w-1/3 animate-pulse rounded bg-bg-hover" />
      <div className="h-2 w-full animate-pulse rounded bg-bg-hover" />
      <div className="h-2 w-2/3 animate-pulse rounded bg-bg-hover" />
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

// ─── Shared installed-app catalog ───────────────────────────────────

interface InstalledAppsCacheEntry {
  apps: InstalledAppRow[];
  promise: Promise<void> | null;
  listeners: Set<() => void>;
}

const installedAppsCache = new Map<string, InstalledAppsCacheEntry>();
const EMPTY_INSTALLED_APPS: InstalledAppRow[] = [];
let installedAppsChangeListenerReady = false;

function normalizeInstalledApps(rows: unknown): InstalledAppRow[] {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((r: any) => ({
    install_id: r.install_id ?? r.id ?? 0,
    name: String(r.name ?? ""),
    display_name: String(r.display_name ?? r.name ?? ""),
    version: String(r.version ?? ""),
    icon: typeof r.icon === "string" ? r.icon : undefined,
    icon_style: r.icon_style === "monochrome" ? "monochrome" : "image",
    source: typeof r.source === "string" ? r.source : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
    surfaces: r.surfaces && typeof r.surfaces === "object"
      ? {
          mcp_tool_names: Array.isArray(r.surfaces.mcp_tool_names)
            ? r.surfaces.mcp_tool_names.map(String)
            : [],
        }
      : undefined,
    ui_components: Array.isArray(r.ui_components) ? r.ui_components : [],
  }));
}

function cacheEntry(projectId: string): InstalledAppsCacheEntry {
  let entry = installedAppsCache.get(projectId);
  if (!entry) {
    entry = { apps: [], promise: null, listeners: new Set() };
    installedAppsCache.set(projectId, entry);
  }
  return entry;
}

function notifyInstalledApps(entry: InstalledAppsCacheEntry) {
  for (const listener of [...entry.listeners]) listener();
}

function loadInstalledApps(projectId: string, force = false): Promise<void> {
  const entry = cacheEntry(projectId);
  if (entry.promise && !force) return entry.promise;
  const request = fetch(`/api/apps?project_id=${encodeURIComponent(projectId)}`, {
    credentials: "same-origin",
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to load apps (${response.status})`);
      return response.json();
    })
    .then((rows) => {
      entry.apps = normalizeInstalledApps(rows);
      notifyInstalledApps(entry);
    })
    .catch(() => {
      // Preserve the last known-good catalog during transient reconnects.
    })
    .finally(() => {
      if (entry.promise === request) entry.promise = null;
    });
  entry.promise = request;
  return request;
}

function ensureInstalledAppsChangeListener() {
  if (installedAppsChangeListenerReady || typeof window === "undefined") return;
  installedAppsChangeListenerReady = true;
  window.addEventListener("apteva:apps-changed", () => {
    for (const projectId of installedAppsCache.keys()) {
      void loadInstalledApps(projectId, true);
    }
  });
}

export function refreshInstalledApps(projectId?: string) {
  if (projectId) return loadInstalledApps(projectId, true);
  return Promise.all(
    [...installedAppsCache.keys()].map((id) => loadInstalledApps(id, true)),
  ).then(() => undefined);
}

/**
 * Lightweight "give me the list of installed apps for this project"
 * hook. The chat panel passes the result into ChatComponentList.
 * Refetches only when the project changes — installed apps don't
 * churn at component render frequency.
 */
export function useInstalledApps(projectId: string | null | undefined): InstalledAppRow[] {
  ensureInstalledAppsChangeListener();
  const key = projectId || "";
  const subscribe = useMemo(
    () => (listener: () => void) => {
      if (!key) return () => {};
      const entry = cacheEntry(key);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [key],
  );
  const getSnapshot = useMemo(
    () => () => (key ? cacheEntry(key).apps : EMPTY_INSTALLED_APPS),
    [key],
  );
  const apps = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (key) void loadInstalledApps(key);
  }, [projectId]);
  return apps;
}

export const __installedAppsTestHelpers = {
  cache: installedAppsCache,
  normalizeInstalledApps,
};
