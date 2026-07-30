import { useEffect, useMemo, useState } from "react";
import {
  agentTasks,
  type Agent,
  type AgentTask,
  type AgentTaskScheduleInput,
} from "../../api";
import { Modal } from "../Modal";

export function NewTaskModal({
  open,
  agents,
  preferredAgentId,
  schedulingEnabled = true,
  onClose,
  onCreated,
}: {
  open: boolean;
  agents: Agent[];
  preferredAgentId?: number;
  schedulingEnabled?: boolean;
  onClose: () => void;
  onCreated: (task: AgentTask, deliveryWarning?: string) => void;
}) {
  const defaultAgentId = useMemo(() => {
    if (preferredAgentId && agents.some((agent) => agent.id === preferredAgentId)) {
      return preferredAgentId;
    }
    return agents.find((agent) => agent.status === "running")?.id || agents[0]?.id || 0;
  }, [agents, preferredAgentId]);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"now" | "once" | "cron" | "interval">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [intervalExpression, setIntervalExpression] = useState("24h");
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [idempotencyKey, setIdempotencyKey] = useState(() => newTaskIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAgentId(defaultAgentId);
    setTitle("");
    setDescription("");
    setScheduleMode("now");
    setScheduledAt("");
    setCronExpression("0 9 * * *");
    setIntervalExpression("24h");
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setIdempotencyKey(newTaskIdempotencyKey());
    setBusy(false);
    setError("");
  }, [defaultAgentId, open]);

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!agentId || !cleanTitle) return;
    setBusy(true);
    setError("");
    try {
      let schedule: AgentTaskScheduleInput | undefined;
      if (scheduleMode === "once") {
        if (!scheduledAt) {
          throw new Error("Choose when this task should run.");
        }
        schedule = {
          kind: "once",
          at: new Date(scheduledAt).toISOString(),
          timezone,
        };
      } else if (scheduleMode === "cron") {
        schedule = { kind: "cron", cron: cronExpression.trim(), timezone };
      } else if (scheduleMode === "interval") {
        schedule = { kind: "interval", every: intervalExpression.trim(), timezone };
      }
      const response = await agentTasks.create({
        agent_id: agentId,
        title: cleanTitle,
        description: description.trim() || undefined,
        idempotency_key: idempotencyKey,
        ...(schedule ? { schedule } : {}),
      });
      onCreated(response.task, response.delivery_warning);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} width="max-w-lg" ariaLabel="Create task">
      <form onSubmit={submit} className="page-safe-bottom flex max-h-[90dvh] w-full flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-text">Create task</h2>
            <p className="mt-0.5 text-[11px] text-text-muted">Durable work for an agent’s main thread.</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="touch-target inline-flex h-11 w-11 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-40"
            aria-label="Close create task"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {agents.length === 0 ? (
            <div className="rounded border border-yellow/30 bg-yellow/5 px-3 py-2 text-xs text-yellow">
              This project has no agents available for task assignment.
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Agent</span>
              <select
                id="new-task-agent"
                value={agentId}
                onChange={(event) => setAgentId(Number(event.target.value))}
                className="w-full rounded border border-border bg-bg-input px-3 py-2 text-sm text-text outline-none focus:border-accent"
                aria-label="Agent"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}{agent.status === "running" ? "" : ` · ${agent.status}`}
                  </option>
                ))}
              </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Task</span>
              <input
                id="new-task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded border border-border bg-bg-input px-3 py-2 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
                placeholder="Prepare the weekly client briefing"
                maxLength={240}
                required
                autoFocus
              />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">
                  Instructions <span className="font-normal normal-case tracking-normal text-text-dim">(optional)</span>
                </span>
              <textarea
                id="new-task-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={5}
                className="w-full resize-none rounded border border-border bg-bg-input px-3 py-2 text-sm leading-5 text-text outline-none placeholder:text-text-dim focus:border-accent"
                placeholder="Include the outcome, constraints, and what successful completion looks like."
              />
              </label>

              {schedulingEnabled && (
                <fieldset>
                  <legend className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">When</legend>
                  <div className="grid grid-cols-2 gap-1 rounded border border-border bg-bg p-1 sm:grid-cols-4">
                    {([
                      ["now", "Now"],
                      ["once", "Once"],
                      ["cron", "Recurring"],
                      ["interval", "Interval"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setScheduleMode(value)}
                        className={`rounded px-2 py-2 text-[11px] font-semibold transition-colors ${
                          scheduleMode === value
                            ? "bg-accent/15 text-accent"
                            : "text-text-muted hover:bg-bg-hover hover:text-text"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {scheduleMode === "once" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,.65fr)]">
                      <label>
                        <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">Date and time</span>
                        <input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(event) => setScheduledAt(event.target.value)}
                          className="h-10 w-full rounded border border-border bg-bg-input px-3 text-xs text-text outline-none focus:border-accent"
                        />
                      </label>
                      <TimezoneField value={timezone} onChange={setTimezone} />
                    </div>
                  )}

                  {scheduleMode === "cron" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,.65fr)]">
                      <label>
                        <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">Five-field cron</span>
                        <input
                          value={cronExpression}
                          onChange={(event) => setCronExpression(event.target.value)}
                          className="h-10 w-full rounded border border-border bg-bg-input px-3 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
                          placeholder="0 9 * * *"
                        />
                      </label>
                      <TimezoneField value={timezone} onChange={setTimezone} />
                      <p className="text-[9px] leading-4 text-text-dim sm:col-span-2">Example: <code className="text-text-muted">0 9 * * *</code> runs every day at 09:00 in the selected timezone.</p>
                    </div>
                  )}

                  {scheduleMode === "interval" && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,.65fr)]">
                      <label>
                        <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">Repeat every</span>
                        <input
                          value={intervalExpression}
                          onChange={(event) => setIntervalExpression(event.target.value)}
                          className="h-10 w-full rounded border border-border bg-bg-input px-3 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
                          placeholder="1h"
                        />
                      </label>
                      <TimezoneField value={timezone} onChange={setTimezone} />
                      <p className="text-[9px] leading-4 text-text-dim sm:col-span-2">Use a duration such as <code className="text-text-muted">30m</code>, <code className="text-text-muted">1h</code>, or <code className="text-text-muted">24h</code>.</p>
                    </div>
                  )}
                </fieldset>
              )}

              <div className="rounded border border-border bg-bg-hover/30 px-3 py-2">
                <p className="text-[11px] font-semibold text-text">
                  {scheduleMode === "now" ? "Runs from the agent’s main thread" : "The server wakes main when this task is due"}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-text-muted">
                  {scheduleMode === "now"
                    ? "It continues after you leave. Progress and the final result appear on this page."
                    : "Each occurrence is tracked as a run inside this schedule. Scheduling does not depend on the agent’s pace."}
                </p>
              </div>
            </>
          )}

          {error && <div className="text-xs text-red">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded border border-border px-4 py-2 text-sm text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !agentId || !title.trim()}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-semibold text-bg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Creating…" : scheduleMode === "now" ? "Create task" : "Schedule task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function newTaskIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `task-ui-${uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function TimezoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-dim">Timezone</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded border border-border bg-bg-input px-3 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
        placeholder="UTC"
      />
    </label>
  );
}
