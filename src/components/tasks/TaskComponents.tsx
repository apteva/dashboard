import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  agentTasks,
  type Agent,
  type AgentTask,
  type AgentTaskEvent,
  type AgentTaskScheduleInput,
  type AgentTaskStep,
} from "../../api";
import { useTelemetryEvents } from "../../hooks/useTelemetryBus";
import {
  taskIsActive,
  taskIsSchedule,
  taskOwnerLabel,
  taskStateTone,
  taskUpdatedAt,
} from "./taskModel";

export function TaskStatePill({ task }: { task: AgentTask }) {
  if (taskIsSchedule(task) && task.state !== "cancelled" && task.state !== "failed" && task.state !== "completed") {
    const enabled = task.schedule_enabled;
    return (
      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        enabled
          ? "border-blue/30 bg-blue/10 text-blue"
          : "border-border bg-bg-hover text-text-dim"
      }`}>
        {enabled ? "scheduled" : "paused"}
      </span>
    );
  }
  const tone = taskStateTone(task.state);
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.badge}`}>
      {task.state}
    </span>
  );
}

export function TaskProgress({ task, compact = false }: { task: AgentTask; compact?: boolean }) {
  if (taskIsSchedule(task)) {
    return (
      <div className={compact ? "mt-1.5" : "mt-2"}>
        <div className="flex min-w-0 items-center gap-2">
          <p className={`min-w-0 flex-1 truncate ${compact ? "text-[10px]" : "text-[11px]"} text-text-muted`}>
            {formatTaskSchedule(task)}
          </p>
          {task.schedule_enabled && task.next_run_at && (
            <span className="shrink-0 text-[10px] tabular-nums text-text-dim">
              {relativeTime(task.next_run_at)}
            </span>
          )}
        </div>
      </div>
    );
  }
  const tone = taskStateTone(task.state);
  const progress = task.progress == null ? undefined : Math.max(0, Math.min(100, task.progress));
  return (
    <div className={compact ? "mt-1.5" : "mt-2"}>
      <div className="flex min-w-0 items-center gap-2">
        <p className={`min-w-0 flex-1 truncate ${compact ? "text-[10px]" : "text-[11px]"} text-text-muted`}>
          {task.current_step || task.description || defaultTaskDetail(task)}
        </p>
        {progress != null && (
          <span className="shrink-0 text-[10px] tabular-nums text-text-dim">{Math.round(progress)}%</span>
        )}
      </div>
      {progress != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-hover">
          <div className={`h-full transition-[width] duration-300 ${tone.bar}`} style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function TaskList({
  tasks,
  agents,
  selectedId,
  onSelect,
  empty = "No tasks match this view.",
  compact = false,
  wide = false,
}: {
  tasks: AgentTask[];
  agents: Agent[];
  selectedId?: string;
  onSelect: (task: AgentTask) => void;
  empty?: string;
  compact?: boolean;
  wide?: boolean;
}) {
  const names = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents]);
  if (tasks.length === 0) {
    return (
      <div className={`flex items-center justify-center px-4 py-8 text-center text-xs text-text-dim ${wide ? "min-h-56" : "min-h-28"}`}>
        <div>
          <p>{empty}</p>
          {wide && <p className="mt-1 text-[10px] text-text-dim">Create a task to give an agent durable background work.</p>}
        </div>
      </div>
    );
  }
  return (
    <div>
      {wide && (
        <div className="hidden grid-cols-[minmax(18rem,2fr)_minmax(10rem,.75fr)_minmax(9rem,.65fr)_minmax(7rem,.5fr)_1.25rem] gap-4 border-b border-border bg-bg-hover/40 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-text-dim lg:grid">
          <span>Task</span>
          <span>Agent</span>
          <span>Owner</span>
          <span>Updated</span>
          <span />
        </div>
      )}
      <div className="divide-y divide-border">
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onSelect(task)}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 text-left transition-colors hover:bg-bg-hover ${
            compact ? "py-2.5" : "py-3.5"
          } ${wide ? "lg:grid-cols-[minmax(18rem,2fr)_minmax(10rem,.75fr)_minmax(9rem,.65fr)_minmax(7rem,.5fr)_1.25rem] lg:items-center lg:gap-4" : ""} ${
            selectedId === task.id ? "bg-accent/5" : ""
          }`}
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`truncate font-semibold text-text ${compact ? "text-xs" : "text-sm"}`}>{task.title}</span>
              <TaskStatePill task={task} />
            </div>
            <TaskProgress task={task} compact={compact} />
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-text-dim">
              <span className={wide ? "lg:hidden" : ""}>{names.get(task.agent_id) || `Agent #${task.agent_id}`}</span>
              <span className={wide ? "lg:hidden" : ""}>·</span>
              <span className={wide ? "lg:hidden" : ""}>{taskOwnerLabel(task)}</span>
              {task.origin_conversation_id && <><span className={wide ? "lg:hidden" : ""}>·</span><span>From chat</span></>}
            </div>
          </div>
          {wide && (
            <>
              <span className="hidden truncate text-xs text-text-muted lg:block">{names.get(task.agent_id) || `Agent #${task.agent_id}`}</span>
              <span className="hidden truncate text-xs text-text-muted lg:block">{taskOwnerLabel(task)}</span>
              <span className="hidden whitespace-nowrap text-[10px] tabular-nums text-text-dim lg:block">{relativeTime(taskUpdatedAt(task))}</span>
            </>
          )}
          <div className={`flex flex-col items-end justify-between gap-2 ${wide ? "lg:block" : ""}`}>
            <span className={`whitespace-nowrap text-[9px] tabular-nums text-text-dim ${wide ? "lg:hidden" : ""}`}>{relativeTime(taskUpdatedAt(task))}</span>
            <span className="text-sm text-text-dim" aria-hidden="true">→</span>
          </div>
        </button>
      ))}
      </div>
    </div>
  );
}

