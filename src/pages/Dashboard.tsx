import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { chat, instances, telemetry, type Agent, type CurrentStatusMessageRow, type InstanceStats } from "../api";
import { NewAgentButton } from "../components/NewAgentButton";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { HomeAgentOperations, HomeUsageSummary } from "../components/dashboard/HomePanels";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";
import {
  ContributionMount,
  contributionsFor,
  defaultWidgetSettings,
  defaultWidgetSize,
  supportedWidgetSizes,
} from "../components/apps/contributions";
import { WidgetCanvas, type WidgetDefinition } from "../components/apps/WidgetCanvas";
import { useInstalledAppsState } from "../components/apps/chatComponents";

const REFRESH_MS = 30_000;

export function Dashboard() {
  usePageTitle("Home");

  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, currentProject, loaded: projectsLoaded } = useProjects();
  const allProjects = searchParams.get("scope") === "all";
  const requestedProject = projects.find((project) => project.id === searchParams.get("project"));
  const selectedProject = allProjects ? undefined : requestedProject || currentProject || undefined;
  const projectId = selectedProject?.id;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<InstanceStats[]>([]);
  const [statuses, setStatuses] = useState<CurrentStatusMessageRow[]>([]);
  const [editingLayout, setEditingLayout] = useState(false);
  const [galleryRequest, setGalleryRequest] = useState(0);
  const [visibleWidgetComponents, setVisibleWidgetComponents] = useState<string[]>([]);
  const { apps: installedApps, ready: installedAppsReady } = useInstalledAppsState(
    projectId,
    allProjects ? "global" : "project",
  );
  const scopeReady = allProjects || (projectsLoaded && (!!projectId || projects.length === 0));
  const needsOverview = visibleWidgetComponents.some((component) =>
    component === "native:usage" || component === "native:activity" || component === "native:agent-activity",
  );

  const overviewScope = useRef(projectId);
  overviewScope.current = projectId;
  const overviewPending = useRef(new Set<string | undefined>());
  const loadOverview = useCallback(() => {
    if (overviewPending.current.has(projectId) || document.hidden) return;
    overviewPending.current.add(projectId);
    Promise.all([
      instances.list(projectId).catch(() => [] as Agent[]),
      telemetry.projectStats(projectId, "24h").catch(() => [] as InstanceStats[]),
      chat.currentStatuses(projectId).catch(() => [] as CurrentStatusMessageRow[]),
    ]).then(([nextAgents, nextStats, nextStatuses]) => {
      if (overviewScope.current !== projectId) return;
      setAgents(nextAgents);
      setStats(nextStats);
      setStatuses(nextStatuses);
    }).finally(() => { overviewPending.current.delete(projectId); });
  }, [projectId]);

  useEffect(() => {
    if (!needsOverview) {
      setAgents([]);
      setStats([]);
      setStatuses([]);
      return;
    }
    loadOverview();
    const timer = window.setInterval(loadOverview, REFRESH_MS);
    window.addEventListener("apteva.statusMessage", loadOverview);
 document.addEventListener("visibilitychange", loadOverview);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("apteva.statusMessage", loadOverview);
 document.removeEventListener("visibilitychange", loadOverview);
    };
  }, [loadOverview, needsOverview]);

  useEffect(() => {
    setVisibleWidgetComponents([]);
    setEditingLayout(false);
  }, [projectId]);

  const handleVisibleComponentsChange = useCallback((components: string[]) => {
    setVisibleWidgetComponents((current) =>
      current.length === components.length && current.every((component, index) => component === components[index])
        ? current
        : components,
    );
  }, []);

  const errorCount = stats.reduce((sum, row) => sum + row.errors, 0);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const appContributions = useMemo(
    () => contributionsFor(installedApps, "dashboard.home", allProjects ? "global" : "project"),
    [allProjects, installedApps],
  );
  const widgetDefinitions = useMemo<WidgetDefinition[]>(() => [
    {
      key: "native:agent-activity",
      label: "Agent activity",
      description: "Current work, progress, blockers, and next steps across your agents.",
      supportedSizes: ["half", "full"],
      defaultSize: "full",
      kind: "builtin",
      render: (instance) => (
        <HomeAgentOperations
          agents={agents}
          statuses={statuses}
          compact={instance.size === "half"}
          showProjects={allProjects}
          projectNames={projectNames}
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
      render: () => <HomeUsageSummary agents={agents} stats={stats} />,
    },
    {
      key: "native:activity",
      label: "Recent activity",
      description: "Significant agent actions and tool events.",
      supportedSizes: ["half", "full"],
      defaultSize: "full",
      kind: "builtin",
      render: () => <ActivityFeed agents={agents} />,
    },
    ...appContributions.map((contribution): WidgetDefinition => ({
      key: contribution.key,
      label: contribution.spec.label || contribution.spec.name,
      description: contribution.spec.description || contribution.app.display_name || contribution.app.name,
      icon: contribution.app.icon,
      iconStyle: contribution.app.icon_style,
      supportedSizes: supportedWidgetSizes(contribution.spec),
      defaultSize: defaultWidgetSize(contribution.spec),
      defaultSettings: defaultWidgetSettings(contribution.spec),
      settingsSchema: contribution.spec.settings_schema,
      suggested: contribution.spec.suggested,
      kind: "app",
      providerLabel: contribution.app.display_name || contribution.app.name,
      render: (instance) => (allProjects || projectId) ? (
        <ContributionMount
          instance={{ ...instance, contribution }}
          apps={installedApps}
          slot="dashboard.home"
          projectId={projectId}
          dashboardScope={allProjects ? "global" : "project"}
        />
      ) : null,
    })),
  ], [agents, allProjects, appContributions, installedApps, projectId, projectNames, stats, statuses]);
  const chooseScope = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    if (value === "all") next.set("scope", "all");
    else { next.delete("scope"); next.set("project", value); }
    setSearchParams(next, { replace: true });
  };
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-text">Home</h1>
                <span className="rounded border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                  {allProjects ? "All projects" : selectedProject?.name || "Current project"}
                </span>
              </div>
              {errorCount > 0 && (
                <Link
                  to={
                    projectId
                      ? `/monitor?project=${encodeURIComponent(projectId)}`
                      : "/monitor"
                  }
                  className="rounded border border-red/30 bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red hover:bg-red/15"
                >
                  {errorCount} error{errorCount === 1 ? "" : "s"}
                </Link>
              )}
            </div>
            <p className="mt-1 text-xs text-text-dim">
              What needs attention and what your agents are doing now.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="min-w-0 sm:w-44">
              <span className="sr-only">Home scope</span>
              <select
                value={allProjects ? "all" : projectId || "all"}
                onChange={(event) => chooseScope(event.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-bg-input px-3 text-xs text-text outline-none focus:border-accent"
              >
                <option value="all">All projects</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setGalleryRequest((value) => value + 1)}
              className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:border-accent hover:text-text"
            >
              Add widget
            </button>
            <button
              type="button"
              onClick={() => setEditingLayout((value) => !value)}
              className={`rounded-md border px-3 py-2 text-xs font-semibold ${editingLayout ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:border-accent hover:text-text"}`}
            >
              {editingLayout ? "Done" : "Edit layout"}
            </button>
            <NewAgentButton />
          </div>
        </div>
      </header>

      <main className="page-safe-bottom flex-1 overflow-auto p-3 sm:p-4">
        <WidgetCanvas
          projectId={projectId}
          layoutScope={allProjects ? "global" : "project"}
          slot="dashboard.home"
          definitions={widgetDefinitions}
          editing={editingLayout}
          onEditingChange={setEditingLayout}
          onVisibleComponentsChange={handleVisibleComponentsChange}
          galleryRequest={galleryRequest}
          definitionsReady={scopeReady && installedAppsReady}
        />
      </main>
    </div>
  );
}
