import { useState, useEffect, useRef } from "react";
import { instances, core, telemetry, type Instance, type Status, type Thread, type TelemetryEvent, type PendingApproval } from "../api";
import { ThreadGraph, pushGraphEvent } from "../components/ThreadGraph";
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

// Read file as data URL
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Add files to attachment list
async function processFiles(files: FileList | File[]): Promise<Array<{ file: File; dataUrl: string; mimeType: string }>> {
  const results: Array<{ file: File; dataUrl: string; mimeType: string }> = [];
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/") || file.type.startsWith("audio/")) {
      const dataUrl = await readFileAsDataUrl(file);
      results.push({ file, dataUrl, mimeType: file.type });
    }
  }
  return results;
}

// Format structured tool args into a readable string
function formatArgs(args: Record<string, string> | string): string {
  if (!args) return "";
  if (typeof args === "string") return args.length > 200 ? args.slice(0, 200) + "..." : args;
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const val = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "..." : v;
      return `${k}=${val}`;
    })
    .join(", ");
}

// ─── Instance Detail View ───

// Unified stream entry — either a thought (streaming/done) or a raw event
interface StreamEntry {
  kind: "thought" | "event";
  threadId: string;
  time: string;
  // thought fields
  iteration?: number;
  text?: string;
  streaming?: boolean;
  tokens?: { in: number; out: number; cached: number };
  durationMs?: number;
  costUsd?: number;
  // event fields
  event?: TelemetryEvent;
}

