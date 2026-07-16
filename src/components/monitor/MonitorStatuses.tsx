import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Agent, CurrentStatusMessageRow } from "../../api";
import { AgentCurrentStatus } from "../dashboard/CurrentStatuses";

export function MonitorStatuses({
  agents,
  statuses,
  projectNames,
  showProjects,
}: {
  agents: Agent[];
  statuses: CurrentStatusMessageRow[];
  projectNames: Map<string, string>;
  showProjects: boolean;
}) {
  const statusByAgent = useMemo(
    () => new Map(statuses.map((row) => [row.instance_id, row])),
    [statuses],
  );
  const active = useMemo(
    () => statuses
      .filter((row) => row.state !== "completed")
      .sort((a, b) => statusRank(a) - statusRank(b) || Date.parse(b.message.created_at) - Date.parse(a.message.created_at)),
    [statuses],
  );
  const completed = useMemo(
    () => statuses
      .filter((row) => row.state === "completed")
      .sort((a, b) => Date.parse(b.message.created_at) - Date.parse(a.message.created_at)),
    [statuses],
  );
  const unreported = useMemo(
    () => agents
      .filter((agent) => !statusByAgent.has(agent.id))
      .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || a.name.localeCompare(b.name)),
    [agents, statusByAgent],
  );

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-text">Live now</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">The latest status reported by every agent</p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
          {statuses.length} / {agents.length} reported
        </span>
      </header>

      {active.length === 0 ? (
        <div className="border-b border-border px-4 py-5">
          <p className="text-xs font-medium text-text-muted">No active work reported</p>
          <p className="mt-1 text-[11px] text-text-dim">Completed and unreported agents remain available below.</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {active.map((row) => (
            <StatusRow
              key={row.instance_id}
              row={row}
              projectName={projectNames.get(row.project_id)}
              showProject={showProjects}
            />
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs text-text-muted hover:bg-bg-hover hover:text-text [&::-webkit-details-marker]:hidden">
            <span className="leading-none">Recently completed</span>
            <span className="flex h-5 shrink-0 items-center gap-2 text-text-dim">
              <span className="inline-flex h-5 min-w-5 items-center justify-center text-[11px] leading-none tabular-nums">
                {completed.length}
              </span>
              <ChevronDown />
            </span>
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {completed.map((row) => (
              <StatusRow
                key={row.instance_id}
                row={row}
                projectName={projectNames.get(row.project_id)}
                showProject={showProjects}
              />
            ))}
          </div>
        </details>
      )}

      {unreported.length > 0 && (
        <details className="group border-t border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs text-text-muted hover:bg-bg-hover hover:text-text [&::-webkit-details-marker]:hidden">
            <span className="leading-none">No status reported</span>
            <span className="flex h-5 shrink-0 items-center gap-2 text-text-dim">
              <span className="inline-flex h-5 min-w-5 items-center justify-center text-[11px] leading-none tabular-nums">
                {unreported.length}
              </span>
              <ChevronDown />
            </span>
          </summary>
          <div className="divide-y divide-border border-t border-border">
            {unreported.map((agent) => (
              <Link
                key={agent.id}
                to={`/agents/${agent.id}`}
                className="grid min-h-[70px] grid-cols-[minmax(105px,0.7fr)_minmax(0,1.3fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-hover"
              >
                <AgentIdentity
                  agentId={agent.id}
                  name={agent.name}
                  projectName={agent.project_id ? projectNames.get(agent.project_id) : undefined}
                  showProject={showProjects}
                />
                <AgentCurrentStatus compact showFallback showNextFallback />
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${agent.status === "running" ? "border-green/25 bg-green/10 text-green" : "border-border text-text-dim"}`}>
                  {agent.status}
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ChevronDown() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 4.5 3 3 3-3" />
    </svg>
  );
}

function StatusRow({
  row,
  projectName,
  showProject,
}: {
  row: CurrentStatusMessageRow;
  projectName?: string;
  showProject: boolean;
}) {
  return (
    <Link
      to={`/agents/${row.instance_id}`}
      className="grid min-h-[70px] grid-cols-[minmax(105px,0.7fr)_minmax(0,1.3fr)] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-hover"
    >
      <AgentIdentity
        agentId={row.instance_id}
        name={row.instance_name}
        projectName={projectName}
        showProject={showProject}
      />
      <AgentCurrentStatus status={row} compact showAge showNextFallback />
    </Link>
  );
}

function AgentIdentity({
  agentId,
  name,
  projectName,
  showProject,
}: {
  agentId: number;
  name: string;
  projectName?: string;
  showProject: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs font-semibold text-text">{name}</div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-text-dim">
        <span>#{agentId}</span>
        {showProject && projectName && (
          <>
            <span>·</span>
            <span className="truncate">{projectName}</span>
          </>
        )}
      </div>
    </div>
  );
}

function statusRank(row: CurrentStatusMessageRow) {
  if (row.state === "blocked") return 0;
  if (row.state === "working") return 1;
  if (row.state === "waiting") return 2;
  return 3;
}
