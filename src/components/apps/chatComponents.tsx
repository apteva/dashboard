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
} from "react";
import { chat, type ChatComponent, type ChatMessageRow } from "../../api";
import { Modal } from "../Modal";

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
//
// `source` is "builtin" | "github" | "local" | "integration". The
// "integration" value is synthesised server-side for any project
// connection whose template declares ui_components — those rows
// load their bundles from /api/integrations/<slug>/ instead of
// /api/apps/<slug>/.
export interface InstalledAppRow {
  install_id: number;
  name: string;
  version: string;
  source?: string;
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
  source?: string,
): LazyExoticComponent<ComponentType<NativeComponentProps>> {
  // Integrations live under a different path than apps. The server
  // serves /api/integrations/<slug>/ui/<file> from the embedded
  // integrations dist tree; apps come from the per-install sidecar
  // proxy at /api/apps/<slug>/<entry>.
  const base = source === "integration"
    ? `/api/integrations/${appName}${entry}`
    : `/api/apps/${appName}${entry}`;
  const url = version ? `${base}?v=${encodeURIComponent(version)}` : base;
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
  const Lazy = loadComponent(app.name, spec.entry, app.version, app.source);
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
    <div className="mt-2 flex flex-col gap-2 max-w-full">
      {components.map((c, i) => (
        // Composite key: app + name keep components stable across
        // renders even if the array changes shape (e.g. an inserted
        // attachment shifts later items left); the index suffix
        // disambiguates two of the same component on one message.
        // Pure index-keying made React reuse DOM nodes for the wrong
        // entry whenever the array mutated mid-flight.
        <ChatComponentMount
          key={`${c.app}:${c.name}:${i}`}
          comp={c}
          apps={apps}
          projectId={projectId}
          messageId={messageId}
          onMessageUpdated={onMessageUpdated}
          onActionComplete={onActionComplete}
        />
      ))}
    </div>
  );
}

interface ApprovalAction {
  id: string;
  label: string;
  style?: string;
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
  const [submitting, setSubmitting] = useState<string | null>(null);
  const id = Number(props.message_id || messageId || 0);
  const title = String(props.title || "Approval requested");
  const body = String(props.body || "");
  const status = String(props.status || "pending");
  const decision = props.decision && typeof props.decision === "object"
    ? props.decision as Record<string, unknown>
    : null;
  const actions = useMemo(() => {
    const raw = Array.isArray(props.actions) ? props.actions : [];
    const parsed = raw
      .map((item): ApprovalAction | null => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        const actionId = String(obj.id || "").trim();
        const label = String(obj.label || "").trim();
        const style = String(obj.style || "").trim();
        if (!actionId || !label) return null;
        return { id: actionId, label, style };
      })
      .filter(Boolean) as ApprovalAction[];
    return parsed.length > 0
      ? parsed
      : [
          { id: "approve", label: "Approve", style: "primary" },
          { id: "deny", label: "Deny", style: "danger" },
        ];
  }, [props.actions]);

  const sendAction = async (actionId: string) => {
    if (!id || status !== "pending" || submitting) return;
    setSubmitting(actionId);
    try {
      const res = await chat.messageAction(id, actionId);
      onMessageUpdated?.(res.message);
      onActionComplete?.();
    } finally {
      setSubmitting(null);
    }
  };

  const statusLabel = status === "approved"
    ? "Approved"
    : status === "denied"
      ? "Denied"
      : status === "acted"
        ? "Completed"
        : "Pending";

  return (
    <div className="rounded-lg border border-accent/35 bg-bg-card/90 p-3 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-accent font-bold">
            Approval
          </div>
          <h3 className="text-sm text-text font-bold mt-0.5 break-words">{title}</h3>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide border ${
            status === "pending"
              ? "border-yellow/40 text-yellow bg-yellow/10"
              : status === "approved"
                ? "border-green/40 text-green bg-green/10"
                : "border-text-muted/40 text-text-muted bg-bg-subtle"
          }`}
        >
          {statusLabel}
        </span>
      </div>
      {body && (
        <p className="mt-2 text-xs text-text-muted leading-relaxed whitespace-pre-wrap break-words">
          {body}
        </p>
      )}
      {status === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={!id || !!submitting}
              onClick={() => void sendAction(action.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                action.style === "danger" || action.id === "deny"
                  ? "border-red/40 text-red hover:bg-red/10"
                  : action.style === "primary" || action.id === "approve"
                    ? "border-accent/50 text-accent bg-accent/10 hover:bg-accent/20"
                    : "border-border text-text-muted hover:border-text hover:text-text"
              }`}
            >
              {submitting === action.id ? "Sending..." : action.label}
            </button>
          ))}
        </div>
      ) : decision && (
        <div className="mt-3 text-[11px] text-text-dim">
          Decision: {String(decision.action_id || status)}
        </div>
      )}
    </div>
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
      <div className="rounded-lg border border-accent/25 bg-bg-card/90 p-3 max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-accent font-bold">Report</div>
            <h3 className="text-sm text-text font-bold mt-0.5 break-words">{title}</h3>
            {period && <div className="mt-1 text-[11px] text-text-dim">{period}</div>}
          </div>
        </div>
        {summary && (
          <p className="mt-2 text-xs text-text-muted leading-relaxed whitespace-pre-wrap break-words">
            {summary}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-[11px] text-accent hover:text-accent-hover font-bold"
        >
          Open report
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} width="max-w-3xl">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-accent font-bold">Report</div>
            <h2 className="mt-1 text-lg font-bold text-text break-words">{title}</h2>
            {period && <div className="mt-1 text-xs text-text-dim">{period}</div>}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="shrink-0 text-text-muted hover:text-text border border-border rounded px-2 py-1 text-xs"
          >
            Close
          </button>
        </div>
        <div className="overflow-auto px-5 py-4 space-y-4">
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
    <div className={`rounded-lg border p-3 max-w-2xl ${tone}`}>
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
        <p className="mt-2 text-xs text-text-muted leading-relaxed whitespace-pre-wrap break-words">
          {body}
        </p>
      )}
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
            source: typeof r.source === "string" ? r.source : undefined,
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
