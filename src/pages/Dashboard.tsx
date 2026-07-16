import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { instances, telemetry, type Agent, type InstanceStats } from "../api";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { AptevaInbox } from "../components/dashboard/AptevaInbox";
import {
  HomeFocusAgents,
  HomeLiveStatuses,
  HomeUsageSummary,
} from "../components/dashboard/HomePanels";
import { useCurrentStatuses } from "../components/dashboard/CurrentStatuses";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";

const REFRESH_MS = 30_000;

export function Dashboard() {
  usePageTitle("Home");

  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<InstanceStats[]>([]);
  const statuses = useCurrentStatuses(projectId);

  const loadOverview = useCallback(() => {
    Promise.all([
      instances.list(projectId).catch(() => [] as Agent[]),
      telemetry.projectStats(projectId, "24h").catch(() => [] as InstanceStats[]),
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

  const activeCount = statuses.filter((row) => row.state !== "completed" && !row.stale).length;
  const errorCount = stats.reduce((sum, row) => sum + row.errors, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold text-text">Home</h1>
              {activeCount > 0 && (
                <span className="rounded border border-green/25 bg-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green">
                  {activeCount} live
                </span>
              )}
              {errorCount > 0 && (
                <Link
                  to={projectId ? `/monitor?project=${encodeURIComponent(projectId)}` : "/monitor"}
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
          <Link
            to="/agents/new"
            className="touch-target inline-flex items-center justify-center rounded-lg border border-accent bg-accent/10 px-3 text-sm font-bold text-accent hover:bg-accent/15"
          >
            + New agent
          </Link>
        </div>
      </header>

      <main className="page-safe-bottom flex-1 space-y-4 overflow-auto p-3 sm:p-4">
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]">
          <AptevaInbox limit={5} variant="home" />
          <HomeLiveStatuses statuses={statuses} />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.55fr)]">
          <HomeFocusAgents agents={agents} statuses={statuses} />
          <ActivityFeed agents={agents} />
        </div>

        <HomeUsageSummary agents={agents} stats={stats} />
      </main>
    </div>
  );
}
