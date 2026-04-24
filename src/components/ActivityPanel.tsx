import { useState, useEffect, useRef } from "react";
import { core, instances, type Instance, type RunMode, type Status, type Thread } from "../api";
import type { SubscribeFn } from "./InstanceView";
import { MCPPanel } from "./MCPPanel";
import { ComputerPanel } from "./ComputerPanel";
import { Modal } from "./Modal";

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
  // streaming lifecycle for a call the LLM is still writing:
  //   state = "streaming" — tool_chunk deltas are still arriving, args partial.
  //   state = "called"    — tool.call has fired, args complete, execution in flight.
  //   state = "done"      — tool.result has landed.
  // All tools (built-in like spawn/evolve AND MCP) go through the same
  // `onToolChunk` path in core/thinker.go, so this applies uniformly.
  state: "streaming" | "called" | "done";
  streamingArgs?: string;        // accumulated raw JSON fragment from llm.tool_chunk
  streamKey?: string;             // thread_id#iter#toolName — used to match chunks to the eventual tool.call
  iteration?: number;
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

// Noisy internal tools that clutter the Tool Calls list. `pace` fires on
// every iteration-rate change (very often), `send`/`done` are glue
// calls, and `channels_*` is the outbound chat bridge — none of these
// tell the operator anything meaningful. Spawn/evolve/remember are the
// opposite: they're the agent's "big decisions" — which worker did it
// create, what rule did it just bake in, what did it decide to remember —
// and should always surface.
const hiddenTools = new Set([
  "pace", "done", "send",
  "channels_respond", "channels_status",
]);

// fmtK compacts token counts for the context gauge. Mirrors the helper
// used in FleetCards so both views read the same way.
function fmtK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// previewArgs builds a short summary for tool calls that didn't pass a
// `_reason` themselves. The agent calls spawn/evolve/remember with
// self-explanatory args (id + directive, new directive, remembered text)
// so the tool-call row is more useful showing a snippet of those than
// just the tool name.
function previewArgs(name: string, args: Record<string, any> | undefined): string {
  if (!args) return "";
  const trim = (s: any, n: number) => {
    const str = String(s || "").trim().replace(/\s+/g, " ");
    return str.length > n ? str.slice(0, n) + "…" : str;
  };
  switch (name) {
    case "spawn": {
      const id = args.id || "";
      const directive = trim(args.directive || args.prompt, 80);
      return id ? `spawn ${id}${directive ? " — " + directive : ""}` : "";
    }
    case "evolve":
      return "evolve: " + trim(args.directive, 120);
    case "remember":
      return "remember: " + trim(args.text, 120);
    case "update":
      return "update " + (args.id || "") + (args.directive ? " — " + trim(args.directive, 80) : "");
    case "kill":
      return "kill " + (args.id || "");
    default:
      return "";
  }
}

interface Props {
  instance: Instance;
  subscribe: SubscribeFn; // synchronous event fan-out from InstanceView's SSE
  onReload: () => void;
  // Optional: open the ThreadDetailModal for a thread id. When set, each
  // thread row in the Threads section becomes clickable and routes here.
  // Leaving unset keeps the panel read-only (useful in contexts that
  // don't render the detail modal).
  onThreadOpen?: (threadId: string) => void;
}

