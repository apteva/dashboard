import { useState, useEffect } from "react";
import { core, instances, type Instance, type Status, type Thread, type TelemetryEvent } from "../api";

interface ThoughtEntry {
  threadId: string;
  text: string;
  iteration: number;
  streaming: boolean;
  time: number;
}

interface ToolEntry {
  name: string;
  reason: string;
  threadId: string;
  done: boolean;
  durationMs?: number;
  success?: boolean;
  time: number;
}

interface Props {
  instance: Instance;
  event: TelemetryEvent | null; // latest event from ChatPanel's SSE
  onReload: () => void;
}

export function ActivityPanel({ instance, event, onReload }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [mode, setMode] = useState(instance.mode || "autonomous");

  // Poll status + threads
  useEffect(() => {
    if (instance.status !== "running") return;
    const poll = () => {
      core.status(instance.id).then((s) => { setStatus(s); setMode(s.mode); }).catch(() => {});
      core.threads(instance.id).then(setThreads).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [instance.id, instance.status]);

  // Process SSE events
  useEffect(() => {
    if (!event) return;
    const data = event.data || {};

    if (event.type === "llm.chunk" && data.text) {
      setThoughts((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].streaming && prev[i].threadId === event.thread_id) {
            const updated = [...prev];
            updated[i] = { ...updated[i], text: updated[i].text + data.text };
            return updated;
          }
        }
        return [...prev, {
          threadId: event.thread_id, text: data.text, iteration: data.iteration || 0,
          streaming: true, time: Date.now(),
        }];
      });
    }

    if (event.type === "llm.done") {
      setThoughts((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].streaming && updated[i].threadId === event.thread_id) {
            updated[i] = { ...updated[i], streaming: false, iteration: data.iteration || updated[i].iteration };
            return updated.slice(-20);
          }
        }
        if (data.message) {
          updated.push({
            threadId: event.thread_id, text: data.message, iteration: data.iteration || 0,
            streaming: false, time: Date.now(),
          });
        }
        return updated.slice(-20);
      });
    }

    if (event.type === "tool.call" && data.name && !String(data.name).startsWith("channels_")) {
      setTools((prev) => [...prev, {
        name: data.name, reason: data.reason || "", threadId: event.thread_id,
        done: false, time: Date.now(),
      }].slice(-20));
    }

    if (event.type === "tool.result" && data.name && !String(data.name).startsWith("channels_")) {
      setTools((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (!updated[i].done && updated[i].name === data.name) {
            updated[i] = { ...updated[i], done: true, durationMs: data.duration_ms, success: data.success !== false };
            return updated;
          }
        }
        return updated;
      });
    }

    if (event.type === "thread.spawn") {
      setThreads((prev) => {
        if (prev.some((t) => t.id === event.thread_id)) return prev;
        return [...prev, { id: event.thread_id, directive: data.directive || "", tools: [], iteration: 0, rate: "reactive", model: "", age: "0s" }];
      });
    }

    if (event.type === "thread.done") {
      setThreads((prev) => prev.filter((t) => t.id !== event.thread_id));
    }

    if (event.type === "mode.changed" && data.mode) {
      setMode(data.mode);
    }

    if (event.type === "directive.evolved") {
      onReload();
    }
  }, [event]);

  const formatUptime = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  // Active tools for thread display
  const activeToolByThread: Record<string, string> = {};
  for (const t of tools) {
    if (!t.done) activeToolByThread[t.threadId] = t.name;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-xs">
      {/* Status */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${instance.status === "running" ? (status?.paused ? "bg-accent" : "bg-green") : "bg-red"}`} />
          <span className="text-text font-bold text-sm">{status?.paused ? "PAUSED" : instance.status === "running" ? "RUNNING" : "STOPPED"}</span>
          <div className="ml-auto flex gap-2">
            <button
              onClick={async () => {
                const newMode = mode === "autonomous" ? "cautious" : "autonomous";
                await instances.updateConfig(instance.id, undefined, newMode);
                setMode(newMode);
              }}
              className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                mode !== "autonomous" ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent"
              }`}
            >
              {mode}
            </button>
          </div>
        </div>
        {status && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-muted">
            <span>iter</span><span className="text-text">{status.iteration}</span>
            <span>rate</span><span className="text-text">{status.rate}</span>
            <span>model</span><span className="text-text truncate">{status.model}</span>
            <span>uptime</span><span className="text-text">{formatUptime(status.uptime_seconds)}</span>
            <span>memory</span><span className="text-text">{status.memories}</span>
          </div>
        )}
      </div>

      {/* Threads */}
      {threads.length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-text-muted font-bold mb-2 uppercase tracking-wide text-[10px]">Threads ({threads.length})</h3>
          <div className="space-y-2">
            {threads.map((t) => (
              <div key={t.id}>
                <div className="flex items-center gap-2">
                  <span className="text-text font-bold">{t.id}</span>
                  {activeToolByThread[t.id] ? (
                    <span className="text-accent tool-active-line">⟳ {activeToolByThread[t.id]}</span>
                  ) : (
                    <span className="text-text-muted">#{t.iteration} {t.rate}</span>
                  )}
                </div>
                {t.directive && (
                  <p className="text-text-dim mt-0.5 truncate">{t.directive}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent tool calls */}
      {tools.length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-text-muted font-bold mb-2 uppercase tracking-wide text-[10px]">Tool Calls</h3>
          <div className="space-y-1">
            {tools.slice(-8).map((t, i) => {
              if (t.done) {
                const dur = t.durationMs != null
                  ? t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`
                  : "";
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className={t.success ? "text-green" : "text-red"}>✓</span>
                    <span className="text-text-dim">{t.name}</span>
                    {dur && <span className="text-text-muted">({dur})</span>}
                  </div>
                );
              }
              return (
                <div key={i} className="flex items-center gap-1.5 tool-active-line">
                  <span className="text-accent">⟳</span>
                  <span className="text-accent">{t.name}</span>
                  {t.reason && <span className="text-text-muted">— {t.reason}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Directive */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-text-muted font-bold mb-1 uppercase tracking-wide text-[10px]">Directive</h3>
        <p className="text-text-dim leading-relaxed text-xs line-clamp-3">
          {instance.directive || <span className="italic">No directive set</span>}
        </p>
      </div>

      {/* Thoughts */}
      {thoughts.length > 0 && (
        <div className="px-4 py-3 flex-1">
          <h3 className="text-text-muted font-bold mb-2 uppercase tracking-wide text-[10px]">Thoughts</h3>
          <div className="space-y-2">
            {thoughts.slice(-6).map((t, i) => (
              <div key={i}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  {t.streaming && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                  <span className="text-text-muted">{t.threadId}</span>
                  <span className="text-text-dim ml-auto">#{t.iteration}</span>
                </div>
                <p className={`leading-relaxed ${t.streaming ? "text-text" : "text-text-dim"}`}>
                  {t.text.length > 150 ? t.text.slice(0, 150) + "..." : t.text}
                  {t.streaming && <span className="tool-cursor">▊</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
