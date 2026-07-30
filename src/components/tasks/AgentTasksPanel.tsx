import { useEffect, useState } from "react";
import type { Agent, AgentTask } from "../../api";
import { useTasks } from "../../hooks/useTasks";
import { TaskDetailDrawer, TaskList } from "./TaskComponents";
import { taskIsActive, taskIsTopLevel, taskNeedsAttention } from "./taskModel";

export function AgentTasksPanel({ agent }: { agent: Agent }) {
  const { tasks, schedulingEnabled, loading, error } = useTasks({
    projectId: agent.project_id,
    agentId: agent.id,
    limit: 200,
  });
  const [selected, setSelected] = useState<AgentTask | null>(null);
  const topLevelTasks = tasks.filter(taskIsTopLevel);
  const active = topLevelTasks.filter(taskIsActive).length;
  const attention = topLevelTasks.filter(taskNeedsAttention).length;

  useEffect(() => {
    if (!selected) return;
    const current = tasks.find((task) => task.id === selected.id);
    if (current) setSelected(current);
  }, [selected?.id, tasks]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-xs font-bold text-text">Durable tasks</h2>
          <p className="mt-0.5 text-[10px] text-text-dim">{active} active{attention ? ` · ${attention} need attention` : ""}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="m-4 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-xs text-red">{error}</div>
        ) : loading && tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-text-dim">Loading tasks…</div>
        ) : (
          <TaskList tasks={topLevelTasks} agents={[agent]} selectedId={selected?.id} onSelect={setSelected} compact empty="This agent has no durable tasks." />
        )}
      </div>
      <TaskDetailDrawer task={selected} agent={agent} schedulingEnabled={schedulingEnabled} onClose={() => setSelected(null)} onChanged={setSelected} />
    </div>
  );
}
