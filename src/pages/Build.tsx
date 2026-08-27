import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppIcon } from "@apteva/ui-kit";
import {
  apps,
  instances,
  platformHelper,
  skills,
  telemetry,
  type Agent,
  type AppRow,
  type Skill,
  type TelemetryEvent,
} from "../api";
import {
  ContributionMount,
  contributionsFor,
  fetchEligibleContributionKeys,
  type Contribution,
  type ResolvedWidgetInstance,
} from "../components/apps/contributions";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";

interface BuildSurface {
  rows: AppRow[];
  instance: ResolvedWidgetInstance;
}

type WorkspaceTab = "project" | "activity";
type WorkspaceItemKind = "agent" | "app" | "skill";

interface WorkspaceItem {
  id: string;
  kind: WorkspaceItemKind;
  name: string;
  detail: string;
  status: string;
  href: string;
  icon?: string;
  iconStyle?: "image" | "monochrome";
}

const BUILD_SLOT = "dashboard.build";
const BUILD_COMPONENT = "agent-conversations";

export function selectBuilderInstall(rows: AppRow[]): AppRow | null {
  return rows.find(
    (row) => row.name === "builder" && !row.project_id && row.status === "running",
  ) || null;
}

async function reconcileBuilderSetup(builder: AppRow): Promise<void> {
  const query = new URLSearchParams({ install_id: String(builder.install_id) });
  const response = await fetch(`/api/apps/builder/setup/reconcile?${query}`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (response.ok) return;
  let message = "Builder could not attach its tools to Apteva Helper.";
  try {
    const body = await response.json() as { last_error?: string };
    if (body.last_error) message = body.last_error;
  } catch {
    // Keep the stable operator-facing fallback for non-JSON proxy errors.
  }
  throw new Error(message);
}

export function selectBuildConversationsContribution(
  rows: AppRow[],
  projectId: string,
): Contribution | null {
  const matches = contributionsFor(rows, BUILD_SLOT).filter(
    (item) => item.app.name === "conversations" && item.spec.name === BUILD_COMPONENT,
  );
  return (
    matches.find((item) => (item.app as AppRow).project_id === projectId) ||
    matches.find((item) => !(item.app as AppRow).project_id) ||
    null
  );
}

export function Build() {
  usePageTitle("Build");
  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const [surface, setSurface] = useState<BuildSurface | null>(null);
  const [helper, setHelper] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsBuilder, setNeedsBuilder] = useState(false);
  const [needsConversations, setNeedsConversations] = useState(false);
  const [projectAgents, setProjectAgents] = useState<Agent[]>([]);
  const [projectApps, setProjectApps] = useState<AppRow[]>([]);
  const [projectSkills, setProjectSkills] = useState<Skill[]>([]);
  const [activity, setActivity] = useState<TelemetryEvent[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("project");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const projectContextRequest = useRef(0);

  const refreshProjectContext = useCallback(async () => {
    const requestID = ++projectContextRequest.current;
    if (!projectId) {
      setProjectAgents([]);
      setProjectApps([]);
      setProjectSkills([]);
      return;
    }
    const [agentRows, appRows, skillRows] = await Promise.all([
      instances.list(projectId).catch(() => [] as Agent[]),
      apps.list(projectId).catch(() => [] as AppRow[]),
      skills.list(projectId).catch(() => [] as Skill[]),
    ]);
    if (requestID !== projectContextRequest.current) return;
    setProjectAgents(agentRows);
    setProjectApps(appRows);
    setProjectSkills(skillRows);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setSurface(null);
      setHelper(null);
      setLoading(false);
      setError("Select a project to open Build.");
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setNeedsBuilder(false);
      setNeedsConversations(false);
      setSurface(null);
      setHelper(null);
      try {
        const helperStatus = await platformHelper.status();
        if (cancelled) return;

        if (!helperStatus.activated) {
          navigate("/", { replace: true });
          return;
        }

        const rows = await apps.list(projectId);
        if (cancelled) return;

        const builder = selectBuilderInstall(rows);
        if (!builder) {
          setNeedsBuilder(true);
          return;
        }

        const contribution = selectBuildConversationsContribution(rows, projectId);
        if (!contribution) {
          setNeedsConversations(true);
          return;
        }

        // GET starts an activated-but-stopped Helper lazily. Its id is a
        // mandatory scope for the dashboard.build contribution; Conversations
        // uses it to list and create conversations for this Helper only.
        const activeHelper = await platformHelper.get();
        if (cancelled) return;
        await reconcileBuilderSetup(builder);
        if (cancelled) return;
        const eligible = await fetchEligibleContributionKeys(
          projectId,
          BUILD_SLOT,
          activeHelper.id,
        );
        if (cancelled) return;
        if (!eligible.has(contribution.key)) {
          setHelper(activeHelper);
          setNeedsConversations(true);
          return;
        }
        setHelper(activeHelper);
        setSurface({
          rows,
          instance: {
            id: `build:${contribution.key}:${activeHelper.id}`,
            component: contribution.key,
            size: "full",
            settings: {},
            contribution,
          },
        });
      } catch {
        if (!cancelled) {
          // Build is not a generally available surface: if activation cannot
          // be verified, do not leave a deep-linked page visible.
          navigate("/", { replace: true });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const reload = () => void load();
    window.addEventListener("apteva:apps-changed", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("apteva:apps-changed", reload);
    };
  }, [navigate, projectId]);

  useEffect(() => {
    void refreshProjectContext();
    const refresh = () => void refreshProjectContext();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("apteva:apps-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("apteva:apps-changed", refresh);
    };
  }, [refreshProjectContext]);

  useEffect(() => {
    if (!helper?.id) {
      setActivity([]);
      return;
    }
    let cancelled = false;
    setActivity([]);
    telemetry
      .query(helper.id, undefined, 50)
      .then((events) => {
        if (!cancelled) setActivity(sortActivity(events || []));
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    const unsubscribe = window.__aptevaTelemetryBus?.subscribe(
      helper.id,
      (event) => {
        setActivity((current) =>
          sortActivity([
            event,
            ...current.filter((row) => row.id !== event.id),
          ]).slice(0, 50),
        );
        if (event.type === "tool.result" || event.type === "thread.done") {
          window.setTimeout(() => void refreshProjectContext(), 500);
        }
      },
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [helper?.id, refreshProjectContext]);

  const workspaceItems = useMemo(
    () => buildWorkspaceItems(projectAgents, projectApps, projectSkills),
    [projectAgents, projectApps, projectSkills],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text">Build</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Set the outcome. Helper plans, builds, verifies, and asks before consequential actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {helper && (
            <div className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[10px] font-semibold text-text-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${helper.status === "running" ? "bg-green" : "bg-text-dim"}`}
              />
              {helper.name} · {helper.status}
            </div>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-bold text-text-muted hover:bg-bg-hover hover:text-text xl:hidden"
            aria-label="Open project workspace"
          >
            <ProjectIcon /> Project
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-h-0 overflow-hidden">
          {loading ? (
            <BuildState title="Loading Build…" detail="Opening Conversations and Apteva Helper." />
          ) : needsBuilder ? (
            <BuildState
              title="Builder is not installed"
              detail="Install the Builder app to give Apteva Helper durable goals, plans, checks, and managed-resource tracking. Conversations will be installed with it."
              action={{ to: "/apps", label: "Install Builder" }}
            />
          ) : needsConversations ? (
            <BuildState
              title="Conversations is unavailable"
              detail="Build now uses the Conversations app UI. Install or start Conversations, then return here."
              action={{ to: "/apps", label: "Open Apps" }}
            />
          ) : error ? (
            <BuildState
              title="Build could not open"
              detail={error}
              action={{ to: "/settings?tab=helper", label: "Check Helper settings" }}
            />
          ) : surface && helper ? (
            <ContributionMount
              instance={surface.instance}
              apps={surface.rows}
              slot={BUILD_SLOT}
              projectId={projectId}
              agentId={helper.id}
            />
          ) : (
            <BuildState title="Build is unavailable" detail="The Conversations panel could not be resolved." />
          )}
        </section>
        <aside className="hidden min-h-0 border-l border-border xl:block">
          <WorkspacePanel
            projectName={currentProject?.name || "Current project"}
            projectDescription={currentProject?.description || ""}
            items={workspaceItems}
            activity={activity}
            tab={workspaceTab}
            onTab={setWorkspaceTab}
            onOpen={(href) => navigate(href)}
          />
        </aside>
      </main>

      {workspaceOpen && (
        <Drawer label="Project workspace" onClose={() => setWorkspaceOpen(false)}>
          <WorkspacePanel
            projectName={currentProject?.name || "Current project"}
            projectDescription={currentProject?.description || ""}
            items={workspaceItems}
            activity={activity}
            tab={workspaceTab}
            onTab={setWorkspaceTab}
            onOpen={(href) => {
              setWorkspaceOpen(false);
              navigate(href);
            }}
          />
        </Drawer>
      )}
    </div>
  );
}

function BuildState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-lg text-center">
        <h2 className="text-base font-bold text-text">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{detail}</p>
        {action && (
          <Link
            to={action.to}
            className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover"
          >
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

function WorkspacePanel(props: {
  projectName: string;
  projectDescription: string;
  items: WorkspaceItem[];
  activity: TelemetryEvent[];
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  onOpen: (href: string) => void;
}) {
  const groups = (["agent", "app", "skill"] as WorkspaceItemKind[]).map(
    (kind) => ({
      kind,
      items: props.items.filter((item) => item.kind === kind),
    }),
  );
  const meaningfulActivity = props.activity
    .filter((event) => !isNoisyActivity(event.type))
    .slice(0, 30);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="shrink-0 border-b border-border px-4 pb-0 pt-3">
        <div className="flex min-w-0 items-center gap-2 pb-1">
          <ProjectIcon />
          <h2 className="truncate text-sm font-bold text-text">
            {props.projectName}
          </h2>
        </div>
        <p className="line-clamp-2 min-h-4 text-[10px] leading-4 text-text-dim">
          {props.projectDescription || "Project workspace"}
        </p>
        <div className="mt-3 flex gap-4">
          <WorkspaceTabButton
            active={props.tab === "project"}
            onClick={() => props.onTab("project")}
          >
            Project
          </WorkspaceTabButton>
          <WorkspaceTabButton
            active={props.tab === "activity"}
            onClick={() => props.onTab("activity")}
          >
            Helper activity
          </WorkspaceTabButton>
        </div>
      </div>

      {props.tab === "project" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-4 grid grid-cols-3 gap-1.5">
            {groups.map((group) => (
              <div
                key={group.kind}
                className="rounded-md border border-border bg-bg-card/40 px-2 py-2 text-center"
              >
                <div className="text-sm font-bold text-text">
                  {group.items.length}
                </div>
                <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-text-dim">
                  {group.kind}
                  {group.items.length === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>

          {groups.map((group) => (
            <section key={group.kind} className="mb-5">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.15em] text-text-dim">
                  {workspaceLabel(group.kind)}
                </h3>
                <button
                  type="button"
                  onClick={() => props.onOpen(addHref(group.kind))}
                  className="text-[10px] text-text-muted hover:text-accent"
                >
                  + Add
                </button>
              </div>
              {group.items.length === 0 ? (
                <PanelEmpty>
                  No {workspaceLabel(group.kind).toLowerCase()} in this project.
                </PanelEmpty>
              ) : (
                <div className="space-y-1">
                  {group.items.slice(0, 5).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => props.onOpen(item.href)}
                      className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-border hover:bg-bg-hover"
                    >
                      <WorkspaceIcon item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold text-text">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[9px] text-text-dim">
                          {item.detail}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-[8px] font-bold uppercase ${workspaceStatusTone(item.status)}`}
                      >
                        {item.status}
                      </span>
                    </button>
                  ))}
                  {group.items.length > 5 && (
                    <button
                      type="button"
                      onClick={() => props.onOpen(addHref(group.kind))}
                      className="mt-1 flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[10px] font-bold text-text-muted hover:bg-bg-hover hover:text-text"
                    >
                      <span>
                        View all {group.items.length}{" "}
                        {workspaceLabel(group.kind).toLowerCase()}
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {meaningfulActivity.length === 0 ? (
            <PanelEmpty>
              Tool calls and project work from Apteva Helper will appear here.
            </PanelEmpty>
          ) : (
            <div className="space-y-1">
              {meaningfulActivity.map((event) => (
                <div
                  key={event.id}
                  className="rounded-md border border-transparent px-2.5 py-2 hover:border-border hover:bg-bg-hover"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wide ${activityTone(event.type)}`}
                    >
                      {activityType(event.type)}
                    </span>
                    <span className="shrink-0 text-[9px] text-text-dim">
                      {relativeTime(event.time)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-text-muted">
                    {activitySummary(event)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkspaceTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 pb-2 text-[11px] font-bold ${
        active
          ? "border-accent text-text"
          : "border-transparent text-text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-[60] xl:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label={`Close ${label}`}
      />
      <div className="absolute inset-y-0 right-0 flex w-[min(23rem,92vw)] flex-col border-l border-border bg-bg shadow-[var(--shadow-popover)]">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-xs font-bold text-text">{label}</span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-md text-text-muted hover:bg-bg-hover hover:text-text"
            aria-label={`Close ${label}`}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-3 text-center text-[10px] leading-5 text-text-dim">
      {children}
    </div>
  );
}

function WorkspaceIcon({ item }: { item: WorkspaceItem }) {
  if (item.kind === "app") {
    return (
      <AppIcon
        src={item.icon}
        iconStyle={item.iconStyle}
        name={item.name}
        size="sm"
        className="text-accent"
      />
    );
  }
  const label = item.kind === "agent" ? "A" : "S";
  const tone =
    item.kind === "agent"
      ? "bg-accent/10 text-accent"
      : "bg-info/10 text-info";
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${tone}`}
    >
      {label}
    </span>
  );
}

export function buildWorkspaceItems(
  agentRows: Agent[],
  appRows: AppRow[],
  skillRows: Skill[],
): WorkspaceItem[] {
  return [
    ...agentRows.map(
      (agent): WorkspaceItem => ({
        id: `agent-${agent.id}`,
        kind: "agent",
        name: agent.name,
        detail: `${agent.mode} · #${agent.id}`,
        status: agent.status || "stopped",
        href: `/agents/${agent.id}`,
      }),
    ),
    ...appRows.map(
      (app): WorkspaceItem => ({
        id: `app-${app.install_id}`,
        kind: "app",
        name: app.display_name || app.name,
        detail: app.surfaces?.mcp_tool_count
          ? `${app.surfaces.mcp_tool_count} tools`
          : app.description || app.version,
        status: app.status,
        href: "/apps",
        icon: app.icon,
        iconStyle: app.icon_style,
      }),
    ),
    ...skillRows.map(
      (skill): WorkspaceItem => ({
        id: `skill-${skill.id}`,
        kind: "skill",
        name: skill.name,
        detail: skill.description || skill.source,
        status: skill.enabled ? "enabled" : "disabled",
        href: "/skills",
      }),
    ),
  ];
}

function timeValue(value?: string): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function relativeTime(value?: string): string {
  const stamp = timeValue(value);
  if (!stamp) return "";
  const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(stamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function sortActivity(events: TelemetryEvent[]): TelemetryEvent[] {
  return [...events].sort((a, b) => timeValue(b.time) - timeValue(a.time));
}

function isNoisyActivity(type: string): boolean {
  return (
    type.includes("chunk") ||
    type.includes("delta") ||
    type === "llm.token"
  );
}

function activityType(type: string): string {
  if (type.startsWith("tool.")) {
    return type === "tool.result" ? "Tool result" : "Tool";
  }
  if (type.startsWith("thread.")) return "Session";
  if (type.includes("error")) return "Error";
  if (type.startsWith("llm.")) return "Thinking";
  return type.replace(/[._]/g, " ");
}

function activitySummary(event: TelemetryEvent): string {
  const data = event.data || {};
  const candidates = [
    data._reason,
    data.reason,
    data.message,
    data.text,
    data.summary,
    data.tool,
    data.name,
    data.status,
  ];
  const value = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.trim(),
  );
  return value ? String(value) : event.type.replace(/[._]/g, " ");
}

function activityTone(type: string): string {
  if (type.includes("error") || type.includes("failed")) return "text-red";
  if (type === "tool.result" || type === "thread.done") return "text-green";
  if (type.startsWith("tool.")) return "text-accent";
  return "text-text-dim";
}

function workspaceLabel(kind: WorkspaceItemKind): string {
  return kind === "agent" ? "Agents" : kind === "app" ? "Apps" : "Skills";
}

function addHref(kind: WorkspaceItemKind): string {
  return kind === "agent" ? "/agents/new" : kind === "app" ? "/apps" : "/skills";
}

function workspaceStatusTone(status: string): string {
  const value = status.toLowerCase();
  if (["running", "enabled"].includes(value)) return "text-green";
  if (["error", "failed"].includes(value)) return "text-red";
  if (value === "pending") return "text-accent";
  return "text-text-dim";
}

function ProjectIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}