function InstanceView({ instance, onDelete, onReload }: { instance: Instance; onDelete: () => void; onReload: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [consoleInput, setConsoleInput] = useState("");
  const [attachments, setAttachments] = useState<Array<{ file: File; dataUrl: string; mimeType: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [mode, setMode] = useState<"autonomous" | "supervised">((instance.mode as any) || "autonomous");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [threadFilter, setThreadFilter] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  // Reset state when instance changes
  useEffect(() => {
    setStatus(null);
    setThreads([]);
    setStream([]);
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

  // Single SSE connection for all telemetry
  useEffect(() => {
    if (instance.status !== "running") return;
    const es = telemetry.stream(instance.id);
    es.onmessage = (e) => {
      try {
        const event: TelemetryEvent = JSON.parse(e.data);
        handleEvent(event);
      } catch {}
    };
    return () => es.close();
  }, [instance.id, instance.status]);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [stream]);

  const handleEvent = (event: TelemetryEvent) => {
    // Feed to graph (same event, no lag)
    pushGraphEvent(event);

    // Streaming chunk — append to existing streaming thought or create new one
    if (event.type === "llm.chunk" && event.data?.text) {
      setStream((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].kind === "thought" && prev[i].streaming && prev[i].threadId === event.thread_id) {
            const updated = [...prev];
            updated[i] = { ...updated[i], text: (updated[i].text || "") + event.data.text };
            return updated;
          }
        }
        return [...prev, {
          kind: "thought", threadId: event.thread_id, time: event.time,
          iteration: event.data.iteration || 0, text: event.data.text, streaming: true,
        }];
      });
      return;
    }

    // LLM done — finalize streaming thought or add complete thought
    if (event.type === "llm.done") {
      setStream((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].kind === "thought" && updated[i].streaming && updated[i].threadId === event.thread_id) {
            updated[i] = {
              ...updated[i], streaming: false,
              iteration: event.data?.iteration || updated[i].iteration,
              tokens: { in: event.data?.tokens_in || 0, out: event.data?.tokens_out || 0, cached: event.data?.tokens_cached || 0 },
              durationMs: event.data?.duration_ms, costUsd: event.data?.cost_usd,
            };
            return updated.length > 100 ? updated.slice(-100) : updated;
          }
        }
        updated.push({
          kind: "thought", threadId: event.thread_id, time: event.time,
          iteration: event.data?.iteration || 0, text: event.data?.message || "", streaming: false,
          tokens: { in: event.data?.tokens_in || 0, out: event.data?.tokens_out || 0, cached: event.data?.tokens_cached || 0 },
          durationMs: event.data?.duration_ms, costUsd: event.data?.cost_usd,
        });
        return updated.length > 100 ? updated.slice(-100) : updated;
      });
      return;
    }

    // Everything else — add as event entry in the stream
    if (event.type !== "llm.chunk") {
      setStream((prev) => {
        const next = [...prev, { kind: "event" as const, threadId: event.thread_id, time: event.time, event }];
        return next.length > 100 ? next.slice(-100) : next;
      });
    }

    // Supervised mode — approval UI
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
              {status.paused ? "paused" : status.model} · {formatUptime(status.uptime_seconds)}
            </span>
          )}
          {instance.status === "stopped" && (
            <span className="text-red text-sm">stopped</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const newMode = mode === "supervised" ? "autonomous" : "supervised";
              await instances.updateConfig(instance.id, undefined, newMode);
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
          {instance.status === "running" && (
            <>
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
            onClick={() => setShowDeleteConfirm(true)}
            className="px-3 py-1.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="p-6">
          <h3 className="text-text text-lg font-bold mb-2">Delete Instance</h3>
          <p className="text-text-dim text-sm mb-1">
            Are you sure you want to delete <span className="text-text font-bold">{instance.name}</span>?
          </p>
          <p className="text-text-muted text-xs mb-6">
            This will stop the process and remove all instance data. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
              className="px-4 py-2 bg-red text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity"
            >
              Delete Instance
            </button>
          </div>
        </div>
      </Modal>

      {/* Approval banner */}
      {pendingApproval && (
        <div className="border-b border-accent bg-accent/10 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-accent font-bold text-sm">APPROVAL REQUIRED</span>
            <span className="text-text text-sm font-mono">
              {pendingApproval.name}({formatArgs(pendingApproval.args)})
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
          <div className="border-b border-border px-3 py-2 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setThreadFilter(null)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                !threadFilter ? "bg-accent text-bg font-bold" : "text-text-muted hover:text-text"
              }`}
            >
              all
            </button>
            {Array.from(new Set([...threads.map((t) => t.id), ...stream.map((e) => e.threadId)])).sort((a, b) => a === "main" ? -1 : b === "main" ? 1 : a.localeCompare(b)).map((tid) => (
              <button
                key={tid}
                onClick={() => setThreadFilter(threadFilter === tid ? null : tid)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  threadFilter === tid ? "bg-accent text-bg font-bold" : "text-text-muted hover:text-text"
                }`}
              >
                {tid}
              </button>
            ))}
            <span className="text-text-dim text-xs ml-auto">{stream.filter((e) => !threadFilter || e.threadId === threadFilter).length}</span>
          </div>

          {/* Thread info bar */}
          {threadFilter && (() => {
            const t = threads.find((t) => t.id === threadFilter);
            if (!t) return null;
            return (
              <div className="border-b border-border px-3 py-2 bg-bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-text text-xs font-bold">{t.id}</span>
                  <span className="text-text-muted text-xs">{t.rate} · {t.model}</span>
                  <span className="text-text-dim text-xs ml-auto">{t.age}</span>
                </div>
                {t.directive && (
                  <p className="text-text-dim text-xs leading-relaxed">{t.directive.length > 200 ? t.directive.slice(0, 200) + "..." : t.directive}</p>
                )}
                {t.tools && t.tools.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 overflow-hidden">
                    {t.tools.slice(0, 4).map((tool) => (
                      <span key={tool} className="text-[10px] text-text-muted bg-bg-input border border-border rounded-full px-2 py-0.5 whitespace-nowrap">{tool}</span>
                    ))}
                    {t.tools.length > 4 && (
                      <span className="text-[10px] text-text-dim whitespace-nowrap">+{t.tools.length - 4} more</span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          <div ref={streamRef} className="flex-1 overflow-y-auto">
            {stream.length === 0 && (
              <p className="text-text-muted text-sm p-4">Waiting for activity...</p>
            )}
            {stream.filter((entry) => !threadFilter || entry.threadId === threadFilter).map((entry, i) => {
              // Thought entry (streaming or finalized)
              if (entry.kind === "thought") {
                return (
                  <div key={i} className="border-b border-border px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      {entry.streaming && (
                        <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
                      )}
                      <span className="text-text-muted text-xs">{entry.threadId}</span>
                      {entry.tokens && !entry.streaming && (
                        <span className="text-text-dim text-xs ml-auto">
                          {entry.tokens.in}→{entry.tokens.out} tok
                          {entry.durationMs && ` · ${(entry.durationMs / 1000).toFixed(1)}s`}
                          {entry.costUsd && ` · $${entry.costUsd.toFixed(4)}`}
                        </span>
                      )}
                    </div>
                    {entry.text && (
                      <p className={`text-sm leading-relaxed whitespace-pre-wrap ${
                        entry.streaming ? "text-text" : "text-text-dim"
                      }`}>
                        {entry.text}
                        {entry.streaming && <span className="animate-pulse">▊</span>}
                      </p>
                    )}
                  </div>
                );
              }

              // Event entry
              const e = entry.event!;
              const d = e.data || {};
              return (
                <div key={i} className="px-4 py-1.5 flex items-start gap-1.5 text-xs font-mono">
                  {e.type === "tool.call" && (
                    <div className="flex items-start gap-1.5 min-w-0 flex-wrap">
                      <span className="text-yellow shrink-0">⚡</span>
                      <span className="text-text shrink-0">{d.name}</span>
                      {d.args && <span className="text-text-dim break-all">({formatArgs(d.args)})</span>}
                    </div>
                  )}
                  {e.type === "tool.result" && (
                    <div className="flex items-start gap-1.5 min-w-0 flex-wrap">
                      <span className={`shrink-0 ${d.success ? "text-green" : "text-red"}`}>{d.success ? "↳" : "✗"}</span>
                      <span className="text-text-dim shrink-0">{d.name}</span>
                      <span className="text-text-muted shrink-0">{d.duration_ms != null ? (d.duration_ms / 1000).toFixed(1) + "s" : ""}</span>
                      {d.result && <span className="text-text-dim break-all">{d.result.length > 120 ? d.result.substring(0, 120) + "..." : d.result}</span>}
                    </div>
                  )}
                  {e.type === "tool.pending" && (
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="text-yellow animate-pulse shrink-0">⏳</span>
                      <span className="text-text shrink-0">{d.name}</span>
                      {d.args && <span className="text-text-dim break-all">({formatArgs(d.args)})</span>}
                      {pendingApproval && pendingApproval.name === d.name && (
                        <span className="flex items-center gap-1 ml-1">
                          <button
                            onClick={async () => { await core.approve(instance.id, true); setPendingApproval(null); }}
                            className="px-2 py-0.5 bg-green text-bg rounded text-xs font-bold hover:opacity-80"
                          >
                            approve
                          </button>
                          <button
                            onClick={async () => { await core.approve(instance.id, false); setPendingApproval(null); }}
                            className="px-2 py-0.5 bg-red text-bg rounded text-xs font-bold hover:opacity-80"
                          >
                            reject
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {e.type === "tool.approved" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-green">✓</span>
                      <span className="text-text-dim">{d.name} approved</span>
                    </div>
                  )}
                  {e.type === "tool.rejected" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-red">✗</span>
                      <span className="text-text-dim">{d.name} rejected</span>
                    </div>
                  )}
                  {e.type === "thread.spawn" && (
                    <div className="flex items-start gap-1.5 flex-wrap">
                      <span className="text-green">⚙</span>
                      <span className="text-text-dim">thread <span className="text-text">{e.thread_id}</span> spawned</span>
                      {d.directive && <span className="text-text-muted break-all">— {d.directive}</span>}
                    </div>
                  )}
                  {e.type === "thread.done" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue">✓</span>
                      <span className="text-text-dim">thread <span className="text-text">{e.thread_id}</span> done</span>
                      {d.result && <span className="text-text-muted break-all">— {d.result}</span>}
                    </div>
                  )}
                  {e.type === "thread.message" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue">→</span>
                      <span className="text-text-dim">{d.from} → {d.to}</span>
                    </div>
                  )}
                  {e.type === "llm.error" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-red">✗</span>
                      <span className="text-red">{d.error}</span>
                    </div>
                  )}
                  {e.type === "mode.changed" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue">◆</span>
                      <span className="text-text-dim">mode → <span className="text-text">{d.mode}</span></span>
                    </div>
                  )}
                  {e.type === "event.received" && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-cyan shrink-0">{d.source === "thread" ? "⇄" : d.source === "webhook" ? "⚑" : "▶"}</span>
                      <span className="text-text-muted shrink-0">[{d.source}]</span>
                      <span className="text-text-dim break-all">{d.message}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Graph + status */}
        <div className="w-2/3 flex flex-col min-h-0 overflow-y-auto">
          {/* Console */}
          {instance.status === "running" && (
            <div
              className="mx-4 mt-4 border border-border rounded-lg bg-bg-card"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const newFiles = await processFiles(e.dataTransfer.files);
                setAttachments((prev) => [...prev, ...newFiles]);
              }}
            >
              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="flex items-center gap-2 px-4 pt-3 pb-1 overflow-x-auto">
                  {attachments.map((att, i) => (
                    <div key={i} className="relative shrink-0 group">
                      {att.mimeType.startsWith("image/") ? (
                        <img src={att.dataUrl} className="h-12 w-12 rounded object-cover border border-border" />
                      ) : (
                        <div className="h-12 w-12 rounded border border-border bg-bg-input flex items-center justify-center text-text-muted text-[10px]">
                          {att.mimeType.split("/")[1]}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red text-bg text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {attachments.reduce((s, a) => s + a.file.size, 0) > 10_000_000 && (
                    <span className="text-red text-[10px] shrink-0">Large payload — may exceed provider limits</span>
                  )}
                </div>
              )}
              {/* Input row */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const text = consoleInput.trim();
                  if (!text && attachments.length === 0) return;

                  if (attachments.length > 0) {
                    const parts: Array<any> = [];
                    if (text) parts.push({ type: "text", text });
                    for (const att of attachments) {
                      if (att.mimeType.startsWith("image/")) {
                        parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
                      } else if (att.mimeType.startsWith("audio/")) {
                        parts.push({ type: "audio_url", audio_url: { url: att.dataUrl, mime_type: att.mimeType } });
                      }
                    }
                    await instances.sendEvent(instance.id, parts, threadFilter || undefined);
                  } else {
                    await instances.sendEvent(instance.id, text, threadFilter || undefined);
                  }
                  setConsoleInput("");
                  setAttachments([]);
                }}
                className="flex items-center"
                onPaste={async (e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const files: File[] = [];
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith("image/") || item.type.startsWith("audio/")) {
                      const file = item.getAsFile();
                      if (file) files.push(file);
                    }
                  }
                  if (files.length > 0) {
                    e.preventDefault();
                    const newFiles = await processFiles(files);
                    setAttachments((prev) => [...prev, ...newFiles]);
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    if (e.target.files) {
                      const newFiles = await processFiles(e.target.files);
                      setAttachments((prev) => [...prev, ...newFiles]);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-text-muted hover:text-accent transition-colors pl-4 pr-1"
                  title="Attach image or audio"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13.5 7.5l-5.8 5.8a3.2 3.2 0 01-4.5-4.5l5.8-5.8a2.1 2.1 0 013 3L6.2 11.8a1.1 1.1 0 01-1.5-1.5L10 5" />
                  </svg>
                </button>
                <span className="text-accent text-sm font-bold pl-2">
                  {threadFilter && threadFilter !== "main" ? `${threadFilter} ›` : ">"}
                </span>
                <input
                  value={consoleInput}
                  onChange={(e) => setConsoleInput(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-text focus:outline-none px-3 py-3"
                  placeholder={threadFilter && threadFilter !== "main" ? `Send to ${threadFilter}...` : "Send a message to the instance..."}
                />
                <button
                  type="submit"
                  className="text-sm text-text-muted hover:text-accent transition-colors pr-4"
                >
                  Send
                </button>
              </form>
            </div>
          )}

          {/* Directive */}
          <DirectiveEditor instance={instance} status={status} onUpdate={(d) => setInstance({ ...instance, directive: d })} />

          {/* Graph */}
          <div className="p-4">
            <ThreadGraph
              threads={threads}
              selectedThread={threadFilter}
              onSelectThread={setThreadFilter}
            />
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
