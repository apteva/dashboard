import { useEffect, useMemo, useState } from "react";
import type { Agent, AgentTask } from "../../api";
import { useTasks } from "../../hooks/useTasks";
import { TaskDetailDrawer, TaskProgress, TaskStatePill } from "./TaskComponents";
import { taskIsActive, taskNeedsAttention } from "./taskModel";

export function ConversationTaskCard({
  projectId,
  conversationId,
  agent,
}: {
  projectId?: string;
  conversationId: string;
  agent: Agent;
}) {
  const { tasks, enabled } = useTasks({
    projectId,
    agentId: agent.id,
    originConversationId: conversationId,
    limit: 20,
  });
  const [selected, setSelected] = useState<AgentTask | null>(null);
  const [dismissedId, setDismissedId] = useState("");
  const visible = useMemo(
    () => tasks.find(taskIsActive) || tasks.find(taskNeedsAttention) || tasks[0],
    [tasks],
  );

  useEffect(() => {
    if (!selected) return;
    const current = tasks.find((task) => task.id === selected.id);
    if (current) setSelected(current);
  }, [selected?.id, tasks]);

  if (!enabled || !visible || visible.id === dismissedId) return null;
  return (
    <>
      <div className="shrink-0 border-b border-border bg-bg-card/70 px-3 py-2">
        <div className="mx-auto flex max-w-4xl items-start gap-3 rounded-md border border-border bg-bg px-3 py-2">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${taskNeedsAttention(visible) ? "bg-red" : taskIsActive(visible) ? "bg-accent animate-pulse motion-reduce:animate-none" : "bg-green"}`} />
          <button type="button" onClick={() => setSelected(visible)} className="min-w-0 flex-1 text-left">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[11px] font-semibold text-text">{visible.title}</span>
              <TaskStatePill task={visible} />
            </div>
            <TaskProgress task={visible} compact />
          </button>
          <button type="button" onClick={() => setSelected(visible)} className="shrink-0 rounded px-2 py-1 text-[10px] font-semibold text-accent hover:bg-accent/10">View</button>
          {!taskIsActive(visible) && (
            <button type="button" onClick={() => setDismissedId(visible.id)} className="shrink-0 rounded px-1 text-sm text-text-dim hover:bg-bg-hover hover:text-text" aria-label="Dismiss completed task">×</button>
          )}
        </div>
      </div>
      <TaskDetailDrawer
        task={selected}
        agent={agent}
        onClose={() => setSelected(null)}
        onChanged={(task) => setSelected(task)}
      />
    </>
  );
}

