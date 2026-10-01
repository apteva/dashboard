import { QuickActionsWidget } from "./QuickActionsWidget";
import type { WorkspaceSystem } from "./useWorkspaceSystem";
import { HelperWidget } from "./HelperWidget";
import { AppIcon } from "@apteva/ui-kit";
import type { ReactNode } from "react";
import type { Agent, AppRow, ConnectionInfo, Skill } from "../../api";
import { AgentMark } from "../AgentMark";
import { SystemMapWidget, InspectorWidget, ResultPreviewWidget, WorkspaceActivityWidget } from "./SystemWidgets";
import type { WorkspaceData } from "./useWorkspaceData";
import type { RuntimeEventItem } from "../../utils/runtimeActivity";
import { HomeAgentOperations, HomeUsageSummary } from "../dashboard/HomePanels";
import { Link } from "react-router-dom";
import type { InstanceStats, CurrentStatusMessageRow } from "../../api";
import type { WidgetDefinition } from "../apps/WidgetCanvas";
import type { WidgetActionBridge, WidgetContext, WidgetRenderContext } from "../apps/widgetContext";

export interface NativeWidgetContext extends WorkspaceData {
  system: WorkspaceSystem;
  activity: { rows: RuntimeEventItem[]; loading: boolean; error: string };
  refresh: () => void;
  agents: Agent[];
  stats: InstanceStats[];
  statuses: CurrentStatusMessageRow[];
  apps: AppRow[];
  connections: ConnectionInfo[];
  skills: Skill[];
  projectId?: string;
  allProjects: boolean;
  projectNames: Map<string, string>;
  widgetContext: WidgetContext;
  widgetActions: WidgetActionBridge;
}

const rowsSchema = {
  type: "object",
  properties: {
    max_rows: {
      type: "integer",
      title: "Rows",
      minimum: 3,
      maximum: 12,
      default: 6,
      description: "How many items to show before linking to the full list.",
    },
  },
} as Record<string, unknown>;

/** Native widgets are deliberately data-in/data-out. The page owns fetching
 * and scope, while this registry owns presentation and composition metadata.
 * That makes the same definitions usable by Home, custom pages, and a future
 * page builder without giving widgets hidden access to the current route. */
