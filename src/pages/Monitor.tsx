import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { instances, telemetry, type Agent, type InstanceStats, type Project } from "../api";
import { AptevaInbox } from "../components/dashboard/AptevaInbox";
import { useCurrentStatuses } from "../components/dashboard/CurrentStatuses";
import { MonitorActivity } from "../components/monitor/MonitorActivity";
import { MonitorStatuses } from "../components/monitor/MonitorStatuses";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";

const REFRESH_MS = 30_000;
type MobileSection = "attention" | "live" | "activity";

export function Monitor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects, currentProject } = useProjects();
  const requestedProjectId = searchParams.get("project");
  const requestedProject = projects.find((project) => project.id === requestedProjectId);
  const allProjects = searchParams.get("scope") === "all" || (!requestedProjectId && searchParams.get("scope") !== "project");
  const selectedProject = allProjects ? undefined : requestedProject || currentProject || undefined;
  const projectId = selectedProject?.id;
  const wallboard = searchParams.get("wallboard") === "1";
  const [mobileSection, setMobileSection] = useState<MobileSection>(() =>
    searchParams.get("view") === "activity" ? "activity" : "attention",
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<InstanceStats[]>([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const statuses = useCurrentStatuses(projectId);

  usePageTitle(wallboard ? "Monitor · Wallboard" : "Monitor");

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const scopeKey = allProjects ? "all" : projectId || "none";

  const loadOverview = useCallback(() => {
    Promise.all([
      instances.list(projectId).catch(() => [] as Agent[]),
      telemetry.projectStats(projectId, "24h").catch(() => [] as InstanceStats[]),
    ]).then(([nextAgents, nextStats]) => {
      setAgents(nextAgents);
      setStats(nextStats);
      setRefreshedAt(Date.now());
    });
  }, [projectId]);

  useEffect(() => {
    loadOverview();
    const timer = window.setInterval(loadOverview, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  useEffect(() => {
    if (searchParams.get("view") === "activity") setMobileSection("activity");
  }, [searchParams]);

  // Monitor owns the one shared telemetry stream while it is mounted.
  // "*" means the server's all-user-agents stream with no project filter.
  // On exit, restore the normal sidebar-selected project scope.
  useEffect(() => {
    const bus = window.__aptevaTelemetryBus;
    if (!bus) return;
    bus.setProjectId(allProjects ? "*" : projectId || null);
    return () => bus.setProjectId(currentProject?.id ?? null);
  }, [allProjects, currentProject?.id, projectId]);

  const counts = useMemo(() => ({
    working: statuses.filter((row) => row.state === "working").length,
    waiting: statuses.filter((row) => row.state === "waiting").length,
    blocked: statuses.filter((row) => row.state === "blocked").length,
    errors: stats.reduce((sum, row) => sum + row.errors, 0),
  }), [stats, statuses]);

  const chooseScope = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    if (value === "all") {
      next.set("scope", "all");
      next.delete("project");
    } else {
      next.delete("scope");
      next.set("project", value);
    }
    setSearchParams(next, { replace: true });
  };

  const chooseMobileSection = (section: MobileSection) => {
    setMobileSection(section);
    window.requestAnimationFrame(() => {
      if (mainRef.current) mainRef.current.scrollTop = 0;
    });
  };

  const toggleWallboard = async () => {
    const next = new URLSearchParams(searchParams);
    if (wallboard) {
      next.delete("wallboard");
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    } else {
      next.set("wallboard", "1");
      await document.documentElement.requestFullscreen?.().catch(() => {});
    }
    setSearchParams(next, { replace: true });
  };

  const scopeLabel = allProjects ? "All projects" : selectedProject?.name || "Current project";

  return (
    <div className={`flex h-full flex-col overflow-hidden bg-bg ${wallboard ? "fixed inset-0 z-[100] h-dvh" : ""}`}>
      <header className={`shrink-0 border-b border-border ${wallboard ? "px-5 py-3" : "px-4 py-3 sm:px-6 sm:py-4"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className={`${wallboard ? "text-xl" : "text-lg"} font-bold text-text`}>Monitor</h1>
              <span className="inline-flex items-center gap-1.5 rounded border border-green/25 bg-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-40 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
                </span>
                Live
              </span>
            </div>
            <p className="mt-1 text-xs text-text-dim">
              System-wide work, approvals, and significant activity · {scopeLabel}
              {refreshedAt && <span className="hidden sm:inline"> · synced {new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-initial">
            <label className="min-w-0 flex-1 sm:w-52 sm:flex-none">
              <span className="sr-only">Monitor scope</span>
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
              onClick={() => void toggleWallboard()}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-xs text-text-muted transition-colors hover:border-text-muted hover:text-text"
            >
              {wallboard ? "Exit wallboard" : "Wallboard"}
            </button>
          </div>
        </div>
      </header>

      <main ref={mainRef} className={`page-safe-bottom flex-1 overflow-auto ${wallboard ? "p-3" : "p-3 sm:p-4"}`}>
        <nav className="sticky top-0 z-10 mb-3 grid grid-cols-3 rounded-lg border border-border bg-bg-card p-1 md:hidden" aria-label="Monitor sections">
          {([
            ["attention", `Attention${attentionCount ? ` ${attentionCount}` : ""}`],
            ["live", `Live ${counts.working + counts.waiting + counts.blocked}`],
            ["activity", "Activity"],
          ] as Array<[MobileSection, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseMobileSection(value)}
              className={`min-h-9 rounded-md px-2 text-[11px] font-medium ${mobileSection === value ? "bg-bg-hover text-text" : "text-text-muted"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        <SummaryStrip
          attention={attentionCount}
          working={counts.working}
          waiting={counts.waiting}
          blocked={counts.blocked}
          errors={counts.errors}
          agents={agents.length}
        />

        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
          <div className="space-y-4">
            <div className={mobileSection === "live" ? "block" : "hidden md:block"}>
              <MonitorStatuses
                agents={agents}
                statuses={statuses}
                projectNames={projectNames}
                showProjects={allProjects}
              />
            </div>
            <div className={mobileSection === "activity" ? "block" : "hidden md:block"}>
              <MonitorActivity
                agents={agents}
                scopeKey={scopeKey}
                projectNames={projectNames}
                showProjects={allProjects}
                wallboard={wallboard}
              />
            </div>
          </div>

          <div className={mobileSection === "attention" ? "block" : "hidden md:block"}>
            <AptevaInbox
              allProjects={allProjects}
              projectId={projectId}
              limit={40}
              variant="monitor"
              onCountChange={setAttentionCount}
            />
          </div>
        </div>

        <div className={`mt-4 ${mobileSection === "live" ? "block" : "hidden md:block"}`}>
          <ProjectHealth
            projects={allProjects ? projects : selectedProject ? [selectedProject] : []}
            agents={agents}
            stats={stats}
            statuses={statuses}
            onSelect={chooseScope}
            showProjects={allProjects}
          />
        </div>
      </main>
    </div>
  );
}

function SummaryStrip({
  attention,
  working,
  waiting,
  blocked,
  errors,
  agents,
}: {
  attention: number;
  working: number;
  waiting: number;
  blocked: number;
  errors: number;
  agents: number;
}) {
  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-bg-card sm:grid-cols-3 xl:grid-cols-6">
      <SummaryMetric label="Needs attention" value={attention} tone={attention > 0 ? "accent" : "default"} />
      <SummaryMetric label="Working" value={working} tone={working > 0 ? "green" : "default"} />
      <SummaryMetric label="Waiting" value={waiting} tone={waiting > 0 ? "blue" : "default"} />
      <SummaryMetric label="Blocked" value={blocked} tone={blocked > 0 ? "red" : "default"} />
      <SummaryMetric label="Errors · 24h" value={errors} tone={errors > 0 ? "red" : "default"} />
      <SummaryMetric label="Agents" value={agents} tone="default" />
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "accent" | "green" | "blue" | "red";
}) {
  const valueTone = tone === "accent"
    ? "text-accent"
    : tone === "green"
      ? "text-green"
      : tone === "blue"
        ? "text-blue"
        : tone === "red"
          ? "text-red"
          : "text-text";
  return (
    <div className="border-b border-r border-border px-4 py-3 last:border-r-0 sm:[&:nth-child(n+4)]:border-b-0 xl:border-b-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-text-dim">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valueTone}`}>{value}</div>
    </div>
  );
}

function ProjectHealth({
  projects,
  agents,
  stats,
  statuses,
  onSelect,
  showProjects,
}: {
  projects: Project[];
  agents: Agent[];
  stats: InstanceStats[];
  statuses: ReturnType<typeof useCurrentStatuses>;
  onSelect: (projectId: string) => void;
  showProjects: boolean;
}) {
  const cards = projects.map((project) => {
    const projectAgents = agents.filter((agent) => agent.project_id === project.id);
    const projectAgentIds = new Set(projectAgents.map((agent) => agent.id));
    const projectStatuses = statuses.filter((row) => row.project_id === project.id);
    const projectStats = stats.filter((row) => projectAgentIds.has(row.instance_id));
    return {
      project,
      agents: projectAgents.length,
      running: projectAgents.filter((agent) => agent.status === "running").length,
      blocked: projectStatuses.filter((row) => row.state === "blocked").length,
      errors: projectStats.reduce((sum, row) => sum + row.errors, 0),
    };
  }).sort((a, b) => (b.blocked + b.errors) - (a.blocked + a.errors) || a.project.name.localeCompare(b.project.name));

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-text">Project health</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">Running agents, blocks, and errors during the last 24 hours</p>
        </div>
        {showProjects && <span className="text-[11px] tabular-nums text-text-dim">{cards.length} projects</span>}
      </header>
      {cards.length === 0 ? (
        <div className="px-4 py-6 text-xs text-text-dim">No projects in this scope.</div>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
          {cards.map((card) => {
            const needsAttention = card.blocked > 0 || card.errors > 0;
            return (
              <button
                key={card.project.id}
                type="button"
                onClick={() => onSelect(card.project.id)}
                className="min-w-0 border-border px-4 py-3 text-left transition-colors hover:bg-bg-hover sm:border-r"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-xs font-semibold text-text">{card.project.name}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${needsAttention ? "bg-red" : card.running > 0 ? "bg-green" : "bg-text-dim"}`} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-dim">
                  <span><strong className="text-text-muted">{card.running}</strong> / {card.agents} running</span>
                  <span className={card.blocked > 0 ? "text-red" : ""}>{card.blocked} blocked</span>
                  <span className={card.errors > 0 ? "text-red" : ""}>{card.errors} errors</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
