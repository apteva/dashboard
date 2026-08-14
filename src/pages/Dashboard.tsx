import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { instances, telemetry, type Agent, type InstanceStats } from "../api";
import { NewAgentButton } from "../components/NewAgentButton";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { AptevaInbox } from "../components/dashboard/AptevaInbox";
import { HomeUsageSummary } from "../components/dashboard/HomePanels";
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
import { useInstalledApps } from "../components/apps/chatComponents";

const REFRESH_MS = 30_000;

export function Dashboard() {
  usePageTitle("Home");

  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<InstanceStats[]>([]);
  const [editingLayout, setEditingLayout] = useState(false);
  const [galleryRequest, setGalleryRequest] = useState(0);
  const installedApps = useInstalledApps(projectId);

  const loadOverview = useCallback(() => {
    Promise.all([
      instances.list(projectId).catch(() => [] as Agent[]),
      telemetry
        .projectStats(projectId, "24h")
        .catch(() => [] as InstanceStats[]),
    ]).then(([nextAgents, nextStats]) => {
      setAgents(nextAgents);
      setStats(nextStats);
    });
  }, [projectId]);

  useEffect(() => {
    loadOverview();
    const timer = window.setInterval(loadOverview, REFRESH_MS);
    window.addEventListener("apteva.statusMessage", loadOverview);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("apteva.statusMessage", loadOverview);
    };
  }, [loadOverview]);

  const errorCount = stats.reduce((sum, row) => sum + row.errors, 0);
  const appContributions = useMemo(
    () => contributionsFor(installedApps, "dashboard.home"),
    [installedApps],
  );
  const widgetDefinitions = useMemo<WidgetDefinition[]>(() => [
    {
      key: "native:usage",
      label: "Usage summary",
      description: "Agents, calls, tokens, errors, and cost for the last 24 hours.",
      supportedSizes: ["full"],
      defaultSize: "full",
      render: () => <HomeUsageSummary agents={agents} stats={stats} />,
    },
    {
      key: "native:inbox",
      label: "Inbox",
      description: "Approvals, reports, and alerts from your agents.",
      supportedSizes: ["half", "full"],
      defaultSize: "half",
      render: () => <AptevaInbox projectId={projectId} limit={5} variant="home" />,
    },
    {
      key: "native:activity",
      label: "Recent activity",
      description: "Significant agent actions and tool events.",
      supportedSizes: ["half", "full"],
      defaultSize: "full",
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
      render: (instance) => projectId ? (
        <ContributionMount
          instance={{ ...instance, contribution }}
          apps={installedApps}
          slot="dashboard.home"
          projectId={projectId}
        />
      ) : null,
    })),
  ], [agents, appContributions, installedApps, projectId, stats]);
  const defaultWidgets = useMemo(() => [
    { id: "native:usage", component: "native:usage", size: "full" as const },
    { id: "native:inbox", component: "native:inbox", size: "half" as const },
    { id: "native:activity", component: "native:activity", size: "full" as const },
  ], []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-text">Home</h1>
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
          slot="dashboard.home"
          definitions={widgetDefinitions}
          defaults={defaultWidgets}
          editing={editingLayout}
          onEditingChange={setEditingLayout}
          mergeLegacyDefaults
          galleryRequest={galleryRequest}
        />
      </main>
    </div>
  );
}
