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
  reasoning: boolean; // true = reasoning/thinking tokens, false = output
  time: number;
}

interface ToolEntry {
  id: string;
  name: string;
  reason: string;
  threadId: string;
  done: boolean;
  durationMs?: number;
  success?: boolean;
  time: number;
}

// IncomingEvent mirrors the CLI's "incoming events on thread" line — each
// event.received telemetry entry lands here and fades out over EVENT_FADE_MS.
// Rendered as a live-decaying list so the panel shows what's hitting the
// bus right now without turning into a permanent scrollback log.
interface IncomingEvent {
  id: string;
  threadId: string;
  source: string;   // "bus" | "console" | "thread" | "webhook" | …
  message: string;
  time: number;
}

// How long rows stay visible before fully fading out.
const EVENT_FADE_MS = 30_000;
const TOOL_FADE_MS = 60_000;

// formatToolTime renders a tool-call timestamp. Events from today show
// HH:MM:SS; older events show "MMM DD HH:MM" so historical replay of a
// multi-day session is unambiguous. The detail lives at row level so
// each entry can be read in isolation (e.g. when exported).
function formatToolTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}:${ss}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${hh}:${mm}`;
}

// Noisy internal tools that shouldn't clutter the Tool Calls list — same
// filter the ChatPanel uses. Keep this in sync with ChatPanel.hiddenTools.
const hiddenTools = new Set([
  "pace", "done", "evolve", "remember", "send",
  "channels_respond", "channels_status",
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
  const [incomingEvents, setIncomingEvents] = useState<IncomingEvent[]>([]);
  const [thinking, setThinking] = useState<Record<string, boolean>>({}); // threadId → thinking
  const [mode, setMode] = useState(instance.mode || "autonomous");

  // Reset state when instance changes
  useEffect(() => {
    setStatus(null);
    setThreads([]);
    setThoughts([]);
    setTools([]);
    setIncomingEvents([]);
    setThinking({});
  }, [instance.id]);

  // Re-render every 500ms for decay animation + GC of faded entries.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setIncomingEvents((prev) => {
        const alive = prev.filter((e) => e.time >= now - EVENT_FADE_MS);
        return alive.length !== prev.length ? alive : prev;
      });
      setTools((prev) => {
        const alive = prev.filter((t) => !t.done || t.time >= now - TOOL_FADE_MS);
        return alive.length !== prev.length ? alive : prev;
      });
      forceTick((n) => n + 1);
    }, 500);
    return () => clearInterval(t);
  }, []);

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

  // Stable ref for onReload so the subscriber effect doesn't re-run
  // when the parent re-renders (which would cause an unsub/resub gap
  // that drops events).
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;

  // Process SSE events — subscribe synchronously so every chunk is handled,
  // even when many arrive in the same React tick.
  useEffect(() => {
    return subscribe((event) => {
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

    // llm.start — agent started an LLM call, no tokens yet
    if (event.type === "llm.start") {
      setThinking((prev) => ({ ...prev, [event.thread_id || "main"]: true }));
      return;
    }

    // llm.thinking — reasoning tokens (separate from output)
    if (event.type === "llm.thinking" && data.text) {
      // Clear the "waiting" thinking state — reasoning tokens are arriving
      setThinking((prev) => {
        if (!prev[event.thread_id || "main"]) return prev;
        const next = { ...prev };
        delete next[event.thread_id || "main"];
        return next;
      });
      setThoughts((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].streaming && prev[i].reasoning && prev[i].threadId === event.thread_id) {
            const updated = [...prev];
            updated[i] = { ...updated[i], text: updated[i].text + data.text };
            return updated;
          }
        }
        return [...prev, {
          threadId: event.thread_id, text: data.text,
          iteration: Number(data.iteration) || 0,
          streaming: true, reasoning: true, time: Date.now(),
        }];
      });
      return;
    }

    if (event.type === "llm.chunk" && data.text) {
      // Clear thinking state — output tokens arriving
      setThinking((prev) => {
        if (!prev[event.thread_id || "main"]) return prev;
        const next = { ...prev };
        delete next[event.thread_id || "main"];
        return next;
      });
      // Close any open reasoning entry for this thread (reasoning phase done)
      setThoughts((prev) => {
        const updated = prev.map((t) =>
          t.streaming && t.reasoning && t.threadId === event.thread_id
            ? { ...t, streaming: false }
            : t,
        );
        return updated !== prev ? updated : prev;
      });
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
          streaming: true, reasoning: false, time: Date.now(),
        }];
      });
    }

    if (event.type === "llm.done") {
      // Clear thinking state
      setThinking((prev) => {
        if (!prev[event.thread_id || "main"]) return prev;
        const next = { ...prev };
        delete next[event.thread_id || "main"];
        return next;
      });
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
            reasoning: false,
            time: Date.now(),
          });
        }
        return updated.slice(-20);
      });
    }

    const toolName = String(data.name || "");
    const toolHidden = hiddenTools.has(toolName) || toolName.startsWith("channels_");

    if (event.type === "tool.call" && toolName && !toolHidden) {
      const callId = String(data.id || event.id || "");
      const eventTime = event.time ? new Date(event.time).getTime() : Date.now();
      setTools((prev) => {
        // Dedup: skip if a tool entry with this id already exists
        if (callId && prev.some((t) => t.id === callId)) return prev;
        return [...prev, {
          id: callId, name: toolName, reason: data.reason || "",
          threadId: event.thread_id, done: false, time: eventTime,
        }].slice(-20);
      });
    }

    if (event.type === "tool.result" && toolName && !toolHidden) {
      const callId = String(data.id || "");
      setTools((prev) => {
        const updated = [...prev];
        // Match by stable call id first, fall back to name
        for (let i = updated.length - 1; i >= 0; i--) {
          if (callId && updated[i].id === callId) {
            updated[i] = { ...updated[i], done: true, durationMs: data.duration_ms, success: data.success !== false };
            return updated;
          }
        }
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
      onReloadRef.current();
    }

    // event.received is the bus-drain telemetry — one entry per item the
    // thinker pulled from its subscriber channel each iteration. Mirrors
    // the CLI's "incoming events" line per thread. Push it into the
    // fade-out list so the UI shows what's landing on the bus right now.
    if (event.type === "event.received") {
      const source = String(data.source || "bus");
      const message = String(data.message || "");
      const eventTime = event.time ? new Date(event.time).getTime() : Date.now();
      const id = event.id || `${event.thread_id}:${eventTime}:${source}:${message.slice(0, 40)}`;
      setIncomingEvents((prev) => {
        if (prev.some((e) => e.id === id)) return prev;
        const next = [...prev, {
          id,
          threadId: event.thread_id || "main",
          source,
          message,
          time: eventTime,
        }];
        if (next.length > 50) next.splice(0, next.length - 50);
        return next;
      });
    }
    });
  }, [subscribe]);

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
          {Object.keys(thinking).length > 0 && (
            <span className="text-[10px] animate-pulse" style={{ color: "#a78bfa" }}>thinking</span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={async () => {
                const newMode = mode === "autonomous" ? "cautious" : "autonomous";
                await instances.updateConfig(instance.id, { mode: newMode });
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
                    {thinking[t.id] && !activeToolByThread[t.id] && (
                      <span className="animate-pulse shrink-0 ml-auto text-[10px]" style={{ color: "#a78bfa" }}>
                        thinking...
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
          <div className="space-y-1.5">
            {tools.slice(-8).map((t) => {
              const ts = formatToolTime(t.time);
              const opacity = t.done
                ? Math.max(0.05, 1 - (Date.now() - t.time) / TOOL_FADE_MS)
                : 1;
              if (t.done) {
                const dur = t.durationMs != null
                  ? t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`
                  : "";
                return (
                  <div key={t.id} className="min-w-0" style={{ opacity }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={t.success ? "text-green" : "text-red"}>✓</span>
                      {t.reason ? (
                        <span className="text-text truncate" title={`${t.name}${dur ? ` (${dur})` : ""}`}>{t.reason}</span>
                      ) : (
                        <span className="text-text-dim truncate">{t.name}</span>
                      )}
                      {dur && <span className="text-text-muted shrink-0">({dur})</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-text-dim pl-[18px]">
                      <span>{ts}</span>
                      <span>·</span>
                      <span className="truncate">{t.threadId || "main"}</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={t.id} className="min-w-0">
                  <div className="flex items-center gap-1.5 tool-active-line min-w-0">
                    <span className="text-accent shrink-0">⟳</span>
                    {t.reason ? (
                      <span className="text-accent truncate" title={t.name}>{t.reason}</span>
                    ) : (
                      <span className="text-accent truncate">{t.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-text-dim pl-[18px]">
                    <span>{ts}</span>
                    <span>·</span>
                    <span className="truncate">{t.threadId || "main"}</span>
                  </div>
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

      {/* Incoming Events — live stream of what's hitting each thread's
          bus, mirroring the CLI's "event.received" view. Each row fades
          out over EVENT_FADE_MS via an opacity-per-age calculation,
          giving a decaying-trail effect without turning into a permanent
          scrollback log. */}
      {incomingEvents.length > 0 && (
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-text-muted font-bold mb-2 uppercase tracking-wide text-[10px]">
            Incoming Events
          </h3>
          <div className="space-y-1">
            {[...incomingEvents].reverse().slice(0, 12).map((e) => {
              const age = Date.now() - e.time;
              const opacity = Math.max(0.05, 1 - age / EVENT_FADE_MS);
              const sourceColor =
                e.source === "webhook" ? "text-purple-400" :
                e.source === "console" ? "text-blue-400" :
                e.source === "thread" ? "text-green-400" :
                "text-text-dim";
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-1.5 min-w-0"
                  style={{ opacity }}
                >
                  <span className={`shrink-0 text-[9px] uppercase font-bold ${sourceColor}`}>
                    {e.source}
                  </span>
                  <span className="shrink-0 text-text-muted text-[10px]">
                    {e.threadId}
                  </span>
                  <span className="text-text-dim text-[10px] truncate flex-1" title={e.message}>
                    {e.message}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Thoughts */}
      {thoughts.length > 0 && (
        <div className="px-4 py-3 flex-1">
          <h3 className="text-text-muted font-bold mb-2 uppercase tracking-wide text-[10px]">Thoughts</h3>
          <div className="space-y-2">
            {thoughts.slice(-6).map((t, i) => (
              <div key={i}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  {t.streaming && (
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-pulse"
                      style={{ backgroundColor: t.reasoning ? "#a78bfa" : "var(--color-accent)" }}
                    />
                  )}
                  {t.reasoning && (
                    <span className="text-[9px] uppercase font-bold" style={{ color: "#a78bfa" }}>reasoning</span>
                  )}
                  <span className="text-text-muted">{t.threadId}</span>
                  <span className="text-text-dim ml-auto">#{t.iteration}</span>
                </div>
                <p
                  className={`leading-relaxed ${t.streaming && !t.reasoning ? "text-text" : "text-text-dim"}`}
                  style={t.streaming && t.reasoning ? { color: "#c4b5fd", fontStyle: "italic" } : undefined}
                >
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