export function nativeWidgetDefinitions(context: NativeWidgetContext): WidgetDefinition[] {
  const appRows = context.apps;
  const definitions: WidgetDefinition[] = [
    { key: "native:helper", label: "Apteva Helper", description: "Build through the existing Conversations chat widget.", supportedSizes: ["half", "full"], defaultSize: "half", kind: "builtin", render: (_instance, renderContext) => <HelperWidget {...context} renderContext={renderContext} /> },
    { key: "native:system-map", label: "Agents & capabilities", description: "Compact agent cards with live status and attached apps and integrations.", supportedSizes: ["half", "full"], defaultSize: "full", kind: "builtin", render: (_instance, renderContext) => <SystemMapWidget {...context} renderContext={renderContext} /> },
    { key: "native:result-preview", label: "Result / preview", description: "Inspect selected activity and app outputs.", supportedSizes: ["half", "full"], defaultSize: "half", kind: "builtin", render: (_instance, renderContext) => <ResultPreviewWidget {...context} renderContext={renderContext} /> },
    {
      key: "native:workspace-summary",
      label: "Workspace overview",
      description: "A compact view of the resources and state in this workspace.",
      supportedSizes: ["half", "full"],
      defaultSize: "full",
      kind: "builtin",
      render: (_instance, renderContext) => (
        <NativeWorkspaceSummaryWidget
          {...context}
          renderContext={renderContext}
        />
      ),
    },
    {
      key: "native:quick-actions",
      label: "Quick actions",
      description: "Start common workspace actions without leaving the page.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      kind: "builtin",
      render: (_instance, renderContext) => (
        <QuickActionsWidget
          {...context}
          renderContext={renderContext}
        />
      ),
    },
    {
      key: "native:context-inspector",
      label: "Inspector",
      description: "Inspect and act on the item selected in another widget.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      kind: "builtin",
      render: (_instance, renderContext) => (
        <InspectorWidget
          {...context}
          renderContext={renderContext}
        />
      ),
    },
    {
      key: "native:readiness",
      label: "Needs attention",
      description: "See what is available and what needs attention.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      kind: "builtin",
      render: (_instance, renderContext) => (
        <NativeReadinessWidget
          {...context}
          renderContext={renderContext}
        />
      ),
    },
    {
      key: "native:agents",
      label: "Agents",
      description: "Your agents and their current state.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      defaultSettings: { max_rows: 6 },
      settingsSchema: rowsSchema,
      kind: "builtin",
      render: (instance) => <NativeAgentsWidget {...context} settings={instance.settings} />,
    },
    {
      key: "native:apps",
      label: "Apps",
      description: "Installed apps available in this workspace.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      defaultSettings: { max_rows: 6 },
      settingsSchema: rowsSchema,
      kind: "builtin",
      render: (instance) => <NativeAppsWidget apps={appRows} widgetActions={context.widgetActions} settings={instance.settings} />,
    },
    {
      key: "native:integrations",
      label: "Integrations",
      description: "Connected services and the tools they provide.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      defaultSettings: { max_rows: 6 },
      settingsSchema: rowsSchema,
      kind: "builtin",
      render: (instance) => <NativeIntegrationsWidget connections={context.connections} widgetActions={context.widgetActions} settings={instance.settings} />,
    },
    {
      key: "native:skills",
      label: "Skills",
      description: "Reusable instructions available to your agents.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      defaultSettings: { max_rows: 6 },
      settingsSchema: rowsSchema,
      kind: "builtin",
      render: (instance) => <NativeSkillsWidget skills={context.skills} widgetActions={context.widgetActions} settings={instance.settings} />,
    },
    {
      key: "native:agent-activity",
      label: "Agent activity",
      description: "Current work, progress, blockers, and next steps across your agents.",
      supportedSizes: ["half", "full"],
      defaultSize: "full",
      kind: "builtin",
      render: (instance) => (
        <HomeAgentOperations
          agents={context.agents}
          statuses={context.statuses}
          compact={instance.size === "half"}
          showProjects={context.allProjects}
          projectNames={context.projectNames}
        />
      ),
    },
    {
      key: "native:usage",
      label: "Usage summary",
      description: "Agents, calls, tokens, errors, and cost for the last 24 hours.",
      supportedSizes: ["full"],
      defaultSize: "full",
      kind: "builtin",
      render: () => <HomeUsageSummary agents={context.agents} stats={context.stats} />,
    },
    {
      key: "native:activity",
      label: "Live activity",
      description: "Significant agent actions and tool events.",
      supportedSizes: ["half", "full"],
      defaultSize: "full",
      kind: "builtin",
      render: (_instance, renderContext) => <WorkspaceActivityWidget {...context} renderContext={renderContext} />,
    },
  ];
  return definitions.map(definition => ({ ...definition, render: (instance, renderContext) => context.loading && definition.key !== "native:quick-actions"
    ? <section className="rounded-lg border border-border bg-bg-card p-4" aria-busy="true"><h2 className="text-sm font-bold">{definition.label}</h2><p className="mt-3 text-xs text-text-muted">Loading…</p></section>
    : definition.render(instance, renderContext) }));
}

