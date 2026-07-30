import { useEffect, useMemo, useState } from "react";
import { instances, type Agent, type AgentTask } from "../api";
import { NewTaskModal } from "../components/tasks/NewTaskModal";
import { TaskDetailDrawer, TaskList } from "../components/tasks/TaskComponents";
import { countAgentTasks, taskIsActive, taskIsSchedule, taskIsTopLevel, taskNeedsAttention } from "../components/tasks/taskModel";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";
import { useTasks } from "../hooks/useTasks";
import { useTelemetryConnectionState } from "../hooks/useTelemetryBus";

type TaskView = "active" | "scheduled" | "attention" | "completed" | "all";

export function Tasks() {
  usePageTitle("Tasks");
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [view, setView] = useState<TaskView>("active");
  const [agentId, setAgentId] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AgentTask | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const live = useTelemetryConnectionState();
  const { tasks, enabled, schedulingEnabled, loading, error, refresh, upsert } = useTasks({ projectId, limit: 500 });

  useEffect(() => {
    if (!projectId) {
      setAgents([]);
      return;
    }
    let cancelled = false;
    instances.list(projectId)
      .then((rows) => { if (!cancelled) setAgents(rows || []); })
      .catch(() => { if (!cancelled) setAgents([]); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!selected) return;
    const current = tasks.find((task) => task.id === selected.id);
    if (current) setSelected(current);
  }, [selected?.id, tasks]);

  const rootTasks = useMemo(
    () => tasks.filter(taskIsTopLevel),
    [tasks],
  );

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rootTasks.filter((task) => {
      if (agentId && task.agent_id !== agentId) return false;
      if (view === "active" && !taskIsActive(task)) return false;
      if (view === "scheduled" && (!taskIsSchedule(task) || ["cancelled", "failed", "completed"].includes(task.state))) return false;
      if (view === "attention" && !taskNeedsAttention(task)) return false;
      if (view === "completed" && task.state !== "completed") return false;
      if (normalized && !`${task.title} ${task.description || ""} ${task.current_step || ""} ${task.result || ""} ${task.error || ""}`.toLowerCase().includes(normalized)) return false;
      return true;
    });
  }, [agentId, query, rootTasks, view]);
  // The page loads every task state, so card snapshots from SSE can also drive
  // the tab totals immediately. The quiet API refresh remains reconciliation,
  // not a prerequisite for visible progress.
  const liveCounts = useMemo(() => countAgentTasks(rootTasks), [rootTasks]);

  if (enabled === false) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-bg-card p-6 text-center">
          <h1 className="text-base font-bold text-text">Task tracking is disabled</h1>
          <p className="mt-2 text-xs leading-5 text-text-muted">Enable <code className="text-text">APTEVA_TASK_TRACKING</code> on the server to expose durable agent work here.</p>
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: TaskView; label: string; count?: number }> = [
    { id: "active", label: "Active", count: liveCounts.active },
    { id: "scheduled", label: "Scheduled", count: (liveCounts.scheduled || 0) + (liveCounts.paused || 0) },
    { id: "attention", label: "Needs attention", count: liveCounts.blocked + liveCounts.failed },
    { id: "completed", label: "Completed", count: liveCounts.completed },
    { id: "all", label: "All" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base font-bold text-text">Tasks</h1>
              {enabled && (
                <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  live === "open" ? "border-green/25 bg-green/10 text-green" : "border-yellow/25 bg-yellow/10 text-yellow"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${live === "open" ? "bg-green" : "bg-yellow"}`} />
                  {live === "open" ? "Live" : "Reconnecting"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-text-muted">Durable work owned by main, conversations, and workers.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={agents.length === 0}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-bg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            New Task
          </button>
        </div>
      </header>

      <div className="flex max-w-full shrink-0 gap-0 overflow-x-auto border-b border-border px-4 sm:px-6" role="tablist" aria-label="Task views">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            role="tab"
            aria-selected={view === tab.id}
            className={`touch-target -mb-px shrink-0 whitespace-nowrap border-b px-3 py-2 text-xs transition-colors ${
              view === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {tab.label}{tab.count ? ` ${tab.count}` : ""}
          </button>
        ))}
      </div>

      <main className="page-safe-bottom min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-bg-card p-2 sm:flex-row sm:items-center">
          <select value={agentId} onChange={(event) => setAgentId(Number(event.target.value))} className="h-10 min-w-0 rounded-lg border border-border bg-bg-input px-3 text-xs text-text outline-none focus:border-accent sm:w-56" aria-label="Filter tasks by agent">
            <option value={0}>All agents</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <label className="relative min-w-0 flex-1 sm:max-w-xl">
            <span className="sr-only">Search tasks</span>
            <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="8.5" cy="8.5" r="5" />
              <path d="m12.3 12.3 4 4" />
            </svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks…" className="h-10 w-full min-w-0 rounded-lg border border-border bg-bg-input pl-9 pr-3 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent" />
          </label>
          <span className="whitespace-nowrap px-2 text-[10px] text-text-dim sm:ml-auto">{visible.length} shown</span>
        </div>

        {notice && (
          <div className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
            notice.startsWith("Task saved")
              ? "border-yellow/30 bg-yellow/5 text-yellow"
              : "border-green/30 bg-green/5 text-green"
          }`}>
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice("")} className="text-current opacity-70 hover:opacity-100" aria-label="Dismiss notification">×</button>
          </div>
        )}

        <section className="w-full overflow-hidden rounded-lg border border-border bg-bg-card">
          {error ? (
            <div className="m-4 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-xs text-red">{error}</div>
          ) : loading && tasks.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center text-xs text-text-dim">Loading tasks…</div>
          ) : (
            <TaskList
              tasks={visible}
              agents={agents}
              selectedId={selected?.id}
              onSelect={setSelected}
              empty={query ? "No tasks match this search." : view === "active" ? "No active durable work." : "No tasks match this view."}
              wide
            />
          )}
        </section>
      </main>

      <TaskDetailDrawer
        task={selected}
        agent={selected ? agents.find((agent) => agent.id === selected.agent_id) : undefined}
        schedulingEnabled={schedulingEnabled}
        onClose={() => setSelected(null)}
        onChanged={setSelected}
      />
      <NewTaskModal
        open={createOpen}
        agents={agents}
        preferredAgentId={agentId || undefined}
        schedulingEnabled={schedulingEnabled}
        onClose={() => setCreateOpen(false)}
        onCreated={(task, deliveryWarning) => {
          setCreateOpen(false);
          // Do not wait for the SSE event or the reconciliation request before
          // showing the task the create API has already confirmed.
          upsert(task);
          setSelected(task);
          setAgentId(task.agent_id);
          setQuery("");
          setView(task.schedule_kind ? "scheduled" : "active");
          setNotice(deliveryWarning
            ? "Task saved. The agent is currently unavailable; delivery will retry when it starts."
            : task.schedule_kind
              ? `Task scheduled. Next run ${task.next_run_at ? new Date(task.next_run_at).toLocaleString() : "will be calculated by the server"}.`
              : "Task created and assigned to the agent’s main thread.");
          void refresh(true);
        }}
      />
    </div>
  );
}
