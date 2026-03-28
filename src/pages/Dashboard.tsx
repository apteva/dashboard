import { useState, useEffect, useRef } from "react";
import { instances, core, type Instance, type Status, type Thread, type TelemetryEvent, type PendingApproval } from "../api";
import { ThreadGraph } from "../components/ThreadGraph";
import { Modal } from "../components/Modal";
import { useProjects } from "../hooks/useProjects";

export function Dashboard() {
  const { currentProject } = useProjects();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [directive, setDirective] = useState("");
  const [mode, setMode] = useState<"autonomous" | "supervised">("autonomous");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const projectId = currentProject?.id;

  const load = () =>
    instances
      .list(projectId)
      .then((list) => {
        setInstance(list.length > 0 ? list[0] : null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    try {
      await instances.create(name.trim(), directive.trim(), mode, projectId);
      setName("");
      setDirective("");
      load();
    } catch (err: any) {
      setError(err.message || "Failed to create instance");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!instance) return;
    await instances.delete(instance.id);
    setInstance(null);
  };

  if (!loaded) return null;

  if (instance) {
    return <InstanceView instance={instance} onDelete={handleDelete} onReload={load} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Dashboard</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleCreate} className="border border-border rounded-lg p-6 bg-bg-card space-y-4 max-w-lg">
          <h2 className="text-text text-base font-bold">Create your instance</h2>
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="My instance"
              required
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Directive (optional)</label>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent resize-none h-24"
              placeholder="What should this instance think about?"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Mode</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setMode("autonomous")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold border transition-colors ${
                  mode === "autonomous"
                    ? "border-text-muted bg-bg-input text-text"
                    : "border-border text-text-dim hover:border-text-muted hover:text-text-muted"
                }`}
              >
                Autonomous
              </button>
              <button
                type="button"
                onClick={() => setMode("supervised")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold border transition-colors ${
                  mode === "supervised"
                    ? "border-text-muted bg-bg-input text-text"
                    : "border-border text-text-dim hover:border-text-muted hover:text-text-muted"
                }`}
              >
                Supervised
              </button>
            </div>
            <p className="text-text-dim text-xs mt-1.5">
              {mode === "supervised"
                ? "Tool calls require manual approval before executing."
                : "All tool calls execute automatically."}
            </p>
          </div>
          {error && <div className="text-red text-sm">{error}</div>}
          <button
            type="submit"
            disabled={creating}
            className="px-6 py-3 bg-accent text-bg rounded-lg font-bold text-base hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Instance"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Instance Detail View ───

type LeftTab = "thoughts" | "events";

interface Thought {
  threadId: string;
  iteration: number;
  text: string;
  streaming: boolean;
  tokens?: { in: number; out: number; cached: number };
  durationMs?: number;
  costUsd?: number;
  time: string;
}

function InstanceView({ instance, onDelete, onReload }: { instance: Instance; onDelete: () => void; onReload: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [leftTab, setLeftTab] = useState<LeftTab>("thoughts");
  const [consoleInput, setConsoleInput] = useState("");
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [mode, setMode] = useState<"autonomous" | "supervised">((instance.mode as any) || "autonomous");
  const thoughtsRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);

  // Reset state when instance changes
  useEffect(() => {
    setStatus(null);
    setThreads([]);
    setEvents([]);
    setThoughts([]);
  }, [instance.id]);

  useEffect(() => {
    if (instance.status !== "running") return;
    const poll = () => {
      core.status(instance.id).then((s) => {
        setStatus(s);
        setMode(s.mode);
        if (s.pending_approval) setPendingApproval(s.pending_approval);
      }).catch(() => {});
      core.threads(instance.id).then(setThreads).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [instance.id, instance.status]);

  useEffect(() => {
    if (leftTab === "thoughts" && thoughtsRef.current) {
      thoughtsRef.current.scrollTop = thoughtsRef.current.scrollHeight;
    }
    if (leftTab === "events" && eventsRef.current) {
      eventsRef.current.scrollTop = eventsRef.current.scrollHeight;
    }
  }, [events, thoughts, leftTab]);

  const handleEvent = (event: TelemetryEvent) => {
    // Skip chunks from the event log
    if (event.type !== "llm.chunk") {
      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > 200 ? next.slice(-200) : next;
      });
    }

    // Build streaming thoughts
    if (event.type === "llm.chunk" && event.data?.text) {
      setThoughts((prev) => {
        // Find existing streaming thought for this thread (search backwards)
        let matchIdx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].streaming && prev[i].threadId === event.thread_id) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx >= 0) {
          // Append to existing streaming thought
          const updated = [...prev];
          updated[matchIdx] = { ...updated[matchIdx], text: updated[matchIdx].text + event.data.text };
          return updated;
        }
        // New streaming thought
        return [...prev, {
          threadId: event.thread_id,
          iteration: event.data.iteration || 0,
          text: event.data.text,
          streaming: true,
          time: event.time,
        }];
      });
    }

    if (event.type === "llm.done") {
      setThoughts((prev) => {
        const updated = [...prev];
        // Search backwards for the matching streaming thought (not just last — multi-thread safe)
        let matchIdx = -1;
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].streaming && updated[i].threadId === event.thread_id) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx >= 0) {
          // Finalize the streaming thought — keep streamed text as-is
          updated[matchIdx] = {
            ...updated[matchIdx],
            streaming: false,
            iteration: event.data?.iteration || updated[matchIdx].iteration,
            tokens: {
              in: event.data?.tokens_in || 0,
              out: event.data?.tokens_out || 0,
              cached: event.data?.tokens_cached || 0,
            },
            durationMs: event.data?.duration_ms,
            costUsd: event.data?.cost_usd,
          };
        } else {
          // No streaming preceded this — add as complete thought
          updated.push({
            threadId: event.thread_id,
            iteration: event.data?.iteration || 0,
            text: event.data?.message || "",
            streaming: false,
            tokens: {
              in: event.data?.tokens_in || 0,
              out: event.data?.tokens_out || 0,
              cached: event.data?.tokens_cached || 0,
            },
            durationMs: event.data?.duration_ms,
            costUsd: event.data?.cost_usd,
            time: event.time,
          });
        }
        return updated.length > 50 ? updated.slice(-50) : updated;
      });
    }

    // Supervised mode — approval events via SSE (instant)
    if (event.type === "tool.pending" && event.data) {
      setPendingApproval({ name: event.data.name, args: event.data.args });
    }
    if (event.type === "tool.approved" || event.type === "tool.rejected") {
      setPendingApproval(null);
    }
    if (event.type === "mode.changed" && event.data) {
      setMode(event.data.mode);
    }
  };

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const typeColor = (type: string) => {
    if (type.startsWith("llm.")) return "text-accent";
    if (type === "thread.spawn") return "text-green";
    if (type === "thread.done") return "text-red";
    if (type === "thread.message") return "text-blue";
    if (type.startsWith("tool.")) return "text-text-dim";
    if (type.includes("error")) return "text-red";
    return "text-text-muted";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              instance.status === "running"
                ? status?.paused ? "bg-accent" : "bg-green"
                : "bg-red"
            }`}
          />
          <h1 className="text-text text-base font-bold">{instance.name}</h1>
          {status && (
            <span className="text-text-muted text-sm">
              {status.paused ? "paused" : `#${status.iteration} · ${status.model}`} · {formatUptime(status.uptime_seconds)}
            </span>
          )}
          {instance.status === "stopped" && (
            <span className="text-red text-sm">stopped</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {instance.status === "running" && (
            <>
              <button
                onClick={async () => {
                  const newMode = mode === "supervised" ? "autonomous" : "supervised";
                  await core.setMode(instance.id, newMode);
                  setMode(newMode);
                }}
                className={`px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                  mode === "supervised"
                    ? "border-accent text-accent hover:bg-accent hover:text-bg"
                    : "border-border text-text-muted hover:text-accent hover:border-accent"
                }`}
              >
                {mode === "supervised" ? "Supervised" : "Autonomous"}
              </button>
              <button
                onClick={async () => { const res = await instances.pause(instance.id); setStatus((s) => s ? { ...s, paused: res.paused } : s); }}
                className="px-3 py-1.5 border border-border rounded-lg text-sm text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                {status?.paused ? "Resume" : "Pause"}
              </button>
              <button
                onClick={async () => { await instances.stop(instance.id); onReload(); }}
                className="px-3 py-1.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
              >
                Stop
              </button>
            </>
          )}
          {instance.status === "stopped" && (
            <button
              onClick={async () => { await instances.start(instance.id); onReload(); }}
              className="px-3 py-1.5 border border-border rounded-lg text-sm text-accent border-accent hover:bg-accent hover:text-bg transition-colors"
            >
              Start
            </button>
          )}
          <button
            onClick={onDelete}
            className="px-3 py-1.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Approval banner */}
      {pendingApproval && (
        <div className="border-b border-accent bg-accent/10 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-accent font-bold text-sm">APPROVAL REQUIRED</span>
            <span className="text-text text-sm font-mono">
              {pendingApproval.name}({pendingApproval.args.length > 80 ? pendingApproval.args.slice(0, 80) + "..." : pendingApproval.args})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { await core.approve(instance.id, true); setPendingApproval(null); }}
              className="px-4 py-1.5 bg-green text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity"
            >
              Approve
            </button>
            <button
              onClick={async () => { await core.approve(instance.id, false); setPendingApproval(null); }}
              className="px-4 py-1.5 bg-red text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Main content: left panel (1/3) + right panel (2/3) */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Thoughts / Events */}
        <div className="w-1/3 border-r border-border flex flex-col min-h-0">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setLeftTab("thoughts")}
              className={`flex-1 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                leftTab === "thoughts"
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              Thoughts
            </button>
            <button
              onClick={() => setLeftTab("events")}
              className={`flex-1 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                leftTab === "events"
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              Events ({events.length})
            </button>
          </div>

          {/* Thoughts tab */}
          {leftTab === "thoughts" && (
            <div ref={thoughtsRef} className="flex-1 overflow-y-auto">
              {thoughts.length === 0 && (
                <p className="text-text-muted text-sm p-4">Waiting for thoughts...</p>
              )}
              {thoughts.map((t, i) => (
                <div key={i} className="border-b border-border px-4 py-3">
                  {/* Header */}
                  <div className="flex items-center gap-2 mb-1.5">
                    {t.streaming && (
                      <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                    )}
                    <span className="text-text-muted text-xs">{t.threadId}</span>
                    <span className="text-text-dim text-xs">#{t.iteration}</span>
                    {t.tokens && !t.streaming && (
                      <span className="text-text-dim text-xs ml-auto">
                        {t.tokens.in}→{t.tokens.out} tok
                        {t.durationMs && ` · ${(t.durationMs / 1000).toFixed(1)}s`}
                        {t.costUsd && ` · $${t.costUsd.toFixed(4)}`}
                      </span>
                    )}
                  </div>
                  {/* Thought text */}
                  <p className={`text-sm leading-relaxed whitespace-pre-wrap ${
                    t.streaming ? "text-text" : "text-text-dim"
                  }`}>
                    {t.text}
                    {t.streaming && <span className="animate-pulse">▊</span>}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Events tab */}
          {leftTab === "events" && (
            <div ref={eventsRef} className="flex-1 overflow-y-auto px-3 py-2">
              {events.length === 0 && (
                <p className="text-text-muted text-sm py-2">Waiting for events...</p>
              )}
              {events.map((e, i) => {
                const time = e.time ? new Date(e.time).toLocaleTimeString() : "";
                const data = e.data || {};
                const msg = data.message || data.result || data.error || data.directive || "";
                const displayMsg = msg && msg.length > 120 ? msg.substring(0, 120) + "..." : msg;

                let detail = "";
                if (e.type === "llm.done" && data.tokens_in) {
                  detail = `${data.tokens_in}→${data.tokens_out} tok · ${data.duration_ms}ms`;
                  if (data.cost_usd) detail += ` · $${data.cost_usd.toFixed(4)}`;
                } else if (e.type === "tool.call") {
                  detail = data.name || "";
                } else if (e.type === "tool.result") {
                  detail = `${data.name} · ${data.duration_ms}ms`;
                } else if (e.type === "thread.message") {
                  detail = `${data.from} → ${data.to}`;
                }

                return (
                  <div key={i} className="py-1 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-text-muted text-xs">{time}</span>
                      <span className={`text-xs font-bold ${typeColor(e.type)}`}>{e.type}</span>
                      <span className="text-text-dim text-xs">{e.thread_id}</span>
                    </div>
                    {detail && <p className="text-text-dim text-xs mt-0.5">{detail}</p>}
                    {displayMsg && <p className="text-text text-sm mt-0.5 leading-snug">{displayMsg}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Graph + status */}
        <div className="w-2/3 flex flex-col min-h-0 overflow-y-auto">
          {/* Console */}
          {instance.status === "running" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const msg = consoleInput.trim();
                if (!msg) return;
                await instances.sendEvent(instance.id, msg);
                setConsoleInput("");
              }}
              className="mx-4 mt-4 border border-border rounded-lg bg-bg-card flex items-center"
            >
              <span className="text-accent text-sm font-bold pl-4">&gt;</span>
              <input
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text focus:outline-none px-3 py-3"
                placeholder="Send a message to the instance..."
              />
              <button
                type="submit"
                className="text-sm text-text-muted hover:text-accent transition-colors pr-4"
              >
                Send
              </button>
            </form>
          )}

          {/* Directive */}
          <DirectiveEditor instance={instance} status={status} onUpdate={(d) => setInstance({ ...instance, directive: d })} />

          {/* Graph */}
          <div className="p-4">
            <ThreadGraph instanceId={instance.id} name={instance.name} threads={threads} onEvent={handleEvent} />
          </div>

        </div>
      </div>

    </div>
  );
}

function DirectiveEditor({ instance, status, onUpdate }: { instance: Instance; status: Status | null; onUpdate: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(instance.directive || "");
  const [saving, setSaving] = useState(false);

  const canEdit = instance.status === "running" || instance.status === "paused";

  const openModal = () => {
    if (!canEdit) return;
    setValue(instance.directive || "");
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await instances.updateConfig(instance.id, value.trim());
      onUpdate(value.trim());
      setOpen(false);
    } catch {}
    setSaving(false);
  };

  return (
    <>
      <div className="px-4 pt-4">
        <div
          className={`border border-border rounded-lg px-4 py-3 bg-bg-card group ${canEdit ? "cursor-pointer hover:border-accent" : "opacity-75"} transition-colors`}
          onClick={openModal}
        >
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-xs uppercase tracking-wide">Directive</span>
            {canEdit && <span className="text-text-dim text-xs opacity-0 group-hover:opacity-100 transition-opacity">Click to edit</span>}
            {!canEdit && <span className="text-text-dim text-xs">Instance must be running to edit</span>}
          </div>
          {instance.directive
            ? <p className="text-text text-sm mt-1 whitespace-pre-wrap">{instance.directive}</p>
            : <p className="text-text-dim text-sm mt-1 italic">No directive set</p>
          }
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="p-6 space-y-4">
          <h3 className="text-text text-base font-bold">Edit Directive</h3>
          <p className="text-text-muted text-sm">
            The directive tells the instance what to focus on. Changes take effect on the next iteration.
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            autoFocus
            className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent resize-y"
            placeholder="e.g. Monitor inbound messages and respond to support tickets"
          />
          <div className="flex justify-end gap-3">
            <button onClick={() => setOpen(false)}
              className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg px-3 py-2 bg-bg-card">
      <div className="text-text-muted text-xs">{label}</div>
      <div className="text-text text-base font-bold">{value}</div>
    </div>
  );
}