function NativeWorkspaceSummaryWidget({
  agents,
  apps,
  connections,
  skills,
  allProjects,
  projectNames,
  widgetContext,
  widgetActions,
  renderContext,
}: NativeWidgetContext & { renderContext?: WidgetRenderContext }) {
  const context = renderContext?.context || widgetContext;
  const actions = renderContext?.actions || widgetActions;
  const selected = context.selected;
  const running = agents.filter((agent) => agent.status === "running").length;
  const failed = agents.filter((agent) => ["error", "failed"].includes(String(agent.status || "").toLowerCase())).length;
  const projectLabel = context.scope === "global"
    ? "All projects"
    : (context.projectId && projectNames.get(context.projectId)) || "Current project";
  const resources = [
    { type: "agent" as const, label: "Agents", count: agents.length, href: "/agents" },
    { type: "app" as const, label: "Apps", count: apps.length, href: "/apps" },
    { type: "integration" as const, label: "Connections", count: connections.length, href: "/integrations" },
    { type: "skill" as const, label: "Skills", count: skills.length, href: "/skills" },
  ];
  return (
    <section className="h-full overflow-hidden rounded-lg border border-border bg-bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-text">Workspace overview</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">{projectLabel} · {running ? `${running} online` : "No agents online"}{failed ? ` · ${failed} needs attention` : ""}</p>
        </div>
        {selected && <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] text-accent">Selected: {selected.label || `${selected.type} ${selected.id}`}</span>}
      </header>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {resources.map((resource) => (
          <Link
            key={resource.type}
            to={resource.href}
            className="rounded-lg border border-border bg-bg-subtle px-3 py-3 text-left transition-colors hover:border-accent/60 hover:bg-bg-hover"
          >
            <span className="block text-[10px] uppercase tracking-wide text-text-dim">{resource.label}</span>
            <span className="mt-1 block text-lg font-bold tabular-nums text-text">{resource.count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function NativeReadinessWidget(props: NativeWidgetContext & { renderContext?: WidgetRenderContext }) {
  const issues = [
    ...props.agents.filter(a => ["error", "failed"].includes(a.status)).map(a => ({ label: a.name, detail: a.status, ref: { type: "agent" as const, id: a.id, projectId: a.project_id } })),
    ...props.apps.filter(a => a.status === "error").map(a => ({ label: a.display_name || a.name, detail: a.error_message || "App error", ref: { type: "app" as const, id: a.install_id, projectId: a.project_id } })),
    ...props.connections.filter(c => !["active", "connected", "disabled"].includes(c.status)).map(c => ({ label: c.name || c.app_name, detail: c.status, ref: { type: "integration" as const, id: c.id, projectId: c.project_id } })),
  ];
  return <section className="h-full rounded-lg border border-border bg-bg-card"><header className="border-b border-border px-4 py-3"><h2 className="text-sm font-bold">Needs attention</h2><p className="mt-0.5 text-[11px] text-text-dim">Reported resource issues in this scope.</p></header>
    {props.loading ? <p className="p-4 text-xs text-text-muted">Loading resource status…</p> : props.errors.length > 0 ? <p className="p-4 text-xs text-yellow">Some status is unavailable. Refresh to try again.</p> : issues.length === 0 ? <p className="p-4 text-xs text-text-muted">No resource errors reported. Task-specific readiness depends on what you want to run.</p> : <ul className="divide-y divide-border">{issues.map(issue => <li key={`${issue.ref.type}:${issue.ref.id}`}><button className="w-full px-4 py-3 text-left hover:bg-bg-hover" onClick={() => (props.renderContext?.actions || props.widgetActions).select({ ...issue.ref, label: issue.label })}><span className="block text-xs font-semibold">{issue.label}</span><span className="block text-xs text-yellow">{issue.detail}</span></button></li>)}</ul>}
  </section>;
}

function NativeWidgetCard({
  title,
  subtitle,
  count,
  href,
  children,
}: {
  title: string;
  subtitle: string;
  count?: number;
  href: string;
  children: ReactNode;
}) {
  return (
    <section className="h-full overflow-hidden rounded-lg border border-border bg-bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-text">{title}</h2>
            {count !== undefined && <span className="rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted">{count}</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-text-dim">{subtitle}</p>
        </div>
        <Link to={href} className="shrink-0 pt-0.5 text-[11px] text-text-muted hover:text-text">View all →</Link>
      </header>
      {children}
    </section>
  );
}

function NativeAgentsWidget({ agents, projectNames, widgetActions, settings }: NativeWidgetContext & { settings?: Record<string, unknown> }) {
  const rows = agents.slice(0, settingRows(settings));
  return <NativeWidgetCard title="Agents" subtitle="Your agents and their current state." count={agents.length} href="/agents">
    {rows.length === 0 ? <EmptyResource text="No agents in this scope yet." /> : <ul className="divide-y divide-border">{rows.map((agent) => (
      <li key={agent.id}><button type="button" onClick={() => widgetActions.select({ type: "agent", id: agent.id, label: agent.name, projectId: agent.project_id })} className="flex w-full text-left min-h-[56px] items-center gap-3 px-4 py-2 transition-colors hover:bg-bg-hover">
        <AgentMark icon={agent.icon} name={agent.name} size="sm" />
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-text">{agent.name}</span><span className="block truncate text-[10px] text-text-dim">{projectNames.get(agent.project_id || "") || agent.status || "Ready"}</span></span>
        <StatusPill status={agent.status} />
      </button></li>
    ))}</ul>}
  </NativeWidgetCard>;
}

function NativeAppsWidget({ apps, widgetActions, settings }: { apps: AppRow[]; widgetActions: WidgetActionBridge; settings?: Record<string, unknown> }) {
  const rows = apps.slice(0, settingRows(settings));
  return <NativeWidgetCard title="Apps" subtitle="Installed apps available in this workspace." count={apps.length} href="/apps">
    {rows.length === 0 ? <EmptyResource text="No apps installed in this scope yet." action="Browse apps" href="/apps" /> : <ul className="divide-y divide-border">{rows.map((app) => (
      <li key={app.install_id}><button type="button" onClick={() => widgetActions.select({ type: "app", id: app.install_id, label: app.display_name || app.name, projectId: app.project_id })} className="flex w-full text-left min-h-[56px] items-center gap-3 px-4 py-2 transition-colors hover:bg-bg-hover">
        <AppIcon name={app.display_name || app.name} src={app.icon} iconStyle={app.icon_style} size="sm" />
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-text">{app.display_name || app.name}</span><span className="block truncate text-[10px] text-text-dim">{app.serving ? "Serving" : app.status_message || app.status}</span></span>
        <StatusPill status={app.status} />
      </button></li>
    ))}</ul>}
  </NativeWidgetCard>;
}

function NativeIntegrationsWidget({ connections, widgetActions, settings }: { connections: ConnectionInfo[]; widgetActions: WidgetActionBridge; settings?: Record<string, unknown> }) {
  const rows = connections.slice(0, settingRows(settings));
  return <NativeWidgetCard title="Integrations" subtitle="Connected services and their tools." count={connections.length} href="/integrations">
    {rows.length === 0 ? <EmptyResource text="No integrations connected in this scope yet." action="Connect an integration" href="/integrations" /> : <ul className="divide-y divide-border">{rows.map((connection) => (
      <li key={connection.id}><button type="button" onClick={() => widgetActions.select({ type: "integration", id: connection.id, label: connection.name || connection.app_name, projectId: connection.project_id })} className="flex w-full text-left min-h-[56px] items-center gap-3 px-4 py-2 transition-colors hover:bg-bg-hover">
        <AppIcon name={connection.app_name || connection.name} src={connection.logo} size="sm" />
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-text">{connection.name || connection.app_name}</span><span className="block truncate text-[10px] text-text-dim">{connection.tool_count} tool{connection.tool_count === 1 ? "" : "s"}</span></span>
        <StatusPill status={connection.status} />
      </button></li>
    ))}</ul>}
  </NativeWidgetCard>;
}

function NativeSkillsWidget({ skills, widgetActions, settings }: { skills: Skill[]; widgetActions: WidgetActionBridge; settings?: Record<string, unknown> }) {
  const rows = skills.slice(0, settingRows(settings));
  return <NativeWidgetCard title="Skills" subtitle="Reusable instructions for your agents." count={skills.length} href="/skills">
    {rows.length === 0 ? <EmptyResource text="No skills available in this scope yet." action="Manage skills" href="/skills" /> : <ul className="divide-y divide-border">{rows.map((skill) => (
      <li key={skill.id}><button type="button" onClick={() => widgetActions.select({ type: "skill", id: skill.id, label: skill.name, projectId: skill.project_id })} className="flex w-full text-left min-h-[56px] items-center gap-3 px-4 py-2 transition-colors hover:bg-bg-hover">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-sm text-accent">✦</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-text">{skill.name}</span><span className="block truncate text-[10px] text-text-dim">{skill.app_name || skill.source}</span></span>
        <StatusPill status={skill.enabled ? "enabled" : "disabled"} />
      </button></li>
    ))}</ul>}
  </NativeWidgetCard>;
}

function EmptyResource({ text, action, href }: { text: string; action?: string; href?: string }) {
  return <div className="flex min-h-[112px] items-center px-4 py-5"><div><p className="text-xs font-medium text-text-muted">{text}</p>{action && href && <Link to={href} className="mt-2 inline-block text-[11px] font-semibold text-accent hover:text-accent-hover">{action} →</Link>}</div></div>;
}

function StatusPill({ status }: { status?: string }) {
  const normalized = String(status || "unknown").toLowerCase();
  const classes = ["running", "active", "connected", "enabled", "serving", "ready"].includes(normalized)
    ? "border-green/30 bg-green/10 text-green"
    : ["error", "failed", "disabled"].includes(normalized)
      ? "border-red/30 bg-red/10 text-red"
      : "border-yellow/30 bg-yellow/10 text-yellow";
  return <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold capitalize ${classes}`}>{normalized}</span>;
}

function settingRows(settings?: Record<string, unknown>) {
  const value = Number(settings?.max_rows);
  return Number.isFinite(value) ? Math.max(3, Math.min(12, Math.round(value))) : 6;
}
