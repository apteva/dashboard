import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Agent, AgentTask } from "../../api";
import { TaskDetailDrawer, TaskList } from "./TaskComponents";
import { operationalTaskRows, taskIsActive, taskNeedsAttention } from "./taskModel";

export function HomeTasksPanel({
  agents,
  tasks,
  enabled,
  loading,
}: {
  agents: Agent[];
  tasks: AgentTask[];
  enabled?: boolean;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<AgentTask | null>(null);
  const active = useMemo(
    () => operationalTaskRows(tasks).filter((task) => taskIsActive(task) || taskNeedsAttention(task)),
    [tasks],
  );
  const visible = active.slice(0, 5);
  useSelectedTaskSync(tasks, selected, setSelected);
  if (enabled === false) return null;
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-card xl:h-[460px]">
      <TaskPanelHeader title="Active work" subtitle="Live task progress and work needing attention" count={active.length} />
      {loading && tasks.length === 0 ? (
        <div className="flex min-h-28 flex-1 items-center justify-center text-xs text-text-dim">Loading tasks…</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskList tasks={visible} agents={agents} selectedId={selected?.id} onSelect={setSelected} compact empty="No active tracked work." />
        </div>
      )}
      <TaskDetailDrawer task={selected} agent={selected ? agents.find((agent) => agent.id === selected.agent_id) : undefined} onClose={() => setSelected(null)} onChanged={setSelected} />
    </section>
  );
}

export function MonitorTasksPanel({
  agents,
  tasks,
  enabled,
  loading,
  allProjects = false,
}: {
  agents: Agent[];
  tasks: AgentTask[];
  enabled?: boolean;
  loading: boolean;
  allProjects?: boolean;
}) {
  const [selected, setSelected] = useState<AgentTask | null>(null);
  const active = useMemo(
    () => operationalTaskRows(tasks).filter((task) => taskNeedsAttention(task) || taskIsActive(task)),
    [tasks],
  );
  const visible = active.slice(0, 8);
  useSelectedTaskSync(tasks, selected, setSelected);
  if (enabled === false) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg-card">
      <TaskPanelHeader
        title="Live work"
        subtitle={allProjects ? "Tracked execution across accessible projects" : "Tracked execution in this project"}
        count={active.length}
      />
      {loading && tasks.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-xs text-text-dim">Loading tasks…</div>
      ) : (
        <TaskList tasks={visible} agents={agents} selectedId={selected?.id} onSelect={setSelected} compact empty="No active durable tasks." />
      )}
      <TaskDetailDrawer task={selected} agent={selected ? agents.find((agent) => agent.id === selected.agent_id) : undefined} onClose={() => setSelected(null)} onChanged={setSelected} />
    </section>
  );
}

function TaskPanelHeader({ title, subtitle, count }: { title: string; subtitle: string; count: number }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-text">{title}</h2>
          {count > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted">{count}</span>}
        </div>
        <p className="mt-0.5 text-[11px] text-text-dim">{subtitle}</p>
      </div>
      <Link to="/tasks" className="shrink-0 pt-0.5 text-[11px] text-text-muted hover:text-text">View tasks →</Link>
    </div>
  );
}

function useSelectedTaskSync(
  tasks: AgentTask[],
  selected: AgentTask | null,
  setSelected: (task: AgentTask | null) => void,
) {
  useEffect(() => {
    if (!selected) return;
    const current = tasks.find((task) => task.id === selected.id);
    if (current) setSelected(current);
  }, [selected?.id, tasks]);
}
