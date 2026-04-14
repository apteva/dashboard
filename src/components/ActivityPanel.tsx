import { useState, useEffect, useRef } from "react";
import { core, instances, type Instance, type Status, type Thread } from "../api";
import type { SubscribeFn } from "./InstanceView";
import { MCPPanel } from "./MCPPanel";
import { ComputerPanel } from "./ComputerPanel";

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

// Noisy internal tools that shouldn't clutter the Tool Calls list — same
// filter the ChatPanel uses. Keep this in sync with ChatPanel.hiddenTools.
const hiddenTools = new Set([
  "pace", "done", "evolve", "remember", "send",
  "channels_respond", "channels_ask", "channels_status",
]);

interface Props {
  instance: Instance;
  subscribe: SubscribeFn; // synchronous event fan-out from InstanceView's SSE
  onReload: () => void;
}

export function ActivityPanel({ instance, subscribe, onReload }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [mode, setMode] = useState(instance.mode || "autonomous");

  // Reset state when instance changes
  useEffect(() => {
    setStatus(null);
    setThreads([]);
    setThoughts([]);
    setTools([]);
  }, [instance.id]);

  // Poll status + threads (works for both running and stopped instances)
  useEffect(() => {
    const poll = () => {
      core.status(instance.id).then((s) => { setStatus(s); setMode(s.mode); }).catch(() => {});
      core.threads(instance.id).then(setThreads).catch(() => {});
    };
    poll();
    if (instance.status === "running") {
      const interval = setInterval(poll, 3000);
      return () => clearInterval(interval);
    }
  }, [instance.id, instance.status]);

  // Dedup state. Same pattern as ChatPanel: React StrictMode double-mounts
  // and SSE reconnects can cause the same event.id to fan out twice
  // through the subscriber set, which previously rendered every tool
  // call / thought / thread-spawn twice in the activity panel. Bounded
  // at 500 entries.
  const seenEventsRef = useRef<Set<string>>(new Set());
  const seenOrderRef = useRef<string[]>([]);

  // Process SSE events — subscribe synchronously so every chunk is handled,
  // even when many arrive in the same React tick.
  useEffect(() => {
    return subscribe((event) => {
      // Dedup by telemetry event.id BEFORE any state mutation. Any handler
      // below this guard will see each unique event exactly once.
      if (event.id) {
        if (seenEventsRef.current.has(event.id)) return;
        seenEventsRef.current.add(event.id);
        seenOrderRef.current.push(event.id);
        if (seenOrderRef.current.length > 500) {
          const old = seenOrderRef.current.shift();
          if (old) seenEventsRef.current.delete(old);
        }
      }

      const data = event.data || {};

    if (event.type === "llm.chunk" && data.text) {
      const chunkIter = Number(data.iteration) || 0;
      setThoughts((prev) => {
        // First: append to an in-progress streaming entry if one exists
        // for this thread.
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].streaming && prev[i].threadId === event.thread_id) {
            const updated = [...prev];
            updated[i] = { ...updated[i], text: updated[i].text + data.text };
            return updated;
          }
        }
        // No streaming entry. Check whether this chunk belongs to an
        // iteration that has already been closed by llm.done — if so,
        // it's a late/stranded event and we drop it instead of opening
        // a new entry that would never get closed. We look for any
        // finalized thought on this thread with iteration >= chunkIter
        // as the signal.
        const latestClosed = prev.reduce((acc, t) => {
          if (!t.streaming && t.threadId === event.thread_id && t.iteration > acc) {
            return t.iteration;
          }
          return acc;
        }, 0);
        if (chunkIter > 0 && chunkIter <= latestClosed) {
          // Late chunk from an already-finalized iteration — drop it.
          return prev;
        }
        return [...prev, {
          threadId: event.thread_id, text: data.text, iteration: chunkIter,
          streaming: true, time: Date.now(),
        }];
      });
    }

    if (event.type === "llm.done") {
      setThoughts((prev) => {
        // Flip EVERY streaming entry for this thread, not just the last
        // one. The "one streaming entry per llm.done" invariant breaks
        // when a late llm.chunk arrives after done (stranded in the bus
        // drain queue) — the chunk handler doesn't find a streaming
        // entry and creates a fresh one with streaming:true, which then
        // never gets closed because no second done follows. Leaving an
        // orphan entry showing the orange "▊" cursor forever. Fix: on
        // done, sweep all matching streaming entries so any late
        // stragglers also get closed.
        const updated = prev.map((t) =>
          t.streaming && t.threadId === event.thread_id
            ? { ...t, streaming: false, iteration: data.iteration || t.iteration }
            : t,
        );
        // If there were no streaming entries at all but llm.done carries
        // a summary message, push it as a finalized thought. This is the
        // tool-only path where core emits no llm.chunk events.
        const hadStreaming = prev.some(
          (t) => t.streaming && t.threadId === event.thread_id,
        );
        if (!hadStreaming && data.message) {
          updated.push({
            threadId: event.thread_id,
            text: data.message,
            iteration: data.iteration || 0,
            streaming: false,
            time: Date.now(),
          });
        }
        return updated.slice(-20);
      });
    }

    const toolName = String(data.name || "");
    const toolHidden = hiddenTools.has(toolName) || toolName.startsWith("channels_");

    if (event.type === "tool.call" && toolName && !toolHidden) {
      setTools((prev) => [...prev, {
        name: toolName, reason: data.reason || "", threadId: event.thread_id,
        done: false, time: Date.now(),
      }].slice(-20));
    }

    if (event.type === "tool.result" && toolName && !toolHidden) {
      setTools((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (!updated[i].done && updated[i].name === toolName) {
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
        const parentId = data.parent_id || "main";
        // Calculate depth from parent
        let depth = 0;
        if (parentId !== "main") {
          const parent = prev.find((t) => t.id === parentId);
          depth = parent ? (parent.depth || 0) + 1 : 1;
        }
        return [...prev, { id: event.thread_id, parent_id: parentId, depth, directive: data.directive || "", tools: [], iteration: 0, rate: "reactive", model: "", age: "0s" }];
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
    });
  }, [subscribe, onReload]);

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

      {/* Threads (tree view) — each thread expanded with its directive,
          latest thought, latest tool call, and attached MCPs. Matches the
          information density of the CLI console so you can glance at the
          panel and know what every thread is up to without having to
          click into details. */}
      {threads.length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-text-muted font-bold mb-2 uppercase tracking-wide text-[10px]">
            Threads ({threads.length})
          </h3>
          <div className="space-y-3">
            {orderThreadTree(threads).map((t) => {
              // Pull the latest artifacts for this thread out of the
              // rolling state that ActivityPanel already maintains — no
              // extra API calls needed.
              const lastThought = [...thoughts]
                .reverse()
                .find((th) => th.threadId === t.id);
              const lastTool = [...tools]
                .reverse()
                .find((tl) => tl.threadId === t.id);
              const indent = (t.depth || 0) * 12;
              const isMain = t.id === "main";
              // For the directive line, kill newlines so the whole
              // thing fits on a single visual line regardless of how
              // the agent originally wrote it.
              const directiveLine = (t.directive || "")
                .replace(/\s+/g, " ")
                .trim();
              // Note: we intentionally do NOT render a "thought:" line
              // per-thread here. The Thoughts panel below already shows
              // the latest thoughts across threads with their full text,
              // duplicating them in the thread row just doubled the
              // visual noise without adding information.
              void lastThought;
              return (
                <div
                  key={t.id}
                  style={{ paddingLeft: `${indent}px` }}
                  className="space-y-1"
                >
                  {/* Header row: id + iter + rate + (optional active-tool spinner) */}
                  <div className="flex items-center gap-1.5">
                    {(t.depth || 0) > 0 && <span className="text-text-dim">├</span>}
                    <span className="text-text font-bold truncate">{t.id}</span>
                    <span className="text-text-muted shrink-0 text-[10px]">
                      #{t.iteration} {t.rate}
                    </span>
                    {t.model && (
                      <span className="text-text-dim shrink-0 text-[10px]">
                        {t.model}
                      </span>
                    )}
                    {activeToolByThread[t.id] && (
                      <span className="text-accent tool-active-line shrink-0 ml-auto text-[10px]">
                        ⟳ {activeToolByThread[t.id]}
                      </span>
                    )}
                  </div>

                  {/* MCP chips — on main these are the instance's
                      main-access servers; on sub-threads these are
                      whatever the thread was spawned with. */}
                  {t.mcp_names && t.mcp_names.length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-3">
                      <span className="text-[9px] text-text-dim shrink-0">
                        mcp:
                      </span>
                      {t.mcp_names.map((m) => (
                        <span
                          key={m}
                          className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent"
                          title={`MCP server attached: ${m}`}
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Directive — one line, truncated */}
                  {directiveLine && (
                    <div className="pl-3 flex items-start gap-1.5">
                      <span className="text-[9px] text-text-dim shrink-0 uppercase tracking-wide pt-[1px]">
                        {isMain ? "dir:" : "role:"}
                      </span>
                      <p
                        className="text-text-dim text-[10px] leading-snug line-clamp-1 flex-1"
                        title={directiveLine}
                      >
                        {directiveLine}
                      </p>
                    </div>
                  )}

                  {/* Last tool call */}
                  {lastTool && (
                    <div className="pl-3 flex items-center gap-1.5 text-[10px] min-w-0">
                      <span className="text-[9px] text-text-dim shrink-0 uppercase tracking-wide">
                        tool:
                      </span>
                      {/* Prefer the free-text reason over the slug everywhere.
                          The slug stays in the title attribute so power users
                          can still see exactly which tool fired. */}
                      {lastTool.done ? (
                        <>
                          <span
                            className={
                              lastTool.success ? "text-green shrink-0" : "text-red shrink-0"
                            }
                          >
                            ✓
                          </span>
                          <span
                            className="text-text-dim truncate"
                            title={lastTool.name}
                          >
                            {lastTool.reason || lastTool.name}
                          </span>
                          {lastTool.durationMs != null && (
                            <span className="text-text-muted shrink-0">
                              (
                              {lastTool.durationMs >= 1000
                                ? `${(lastTool.durationMs / 1000).toFixed(1)}s`
                                : `${lastTool.durationMs}ms`}
                              )
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="text-accent tool-active-line shrink-0">
                            ⟳
                          </span>
                          <span
                            className="text-accent truncate"
                            title={lastTool.name}
                          >
                            {lastTool.reason || lastTool.name}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MCP Servers attached to this instance */}
      <MCPPanel instanceId={instance.id} running={instance.status === "running"} />
      <ComputerPanel instanceId={instance.id} running={instance.status === "running"} />

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
                  <div key={i} className="flex items-center gap-1.5 min-w-0">
                    <span className={t.success ? "text-green" : "text-red"}>✓</span>
                    {t.reason ? (
                      <span className="text-text truncate" title={`${t.name}${dur ? ` (${dur})` : ""}`}>{t.reason}</span>
                    ) : (
                      <span className="text-text-dim">{t.name}</span>
                    )}
                    {dur && <span className="text-text-muted shrink-0">({dur})</span>}
                  </div>
                );
              }
              return (
                <div key={i} className="flex items-center gap-1.5 tool-active-line min-w-0">
                  <span className="text-accent shrink-0">⟳</span>
                  {t.reason ? (
                    <span
                      className="text-accent truncate"
                      title={t.name}
                    >
                      {t.reason}
                    </span>
                  ) : (
                    <span className="text-accent truncate">{t.name}</span>
                  )}
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

// Sort threads into depth-first tree order (children after their parent)
function orderThreadTree(threads: Thread[]): Thread[] {
  const children: Record<string, Thread[]> = {};
  const roots: Thread[] = [];

  for (const t of threads) {
    const pid = t.parent_id || "main";
    if (t.id === "main" || (!t.parent_id && !t.depth)) {
      roots.push(t);
    } else {
      if (!children[pid]) children[pid] = [];
      children[pid].push(t);
    }
  }

  const result: Thread[] = [];
  const walk = (node: Thread) => {
    result.push(node);
    for (const child of children[node.id] || []) walk(child);
  };
  for (const root of roots) walk(root);

  // Append orphans
  const seen = new Set(result.map((t) => t.id));
  for (const t of threads) {
    if (!seen.has(t.id)) result.push(t);
  }
  return result;
}