export function ActivityPanel({ instance, subscribe, onReload, onThreadOpen }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  // Per-thread context-window snapshot from the most recent llm.done on
  // that thread. Lets us render a "used / max (pct)" gauge for main and
  // every sub-thread so operators can see at a glance which threads are
  // running hot on their input window.
  const [ctxByThread, setCtxByThread] = useState<Record<string, { tokensIn: number; max: number; msgs: number }>>({});
  // Per-thread cumulative token totals + cost — every sub-thread emits
  // its own llm.done so we bucket them by thread_id here. Lets the UI
  // show who's burning what instead of just a single instance-wide sum.
  type ThreadUsage = { in: number; cached: number; out: number; cost: number; calls: number };
  const [usageByThread, setUsageByThread] = useState<Record<string, ThreadUsage>>({});
  // Kill-thread confirmation: stash the target thread id; Modal
  // renders when non-null. Kept separate from other panel state so
  // the destructive confirm has its own lifecycle.
  const [killTargetId, setKillTargetId] = useState<string | null>(null);
  const [killBusy, setKillBusy] = useState(false);
  const [killErr, setKillErr] = useState("");
  const [incomingEvents, setIncomingEvents] = useState<IncomingEvent[]>([]);
  const [thinking, setThinking] = useState<Record<string, boolean>>({}); // threadId → thinking
  // Thoughts are truncated to 150 chars in the panel to keep the rail
  // readable. Clicking one expands it in place — state is keyed by
  // threadId#iteration so the expansion survives re-renders even as
  // the thoughts array grows and the slice(-6) window slides.
  const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<RunMode>(
    (instance.mode as RunMode) || "autonomous",
  );

  // Reset state when instance changes
  useEffect(() => {
    setStatus(null);
    setThreads([]);
    setThoughts([]);
    setTools([]);
    setIncomingEvents([]);
    setThinking({});
    setCtxByThread({});
    setUsageByThread({});
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
      // Snapshot context-window stats for this thread. The llm.done
      // payload carries tokens_in + max_context_tokens every turn, so
      // we just overwrite the map entry and let the UI render the
      // latest. `main` uses event.thread_id = "main" or empty depending
      // on core version; normalise to "main" for the status gauge.
      const tid = event.thread_id || "main";
      const tokensIn = Number(data.tokens_in || 0);
      const max = Number(data.max_context_tokens || 0);
      const msgs = Number(data.context_msgs || 0);
      if (tokensIn > 0 || max > 0) {
        setCtxByThread((prev) => ({ ...prev, [tid]: { tokensIn, max, msgs } }));
      }
      // Cumulative token + cost per thread — add THIS turn's usage to
      // the running total. Unlike ctxByThread (a snapshot overwritten
      // every turn), this is a sum across every llm.done the thread
      // has emitted so far.
      const deltaIn = Number(data.tokens_in || 0);
      const deltaCached = Number(data.tokens_cached || 0);
      const deltaOut = Number(data.tokens_out || 0);
      const deltaCost = Number(data.cost_usd || 0);
      if (deltaIn > 0 || deltaOut > 0 || deltaCost > 0) {
        setUsageByThread((prev) => {
          const cur = prev[tid] || { in: 0, cached: 0, out: 0, cost: 0, calls: 0 };
          return {
            ...prev,
            [tid]: {
              in: cur.in + deltaIn,
              cached: cur.cached + deltaCached,
              out: cur.out + deltaOut,
              cost: cur.cost + deltaCost,
              calls: cur.calls + 1,
            },
          };
        });
      }
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

    // llm.tool_chunk arrives BEFORE tool.call — the LLM is still streaming the
    // argument JSON. Same callback fires for built-ins (spawn, evolve) and MCP
    // tools (core/thinker.go:1588 onToolChunk). We open a streaming entry on
    // first chunk and accumulate, so the UI shows args materialising in real
    // time instead of popping in only when the call is dispatched.
    if (event.type === "llm.tool_chunk") {
      const chunkTool = String(data.tool || "");
      if (!chunkTool) return;
      if (hiddenTools.has(chunkTool) || chunkTool.startsWith("channels_")) return;
      const chunk = String(data.chunk || "");
      const iter = Number(data.iteration) || 0;
      const threadId = event.thread_id || "main";
      // Include the per-call id so two parallel calls of the same tool in
      // one iteration get their own streaming rows rather than merging.
      // Older cores emit no id — we fall back to tool name only then.
      const chunkCallID = String(data.id || "");
      // Match on (thread, tool, callID) — iteration is intentionally
      // excluded because tool.call telemetry omits it (ToolCallData has
      // no iteration field), so keying on iter would split rows that
      // belong to the same call. callID alone disambiguates parallel
      // calls; (thread, tool) is a safety net when callID is empty.
      const key = `${threadId}#${chunkTool}#${chunkCallID}`;
      const now = event.time ? new Date(event.time).getTime() : Date.now();
      setTools((prev) => {
        const updated = [...prev];
        // Match an existing streaming entry first (same thread+tool+id).
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].state === "streaming" && updated[i].streamKey === key) {
            updated[i] = {
              ...updated[i],
              streamingArgs: (updated[i].streamingArgs || "") + chunk,
            };
            return updated;
          }
        }
        // First chunk for this (thread, tool, id) — open a new entry.
        return [...updated, {
          id: "", name: chunkTool, reason: "",
          threadId, done: false, time: now,
          state: "streaming",
          streamingArgs: chunk,
          streamKey: key,
          iteration: iter,
        }].slice(-20);
      });
      return;
    }

    if (event.type === "tool.call" && toolName && !toolHidden) {
      const callId = String(data.id || event.id || "");
      const eventTime = event.time ? new Date(event.time).getTime() : Date.now();
      // Prefer the agent-provided _reason (captured by core as data.reason)
      // and fall back to a summary of the key args for spawn/evolve/remember
      // so the row is still informative when the LLM didn't attach one.
      const reason = data.reason || previewArgs(toolName, data.args);
      const iter = Number(data.iteration) || 0;
      const threadId = event.thread_id || "main";
      // Same key shape as llm.tool_chunk (no iteration — tool.call
      // telemetry doesn't carry it).
      const streamKey = `${threadId}#${toolName}#${callId}`;
      setTools((prev) => {
        // Dedup: skip if a tool entry with this call id already exists.
        if (callId && prev.some((t) => t.id === callId && t.state !== "streaming")) return prev;
        const updated = [...prev];
        // Upgrade a matching streaming entry in place instead of adding a
        // second row. Matching by streamKey is tighter than name because a
        // single LLM turn can emit two calls to the same tool with
        // different args.
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].state === "streaming" && updated[i].streamKey === streamKey) {
            updated[i] = {
              ...updated[i],
              id: callId,
              reason,
              state: "called",
              time: eventTime,
            };
            return updated;
          }
        }
        return [...updated, {
          id: callId, name: toolName, reason,
          threadId, done: false, time: eventTime,
          state: "called",
          iteration: iter,
          streamKey,
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
            updated[i] = { ...updated[i], done: true, state: "done", durationMs: data.duration_ms, success: data.success !== false };
            return updated;
          }
        }
        for (let i = updated.length - 1; i >= 0; i--) {
          if (!updated[i].done && updated[i].name === toolName) {
            updated[i] = { ...updated[i], done: true, state: "done", durationMs: data.duration_ms, success: data.success !== false };
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
      setMode(data.mode as RunMode);
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
                // Cycle through all three modes the core supports.
                // autonomous → cautious → learn → autonomous.
                const next: Record<RunMode, RunMode> = {
                  autonomous: "cautious",
                  cautious: "learn",
                  learn: "autonomous",
                };
                const newMode = next[mode] ?? "autonomous";
                await instances.updateConfig(instance.id, { mode: newMode });
                setMode(newMode);
              }}
              className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                mode !== "autonomous" ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent"
              }`}
              title="click to cycle safety mode: autonomous → cautious → learn"
            >
              {mode}
            </button>
          </div>
        </div>
        {status && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-muted">
            <span>iter</span><span className="text-text">{status.iteration}</span>
            <span>rate</span><span className={`px-1.5 py-0.5 rounded text-[10px] w-fit ${
              status.rate === "reactive" ? "bg-green/15 text-green" :
              status.rate === "fast" ? "bg-accent/15 text-accent" :
              status.rate === "normal" ? "bg-blue/15 text-blue" :
              status.rate === "slow" ? "bg-border text-text-muted" :
              status.rate === "sleep" ? "bg-red/10 text-red/70" :
              "bg-border text-text-muted"
            }`}>{status.rate}</span>
            <span>model</span><span className="text-text truncate">{status.model}</span>
            <span>uptime</span><span className="text-text">{formatUptime(status.uptime_seconds)}</span>
            <span>memory</span><span className="text-text">{status.memories}</span>
            {(() => {
              const u = usageByThread["main"];
              if (!u || u.calls === 0) return null;
              return (
                <>
                  <span>tokens</span>
                  <span
                    className="text-text"
                    title={`${u.in.toLocaleString()} in (${u.cached.toLocaleString()} cached) · ${u.out.toLocaleString()} out · ${u.calls} calls`}
                  >
                    {fmtK(u.in)} in · {fmtK(u.out)} out
                  </span>
                  <span>cost</span>
                  <span className="text-text">${u.cost.toFixed(4)}</span>
                </>
              );
            })()}
            {(() => {
              const c = ctxByThread["main"];
              if (!c || c.tokensIn === 0) return null;
              const pct = c.max > 0 ? Math.min(100, Math.round((c.tokensIn / c.max) * 100)) : 0;
              const pctColor = pct >= 90 ? "text-red" : pct >= 70 ? "text-yellow-500" : "text-text";
              const barColor = pct >= 90 ? "bg-red" : pct >= 70 ? "bg-yellow-500" : "bg-accent";
              return (
                <>
                  <span>context</span>
                  <span className="flex flex-col gap-0.5">
                    <span className={pctColor}>
                      {fmtK(c.tokensIn)}
                      {c.max > 0 && <> / {fmtK(c.max)} ({pct}%)</>}
                    </span>
                    {c.max > 0 && (
                      <span className="inline-block h-1 w-full bg-border rounded overflow-hidden">
                        <span className={`block h-full ${barColor}`} style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </span>
                </>
              );
            })()}
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
                  className={`space-y-1 ${onThreadOpen ? "cursor-pointer hover:bg-bg-hover/40 rounded px-1 -mx-1 transition-colors" : ""}`}
                  onClick={onThreadOpen ? () => onThreadOpen(t.id) : undefined}
                  title={onThreadOpen ? "Open thread — live events, history, and context" : undefined}
                >
                  {/* Header row: id + iter + rate + (optional active-tool spinner) */}
                  <div className="flex items-center gap-1.5">
                    {(t.depth || 0) > 0 && <span className="text-text-dim">├</span>}
                    <span className="text-text font-bold truncate">{t.id}</span>
                    <span className="text-text-muted shrink-0 text-[10px]">
                      #{t.iteration}
                    </span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                      t.rate === "reactive" ? "bg-green/15 text-green" :
                      t.rate === "fast" ? "bg-accent/15 text-accent" :
                      t.rate === "normal" ? "bg-blue/15 text-blue" :
                      t.rate === "slow" ? "bg-border text-text-muted" :
                      t.rate === "sleep" ? "bg-red/10 text-red/70" :
                      "bg-border text-text-muted"
                    }`}>{t.rate}</span>
                    {(() => {
                      const c = ctxByThread[t.id];
                      if (!c || c.tokensIn === 0) return null;
                      const pct = c.max > 0 ? Math.min(100, Math.round((c.tokensIn / c.max) * 100)) : 0;
                      const color = pct >= 90 ? "text-red" : pct >= 70 ? "text-yellow-500" : "text-text-muted";
                      const label = c.max > 0
                        ? `${fmtK(c.tokensIn)}/${fmtK(c.max)} (${pct}%)`
                        : fmtK(c.tokensIn);
                      return (
                        <span
                          className={`shrink-0 text-[10px] ${color}`}
                          title={`context: ${c.tokensIn.toLocaleString()}${c.max > 0 ? ` / ${c.max.toLocaleString()} tokens` : ""}`}
                        >
                          ctx {label}
                        </span>
                      );
                    })()}
                    {(() => {
                      const u = usageByThread[t.id];
                      if (!u || u.calls === 0) return null;
                      return (
                        <span
                          className="shrink-0 text-[10px] text-text-dim"
                          title={`${u.in.toLocaleString()} in (${u.cached.toLocaleString()} cached) · ${u.out.toLocaleString()} out · ${u.calls} llm calls`}
                        >
                          {fmtK(u.in + u.out)}tok · ${u.cost.toFixed(4)}
                        </span>
                      );
                    })()}
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
                    {!isMain && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setKillErr("");
                          setKillTargetId(t.id);
                        }}
                        className="ml-auto shrink-0 text-text-muted hover:text-red transition-colors text-[10px] px-1"
                        title="Kill this sub-thread"
                      >
                        ✕
                      </button>
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
            {tools.slice(-8).map((t, idx) => {
              const ts = formatToolTime(t.time);
              const opacity = t.state === "done"
                ? Math.max(0.05, 1 - (Date.now() - t.time) / TOOL_FADE_MS)
                : 1;
              // React key: id is only set after tool.call fires. During
              // streaming we key off streamKey + index so the row is
              // stable across chunk ticks.
              const rowKey = t.id || t.streamKey || `idx-${idx}`;

              // --- 1. streaming: args JSON materialising live ---
              if (t.state === "streaming") {
                const args = (t.streamingArgs || "").trim();
                return (
                  <div key={rowKey} className="min-w-0">
                    <div className="flex items-center gap-1.5 tool-active-line min-w-0">
                      <span className="text-yellow shrink-0 animate-pulse">◐</span>
                      <span className="text-yellow shrink-0 font-mono">{t.name}</span>
                      <span className="text-text-dim shrink-0">starting…</span>
                    </div>
                    {args && (
                      <pre className="text-[10px] text-text-dim pl-[18px] font-mono whitespace-pre-wrap break-all max-h-20 overflow-y-auto leading-tight">
                        {args}
                      </pre>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-text-dim pl-[18px]">
                      <span>{ts}</span>
                      <span>·</span>
                      <span className="truncate">{t.threadId || "main"}</span>
                    </div>
                  </div>
                );
              }

              // --- 2. done: completed call, fades over TOOL_FADE_MS ---
              if (t.state === "done") {
                const dur = t.durationMs != null
                  ? t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`
                  : "";
                return (
                  <div key={rowKey} className="min-w-0" style={{ opacity }}>
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

              // --- 3. called: args finalized, execution in flight ---
              return (
                <div key={rowKey} className="min-w-0">
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
            {thoughts.slice(-6).map((t, i) => {
              const key = `${t.threadId}#${t.iteration}`;
              const expanded = expandedThoughts.has(key);
              const truncated = t.text.length > 150;
              const display = expanded || !truncated ? t.text : t.text.slice(0, 150) + "...";
              return (
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
                    onClick={
                      truncated
                        ? () =>
                            setExpandedThoughts((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                        : undefined
                    }
                    className={`leading-relaxed ${t.streaming && !t.reasoning ? "text-text" : "text-text-dim"} ${truncated ? "cursor-pointer hover:text-text" : ""}`}
                    style={t.streaming && t.reasoning ? { color: "#c4b5fd", fontStyle: "italic" } : undefined}
                    title={truncated ? (expanded ? "Click to collapse" : "Click to expand") : undefined}
                  >
                    {display}
                    {t.streaming && <span className="tool-cursor">▊</span>}
                    {truncated && !t.streaming && (
                      <span className="text-text-dim text-[9px] ml-1">
                        {expanded ? "[collapse]" : "[expand]"}
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={!!killTargetId} onClose={() => !killBusy && setKillTargetId(null)}>
        <div className="p-6 w-[480px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">
            Kill thread <code className="text-text-muted">{killTargetId}</code>?
          </h2>
          <p className="text-text-dim text-xs leading-snug">
            The thread stops iterating immediately and is removed from
            the persisted config so it won't respawn on the next boot.
            Its children (if any) get killed too. This can't be undone —
            you'd have to re-spawn from the parent directive.
          </p>
          {killErr && <div className="text-red text-xs">{killErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setKillTargetId(null)}
              disabled={killBusy}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (!killTargetId) return;
                setKillBusy(true);
                setKillErr("");
                try {
                  await core.killThread(instance.id, killTargetId);
                  setThreads((prev) => prev.filter((x) => x.id !== killTargetId));
                  setKillTargetId(null);
                } catch (e: any) {
                  setKillErr(e?.message || "kill failed");
                } finally {
                  setKillBusy(false);
                }
              }}
              disabled={killBusy}
              className="px-4 py-2 bg-red text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
            >
              {killBusy ? "Killing…" : "Kill"}
            </button>
          </div>
        </div>
      </Modal>
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
