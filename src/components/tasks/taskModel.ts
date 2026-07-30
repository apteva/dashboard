import type { AgentTask, AgentTaskCounts, AgentTaskState } from "../../api";

export const ACTIVE_TASK_STATES: AgentTaskState[] = ["queued", "running", "waiting", "blocked"];

export function taskIsSchedule(task: AgentTask): boolean {
  return Boolean(task.schedule_kind);
}

export function taskIsScheduleOccurrence(task: AgentTask): boolean {
  return Boolean(task.parent_task_id && task.schedule_occurrence_key);
}

export function taskIsTopLevel(task: AgentTask): boolean {
  return !taskIsScheduleOccurrence(task);
}

export function taskIsActive(task: AgentTask): boolean {
  return !taskIsSchedule(task) && ACTIVE_TASK_STATES.includes(task.state);
}

export function taskNeedsAttention(task: AgentTask): boolean {
  return task.state === "blocked" || task.state === "failed" ||
    task.handoff_delivery_status === "failed" ||
    task.completion_delivery_status === "failed";
}

export function taskIsTerminal(task: AgentTask): boolean {
  return task.state === "completed" || task.state === "failed" || task.state === "cancelled";
}

// A one-time schedule mirrors its terminal occurrence onto the durable parent.
// Keep the parent as the single operational row in that case. Recurring
// schedules remain non-terminal, so a failed occurrence still stays visible.
export function operationalTaskRows(tasks: AgentTask[]): AgentTask[] {
  const terminalParents = new Set(
    tasks.filter((task) => taskIsTopLevel(task) && taskIsTerminal(task)).map((task) => task.id),
  );
  return tasks.filter((task) =>
    !(taskIsScheduleOccurrence(task) && taskIsTerminal(task) && terminalParents.has(task.parent_task_id || "")),
  );
}

export function countAgentTasks(tasks: AgentTask[]): AgentTaskCounts {
  const counts: AgentTaskCounts = {
    active: 0,
    queued: 0,
    running: 0,
    waiting: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    scheduled: 0,
    paused: 0,
  };
  for (const task of tasks) {
    if (taskIsSchedule(task) && task.state !== "cancelled" && task.state !== "failed" && task.state !== "completed") {
      if (task.schedule_enabled) counts.scheduled = (counts.scheduled || 0) + 1;
      else counts.paused = (counts.paused || 0) + 1;
      continue;
    }
    counts[task.state] += 1;
    if (taskIsActive(task)) counts.active += 1;
  }
  return counts;
}

export function taskStateRank(state: AgentTaskState): number {
  switch (state) {
    case "blocked": return 0;
    case "failed": return 1;
    case "running": return 2;
    case "waiting": return 3;
    case "queued": return 4;
    case "completed": return 5;
    case "cancelled": return 6;
  }
}

export function sortAgentTasks(tasks: AgentTask[]): AgentTask[] {
  return [...tasks].sort((a, b) =>
    taskStateRank(a.state) - taskStateRank(b.state) ||
    Date.parse(b.updated_at) - Date.parse(a.updated_at) ||
    b.id.localeCompare(a.id),
  );
}

export function mergeAgentTaskSnapshot(
  current: AgentTask[],
  task: AgentTask,
  matches: (task: AgentTask) => boolean,
  limit = 100,
): AgentTask[] {
  const without = current.filter((row) => row.id !== task.id);
  return matches(task)
    ? sortAgentTasks([task, ...without]).slice(0, limit)
    : without;
}

export function taskOwnerLabel(task: AgentTask): string {
  if (taskIsSchedule(task)) return "Schedule";
  if (task.assigned_thread_id === "main") return "Main";
  if (task.assigned_thread_id.startsWith("chat-")) return "Conversation";
  return "Worker";
}

export function taskStateTone(state: AgentTaskState): {
  badge: string;
  text: string;
  bar: string;
} {
  if (state === "blocked" || state === "failed") {
    return { badge: "border-red/30 bg-red/10 text-red", text: "text-red", bar: "bg-red" };
  }
  if (state === "completed") {
    return { badge: "border-green/30 bg-green/10 text-green", text: "text-green", bar: "bg-green" };
  }
  if (state === "waiting") {
    return { badge: "border-blue/30 bg-blue/10 text-blue", text: "text-blue", bar: "bg-blue" };
  }
  if (state === "cancelled") {
    return { badge: "border-border bg-bg-hover text-text-dim", text: "text-text-dim", bar: "bg-text-dim" };
  }
  return { badge: "border-accent/30 bg-accent/10 text-accent", text: "text-accent", bar: "bg-accent" };
}

export function taskUpdatedAt(task: AgentTask): string {
  return task.last_activity_at || task.updated_at;
}