export function TaskDetailDrawer({
  task,
  agent,
  schedulingEnabled = true,
  onClose,
  onChanged,
}: {
  task: AgentTask | null;
  agent?: Agent;
  schedulingEnabled?: boolean;
  onClose: () => void;
  onChanged?: (task: AgentTask) => void;
}) {
  const [events, setEvents] = useState<AgentTaskEvent[]>([]);
  const [steps, setSteps] = useState<AgentTaskStep[]>([]);
  const [runs, setRuns] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleEditing, setScheduleEditing] = useState(false);
  const [scheduleKind, setScheduleKind] = useState<"once" | "interval" | "cron">("cron");
  const [scheduleExpression, setScheduleExpression] = useState("");
  const [scheduleTimezone, setScheduleTimezone] = useState("UTC");
  const [runNowKey, setRunNowKey] = useState(() => newTaskActionKey());
  const [actionMessage, setActionMessage] = useState("");
  const [error, setError] = useState("");

  const refreshDetails = useCallback((quiet = false) => {
    if (!task) {
      setEvents([]);
      setSteps([]);
      setRuns([]);
      setCancelOpen(false);
      setCancelReason("");
      setError("");
      setScheduleEditing(false);
      setActionMessage("");
      return;
    }
    let cancelled = false;
    if (!quiet) setLoading(true);
    Promise.all([agentTasks.events(task.id), agentTasks.steps(task.id), agentTasks.runs(task.id)])
      .then(([eventResponse, stepResponse, runResponse]) => {
        if (cancelled) return;
        setEvents(eventResponse.events || []);
        setSteps(stepResponse.steps || []);
        setRuns(runResponse.runs || []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [task?.id]);

  useEffect(() => refreshDetails(), [refreshDetails]);
  useEffect(() => {
    setError("");
    setActionMessage("");
  }, [task?.id]);
  useEffect(() => {
    if (!task || !taskIsSchedule(task)) return;
    setScheduleKind(task.schedule_kind || "cron");
    setScheduleExpression(task.schedule_expression || "");
    setScheduleTimezone(task.schedule_timezone || "UTC");
    setScheduleEditing(false);
    setActionMessage("");
    setRunNowKey(newTaskActionKey());
  }, [task?.id, task?.schedule_expression, task?.schedule_timezone, task?.schedule_kind]);
  useEffect(() => {
    const reconcile = () => refreshDetails(true);
    window.addEventListener("apteva.telemetry.gap", reconcile);
    window.addEventListener("apteva.telemetry.reconnected", reconcile);
    return () => {
      window.removeEventListener("apteva.telemetry.gap", reconcile);
      window.removeEventListener("apteva.telemetry.reconnected", reconcile);
    };
  }, [refreshDetails]);
  useTelemetryEvents(task?.agent_id, (event) => {
    if (!event.type.startsWith("task.")) return;
    const eventTask = event.data?.task as AgentTask | undefined;
    const taskEvent = event.data?.task_event as AgentTaskEvent | undefined;
    const belongsToSelectedSchedule = eventTask?.parent_task_id === task?.id;
    if (eventTask?.id !== task?.id && taskEvent?.task_id !== task?.id && !belongsToSelectedSchedule) return;

    // The SSE payload is emitted after the task-event transaction commits, so
    // render that exact event immediately instead of waiting for a second HTTP
    // round trip. Step events also refresh the compact execution-step records;
    // reconnect/gap handling elsewhere performs authoritative reconciliation.
    if (taskEvent?.id) {
      setEvents((current) => mergeTaskEvents(current, taskEvent));
      if (belongsToSelectedSchedule) {
        void agentTasks.runs(task!.id)
          .then((response) => setRuns(response.runs || []))
          .catch(() => {});
      } else if (event.type.startsWith("task.step.")) {
        void agentTasks.steps(taskEvent.task_id)
          .then((response) => setSteps(response.steps || []))
          .catch(() => {});
      }
      return;
    }
    refreshDetails(true);
  });

  if (!task) return null;
  const originHref = task.origin_conversation_id
    ? agent?.kind === "platform_helper"
      ? `/build?session=${encodeURIComponent(task.origin_conversation_id)}`
      : `/chat/${encodeURIComponent(task.origin_conversation_id)}`
    : "";
  const runtimeHref = `/agents/${task.agent_id}?thread=${encodeURIComponent(task.assigned_thread_id)}`;

  const cancelTask = async () => {
    setCancelBusy(true);
    setError("");
    try {
      const response = await agentTasks.cancel(task.id, cancelReason.trim());
      onChanged?.(response.task);
      setCancelOpen(false);
      setCancelReason("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancelBusy(false);
    }
  };

  const changeScheduleState = async (enabled: boolean) => {
    setScheduleBusy(true);
    setError("");
    setActionMessage("");
    try {
      const response = enabled
        ? await agentTasks.resume(task.id)
        : await agentTasks.pause(task.id);
      onChanged?.(response.task);
      setActionMessage(enabled ? "Schedule resumed." : "Schedule paused.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScheduleBusy(false);
    }
  };

  const runScheduleNow = async () => {
    setScheduleBusy(true);
    setError("");
    setActionMessage("");
    try {
      const response = await agentTasks.runNow(task.id, runNowKey);
      setRuns((current) => [response.task, ...current.filter((run) => run.id !== response.task.id)]);
      setRunNowKey(newTaskActionKey());
      setActionMessage(response.delivery_warning
        ? "Run queued. The agent will receive it when available."
        : "Run created and sent to the agent.");
      refreshDetails(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScheduleBusy(false);
    }
  };

  const saveSchedule = async () => {
    setScheduleBusy(true);
    setError("");
    setActionMessage("");
    try {
      const schedule: AgentTaskScheduleInput = {
        kind: scheduleKind,
        timezone: scheduleTimezone.trim() || "UTC",
        ...(scheduleKind === "once"
          ? { at: new Date(scheduleExpression).toISOString() }
          : scheduleKind === "interval"
            ? { every: scheduleExpression.trim() }
            : { cron: scheduleExpression.trim() }),
      };
      const response = await agentTasks.updateSchedule(task.id, schedule);
      onChanged?.(response.task);
      setScheduleEditing(false);
      setActionMessage("Schedule updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScheduleBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={`Task ${task.title}`}>
      <button type="button" className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close task details" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-bg-card shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatePill task={task} />
              <span className="text-[10px] text-text-dim">{taskOwnerLabel(task)}</span>
            </div>
            <h2 className="mt-2 text-base font-bold text-text">{task.title}</h2>
            <p className="mt-1 text-[11px] text-text-dim">Updated {relativeTime(taskUpdatedAt(task))}</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xl text-text-muted hover:bg-bg-hover hover:text-text" aria-label="Close">×</button>
        </header>

        <div className="page-safe-bottom min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Work</h3>
            {task.description && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">{task.description}</p>}
            <TaskProgress task={task} />
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
              <TaskFact label="Agent" value={agent?.name || `Agent #${task.agent_id}`} />
              <TaskFact label="Owner" value={taskOwnerLabel(task)} />
              <TaskFact label="Created" value={formatDate(task.created_at)} />
              <TaskFact label="Last activity" value={formatDate(taskUpdatedAt(task))} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/agents/${task.agent_id}`} className="rounded-md border border-border px-3 py-2 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text">Open agent</Link>
              <Link to={runtimeHref} className="rounded-md border border-border px-3 py-2 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text">Open runtime</Link>
              {originHref && <Link to={originHref} className="rounded-md border border-border px-3 py-2 text-[11px] text-text-muted hover:bg-bg-hover hover:text-text">Open conversation</Link>}
            </div>
          </section>

          {taskIsSchedule(task) && (
            <section className="rounded-lg border border-blue/20 bg-blue/5 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-wide text-blue">Schedule</h3>
                  <p className="mt-1 text-xs text-text">{formatTaskSchedule(task)}</p>
                  <p className="mt-1 text-[10px] text-text-muted">
                    {task.schedule_enabled
                      ? task.next_run_at
                        ? `Next run ${formatDate(task.next_run_at)}`
                        : "No future run is currently calculated."
                      : "Paused — missed occurrences will not be replayed."}
                  </p>
                  {task.schedule_enabled && task.schedule_kind !== "once" && (
                    <p className="mt-1 text-[9px] text-text-dim">
                      Overlapping or stale recurring runs are skipped, never duplicated.
                    </p>
                  )}
                  {!schedulingEnabled && (
                    <p className="mt-1 text-[9px] text-yellow">
                      Scheduling is disabled on this server. The stored rule is retained but will not run.
                    </p>
                  )}
                </div>
                {schedulingEnabled && !scheduleEditing && task.state !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() => setScheduleEditing(true)}
                    className="shrink-0 rounded border border-border px-2.5 py-1.5 text-[10px] font-semibold text-text-muted hover:bg-bg-hover hover:text-text"
                  >
                    Edit
                  </button>
                )}
              </div>

              {scheduleEditing && (
                <div className="mt-3 space-y-2 border-t border-blue/15 pt-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">Type</span>
                      <select
                        value={scheduleKind}
                        onChange={(event) => {
                          const kind = event.target.value as typeof scheduleKind;
                          setScheduleKind(kind);
                          setScheduleExpression(kind === "cron" ? "0 9 * * *" : kind === "interval" ? "24h" : "");
                        }}
                        className="h-9 w-full rounded border border-border bg-bg-input px-2 text-xs text-text outline-none focus:border-accent"
                      >
                        <option value="once">Once</option>
                        <option value="cron">Recurring cron</option>
                        <option value="interval">Interval</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">
                        {scheduleKind === "once" ? "Date and time" : scheduleKind === "cron" ? "Five-field cron" : "Repeat every"}
                      </span>
                      <input
                        type={scheduleKind === "once" ? "datetime-local" : "text"}
                        value={scheduleKind === "once" ? toDateTimeLocal(scheduleExpression) : scheduleExpression}
                        onChange={(event) => setScheduleExpression(event.target.value)}
                        className="h-9 w-full rounded border border-border bg-bg-input px-2 text-xs text-text outline-none focus:border-accent"
                        placeholder={scheduleKind === "cron" ? "0 9 * * *" : scheduleKind === "interval" ? "24h" : ""}
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">Timezone</span>
                    <input
                      value={scheduleTimezone}
                      onChange={(event) => setScheduleTimezone(event.target.value)}
                      className="h-9 w-full rounded border border-border bg-bg-input px-2 text-xs text-text outline-none focus:border-accent"
                      placeholder="UTC"
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setScheduleEditing(false)} disabled={scheduleBusy} className="h-8 rounded border border-border px-3 text-[10px] text-text-muted hover:bg-bg-hover">Cancel</button>
                    <button type="button" onClick={() => void saveSchedule()} disabled={scheduleBusy || !scheduleExpression.trim()} className="h-8 rounded border border-accent bg-accent px-3 text-[10px] font-bold text-bg hover:bg-accent-hover disabled:opacity-40">{scheduleBusy ? "Saving…" : "Save schedule"}</button>
                  </div>
                </div>
              )}

              {task.last_run_at && <p className="mt-2 text-[9px] text-text-dim">Last occurrence created {formatDate(task.last_run_at)}</p>}
            </section>
          )}

          {deliveryProblem(task) && (
            <section className="rounded-lg border border-red/30 bg-red/5 px-3 py-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-red">Delivery needs attention</h3>
              <p className="mt-1 text-xs text-text-muted">{deliveryProblem(task)}</p>
            </section>
          )}

          {(task.result || task.error) && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-text-dim">{task.error ? "Error" : "Result"}</h3>
              <p className={`mt-2 whitespace-pre-wrap rounded-lg border px-3 py-3 text-xs leading-5 ${
                task.error ? "border-red/30 bg-red/5 text-red" : "border-border bg-bg text-text-muted"
              }`}>{task.error || task.result}</p>
            </section>
          )}

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Execution steps</h3>
            {steps.length === 0 ? (
              <p className="mt-2 text-xs text-text-dim">{loading ? "Loading steps…" : "No server-owned execution steps recorded."}</p>
            ) : (
              <div className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
                {steps.map((step) => <TaskStepRow key={step.step_key} step={step} />)}
              </div>
            )}
          </section>

          {taskIsSchedule(task) && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Runs</h3>
              {runs.length === 0 ? (
                <p className="mt-2 text-xs text-text-dim">No occurrences have run yet.</p>
              ) : (
                <div className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => onChanged?.(run)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5 text-left hover:bg-bg-hover"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <TaskStatePill task={run} />
                          <span className="truncate text-[11px] text-text">{run.current_step || run.result || run.description || "Occurrence"}</span>
                        </div>
                        <p className="mt-1 text-[9px] text-text-dim">
                          Scheduled {formatDate(run.scheduled_for || run.created_at)}
                        </p>
                      </div>
                      <span className="text-sm text-text-dim">→</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Timeline</h3>
            {events.length === 0 ? (
              <p className="mt-2 text-xs text-text-dim">{loading ? "Loading history…" : "No task events recorded."}</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {[...events].reverse().map((event) => (
                  <TaskTimelineEvent key={event.id} event={event} />
                ))}
              </ol>
            )}
          </section>

          {error && <p className="rounded-md border border-red/30 bg-red/5 px-3 py-2 text-xs text-red">{error}</p>}
          {actionMessage && <p className="rounded-md border border-green/30 bg-green/5 px-3 py-2 text-xs text-green">{actionMessage}</p>}
        </div>

        {(taskIsActive(task) || (taskIsSchedule(task) && !["cancelled", "failed", "completed"].includes(task.state))) && (
          <footer className="border-t border-border px-4 py-3 sm:px-5">
            {cancelOpen ? (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Cancellation reason <span className="normal-case text-text-dim">(optional)</span></label>
                <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} className="mt-2 w-full resize-none rounded-md border border-border bg-bg-input px-3 py-2 text-xs text-text outline-none focus:border-accent" placeholder="Tell the agent why this work is being stopped." />
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => setCancelOpen(false)} disabled={cancelBusy} className="h-9 rounded-md border border-border px-3 text-xs text-text-muted hover:bg-bg-hover hover:text-text">Keep task</button>
                  <button type="button" onClick={() => void cancelTask()} disabled={cancelBusy} className="h-9 rounded-md border border-red/50 bg-red/10 px-3 text-xs font-bold text-red hover:bg-red/15 disabled:opacity-50">{cancelBusy ? "Cancelling…" : taskIsSchedule(task) ? "Cancel schedule" : "Cancel task"}</button>
                </div>
              </div>
            ) : taskIsSchedule(task) ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => setCancelOpen(true)} disabled={scheduleBusy} className="mr-auto h-9 rounded-md border border-red/40 px-3 text-xs font-semibold text-red hover:bg-red/10 disabled:opacity-40">Cancel schedule</button>
                {schedulingEnabled && (
                  <>
                    <button
                      type="button"
                      onClick={() => void changeScheduleState(!task.schedule_enabled)}
                      disabled={scheduleBusy}
                      className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-40"
                    >
                      {task.schedule_enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runScheduleNow()}
                      disabled={scheduleBusy}
                      className="h-9 rounded-md border border-accent bg-accent px-3 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-40"
                    >
                      {scheduleBusy ? "Working…" : "Run now"}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] text-text-dim">Progress and ownership are controlled by the agent.</p>
                <button type="button" onClick={() => setCancelOpen(true)} className="h-9 rounded-md border border-red/40 px-3 text-xs font-semibold text-red hover:bg-red/10">Cancel task</button>
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

function TaskStepRow({ step }: { step: AgentTaskStep }) {
  const tone = step.state === "failed" ? "text-red" : step.state === "completed" ? "text-green" : "text-accent";
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5">
      <span className={`mt-0.5 text-xs ${tone}`}>{step.state === "completed" ? "✓" : step.state === "failed" ? "!" : "›"}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-text">{step.step_key}</p>
        <p className="mt-0.5 truncate text-[9px] text-text-dim">{step.mcp_server} · {step.tool_name}</p>
        {step.error && <p className="mt-1 text-[10px] text-red">{step.error}</p>}
      </div>
      <span className={`text-[9px] font-bold uppercase ${tone}`}>{step.state}</span>
    </div>
  );
}

function TaskFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wide text-text-dim">{label}</div>
      <div className="mt-0.5 truncate text-[11px] text-text-muted" title={value}>{value}</div>
    </div>
  );
}

function newTaskActionKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `task-ui-${uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function mergeTaskEvents(current: AgentTaskEvent[], incoming: AgentTaskEvent): AgentTaskEvent[] {
  const withoutIncoming = current.filter((event) => event.id !== incoming.id);
  return [...withoutIncoming, incoming].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
  );
}

type TaskEventTone = "active" | "success" | "danger" | "info" | "neutral";

const taskEventToneStyles: Record<TaskEventTone, {
  card: string;
  dot: string;
  title: string;
  progress: string;
}> = {
  active: {
    card: "border-accent/25 bg-accent/5",
    dot: "bg-accent",
    title: "text-accent",
    progress: "bg-accent",
  },
  success: {
    card: "border-green/25 bg-green/5",
    dot: "bg-green",
    title: "text-green",
    progress: "bg-green",
  },
  danger: {
    card: "border-red/30 bg-red/5",
    dot: "bg-red",
    title: "text-red",
    progress: "bg-red",
  },
  info: {
    card: "border-blue/25 bg-blue/5",
    dot: "bg-blue",
    title: "text-blue",
    progress: "bg-blue",
  },
  neutral: {
    card: "border-border bg-bg",
    dot: "bg-text-dim",
    title: "text-text-muted",
    progress: "bg-text-dim",
  },
};

function TaskTimelineEvent({ event }: { event: AgentTaskEvent }) {
  const tone = taskEventTone(event);
  const styles = taskEventToneStyles[tone];
  const progress = eventProgress(event);
  const detail = eventDetail(event);
  const transition = event.from_state && event.to_state && event.from_state !== event.to_state
    ? `${event.from_state} → ${event.to_state}`
    : "";

  return (
    <li
      data-testid={`task-event-${event.id}`}
      data-event-tone={tone}
      className={`rounded-lg border px-3 py-2.5 ${styles.card}`}
    >
      <div className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${styles.dot}`} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className={`text-[11px] font-semibold ${styles.title}`}>{humanizeEvent(event)}</p>
            {progress != null && (
              <span className="rounded border border-current/15 bg-black/10 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-text-muted">
                {Math.round(progress)}%
              </span>
            )}
          </div>
          {detail && (
            <p className={`mt-1 whitespace-pre-wrap text-[10px] leading-4 ${
              tone === "danger" ? "text-red" : "text-text-muted"
            }`}>
              {detail}
            </p>
          )}
        </div>
        <time
          className="whitespace-nowrap text-[9px] tabular-nums text-text-dim"
          dateTime={event.created_at}
          title={formatDate(event.created_at)}
        >
          {relativeTime(event.created_at)}
        </time>
      </div>

      {progress != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/15">
          <div
            className={`h-full transition-[width] duration-300 ${styles.progress}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {(event.thread_id || transition) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-text-dim">
          {event.thread_id && (
            <span className="rounded border border-border/80 bg-black/10 px-1.5 py-0.5">
              {taskEventThreadLabel(event.thread_id)}
            </span>
          )}
          {transition && (
            <span className="rounded border border-border/80 bg-black/10 px-1.5 py-0.5">
              {transition}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function humanizeEvent(event: AgentTaskEvent): string {
  const state = eventDataString(event, "state") || event.to_state;
  const labels: Record<string, string> = {
    created: "Task created",
    assigned: "Execution owner changed",
    updated: "Progress updated",
    state_changed: state ? taskStateEventLabel(state) : "Task state changed",
    step_started: `Started ${String(event.data?.step_key || "execution step")}`,
    step_completed: `Completed ${String(event.data?.step_key || "execution step")}`,
    step_failed: `Failed ${String(event.data?.step_key || "execution step")}`,
    handoff_delivery_delivered: "Main received the task",
    handoff_delivery_failed: "Main handoff failed",
    completion_delivery_delivered: "Outcome delivered to the conversation",
    completion_delivery_failed: "Outcome delivery failed",
    handoff_nudge_claimed: "Main was reminded to start the task",
    schedule_updated: "Schedule updated",
    schedule_paused: "Schedule paused",
    schedule_resumed: "Schedule resumed",
    schedule_occurrence_created: "Scheduled run created",
    schedule_occurrence_skipped: "Scheduled run skipped",
    schedule_run_now: "Immediate run created",
  };
  return labels[event.event_type] || event.event_type.replaceAll("_", " ");
}

function taskStateEventLabel(state: string): string {
  const labels: Record<string, string> = {
    queued: "Task queued",
    running: "Work started",
    waiting: "Task waiting",
    blocked: "Task blocked",
    completed: "Task completed",
    failed: "Task failed",
    cancelled: "Task cancelled",
  };
  return labels[state] || `Task changed to ${state}`;
}

function taskEventTone(event: AgentTaskEvent): TaskEventTone {
  const state = eventDataString(event, "state") || event.to_state;
  if (
    event.event_type.includes("failed") ||
    state === "blocked" ||
    state === "failed"
  ) return "danger";
  if (
    event.event_type === "step_completed" ||
    event.event_type === "completion_delivery_delivered" ||
    state === "completed"
  ) return "success";
  if (
    event.event_type.includes("delivery_") ||
    event.event_type.startsWith("schedule_") ||
    state === "waiting"
  ) return "info";
  if (
    event.event_type === "updated" ||
    event.event_type === "step_started" ||
    state === "running"
  ) return "active";
  return "neutral";
}

function eventProgress(event: AgentTaskEvent): number | null {
  const value = event.data?.progress;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function eventDetail(event: AgentTaskEvent): string {
  const error = eventDataString(event, "error");
  if (error) return error;
  const result = eventDataString(event, "result");
  if (result) return result;
  const currentStep = eventDataString(event, "current_step");
  if (currentStep) return currentStep;
  const detail = eventDataString(event, "detail");
  if (detail) return detail;
  const scheduledFor = eventDataString(event, "scheduled_for");
  const nextRunAt = eventDataString(event, "next_run_at");
  if (scheduledFor || nextRunAt) {
    const parts: string[] = [];
    const reason = eventDataString(event, "reason");
    if (reason === "overlap") parts.push("Skipped because the previous occurrence is still active");
    if (reason === "catchup") parts.push("Skipped stale recurring work after scheduler recovery");
    if (scheduledFor) parts.push(`Occurrence ${formatDate(scheduledFor)}`);
    if (nextRunAt) parts.push(`Next ${formatDate(nextRunAt)}`);
    return parts.join(" · ");
  }

  if (event.event_type === "assigned") {
    const previous = eventDataString(event, "previous_thread_id");
    const assigned = eventDataString(event, "assigned_thread_id");
    if (previous && assigned) {
      return `${taskEventThreadLabel(previous)} handed work to ${taskEventThreadLabel(assigned)}.`;
    }
  }

  if (event.event_type.startsWith("step_")) {
    const server = eventDataString(event, "mcp_server");
    const tool = eventDataString(event, "tool_name");
    if (server && tool) return `${server} · ${tool}`;
  }
  return "";
}

function eventDataString(event: AgentTaskEvent, key: string): string {
  const value = event.data?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function taskEventThreadLabel(threadID: string): string {
  if (threadID === "main") return "Main thread";
  if (threadID.startsWith("api:user:")) return "Created by operator";
  if (threadID.startsWith("chat-")) return "Conversation";
  if (threadID.startsWith("worker-")) return "Worker";
  return threadID;
}

function deliveryProblem(task: AgentTask): string {
  if (task.handoff_delivery_status === "failed") {
    return task.handoff_delivery_error || "The task is saved, but main has not received the handoff yet.";
  }
  if (task.completion_delivery_status === "failed") {
    return task.completion_delivery_error || "The outcome is saved, but it has not reached the originating conversation yet.";
  }
  return "";
}

function defaultTaskDetail(task: AgentTask): string {
  if (task.state === "queued") return "Waiting to start";
  if (task.state === "waiting") return "Waiting for the next event";
  if (task.state === "blocked") return "Needs attention";
  if (task.state === "completed") return "Completed";
  if (task.state === "failed") return "Failed";
  if (task.state === "cancelled") return "Cancelled";
  return "Work in progress";
}

export function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const delta = Math.floor((Date.now() - timestamp) / 1000);
  if (delta < -5) {
    const future = Math.abs(delta);
    if (future < 60) return `in ${future}s`;
    const minutes = Math.floor(future / 60);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `in ${hours}h`;
    return `in ${Math.floor(hours / 24)}d`;
  }
  const seconds = Math.max(0, delta);
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTaskSchedule(task: AgentTask): string {
  const timezone = task.schedule_timezone || "UTC";
  switch (task.schedule_kind) {
    case "once":
      return task.next_run_at
        ? `Once · ${formatDate(task.next_run_at)}`
        : `Once · ${task.schedule_expression || timezone}`;
    case "interval":
      return `Every ${task.schedule_expression || "interval"} · ${timezone}`;
    case "cron":
      return `${task.schedule_expression || "Cron schedule"} · ${timezone}`;
    default:
      return "Scheduled work";
  }
}

function toDateTimeLocal(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
