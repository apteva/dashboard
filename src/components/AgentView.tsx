import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import {
  apps as appsAPI,
  channels,
  core,
  instances,
  providers as providersAPI,
  type Agent,
  type AppRow,
  type ChannelInfo,
  type ExecutionControlStatus,
  type MCPServerConfig,
  type ModelInfo,
  type Provider,
  type ProviderDetail,
  type TelemetryEvent,
  type Thread,
} from "../api";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";

export type EventListener = (event: TelemetryEvent) => void;
export type SubscribeFn = (listener: EventListener) => () => void;
import { ChatPanel } from "./ChatPanel";
import { ActivityPanel } from "./ActivityPanel";
import { MemoryPanel } from "./MemoryPanel";
import { UnconsciousPanel } from "./UnconsciousPanel";
import { InjectPanel } from "./InjectPanel";
import { FleetGraph, type FleetEvent } from "./FleetGraph";
import { FleetCards } from "./FleetCards";
import { ThreadDetailModal } from "./ThreadDetailModal";
import { AppPanels } from "./AppPanels";
import { Modal } from "./Modal";
import { LiveStatsBar } from "./LiveStatsBar";
import { SkillsPanel } from "./SkillsPanel";
import { EvalsPanel } from "./EvalsPanel";

type RuntimeView = "stream" | "activity" | "fleet" | "cards" | "memory" | "unconscious" | "skills" | "apps" | "evals";

interface RuntimeEventItem {
  key: string;
  kind: "thought" | "tool" | "thread" | "channel" | "error" | "event";
  label: string;
  detail?: string;
  threadId?: string;
  status?: "running" | "success" | "error" | "info";
  durationMs?: number;
  time: string;
  raw: TelemetryEvent;
}

const MAX_RUNTIME_EVENTS = 250;

function compactText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s || fallback;
}

function durationLabel(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function toolEventKey(ev: TelemetryEvent, name: string): string {
  const id = compactText(ev.data?.id);
  return `tool:${id || `${ev.thread_id || "main"}:${name}`}`;
}

function thoughtEventKey(ev: TelemetryEvent): string {
  const data = ev.data || {};
  const iteration = data.iteration != null ? String(data.iteration) : "";
  return `thought:${ev.thread_id || "main"}:${iteration || ev.id || ev.time}`;
}

function normalizeRuntimeEvent(ev: TelemetryEvent): RuntimeEventItem | null {
  const data = ev.data || {};
  const threadId = ev.thread_id || "main";
  const base = {
    threadId,
    time: ev.time,
    raw: ev,
  };

  if (ev.type === "tool.call") {
    const name = compactText(data.name);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_status"].includes(name)) return null;
    const reason = compactText(data.reason, `Running ${name}`);
    return {
      ...base,
      key: toolEventKey(ev, name),
      kind: "tool",
      label: reason,
      detail: name,
      status: "running",
    };
  }

  if (ev.type === "tool.result") {
    const name = compactText(data.name || data.tool);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_status"].includes(name)) return null;
    const failed = !!data.is_error;
    return {
      ...base,
      key: toolEventKey(ev, name),
      kind: "tool",
      label: compactText(data.reason, name),
      detail: failed ? compactText(data.error || data.message, "Tool failed") : name,
      status: failed ? "error" : "success",
      durationMs: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
    };
  }

  if (ev.type === "llm.start") {
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "thought",
      label: "Thinking",
      detail: compactText(data.model),
      status: "running",
    };
  }

  if (ev.type === "llm.done") {
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "thought",
      label: "Completed reasoning step",
      detail: compactText(data.message || data.model),
      status: "success",
      durationMs: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
    };
  }

  if (ev.type === "llm.error") {
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "error",
      label: "LLM error",
      detail: compactText(data.error || data.message),
      status: "error",
    };
  }

  if (ev.type.startsWith("execution.")) {
    return null;
  }

  if (ev.type === "thread.spawn") {
    return {
      ...base,
      key: ev.id || `thread-spawn:${threadId}:${ev.time}`,
      kind: "thread",
      label: `Spawned ${compactText(data.name || threadId, threadId)}`,
      detail: compactText(data.directive),
      status: "info",
    };
  }

  if (ev.type === "thread.done") {
    return {
      ...base,
      key: ev.id || `thread-done:${threadId}:${ev.time}`,
      kind: "thread",
      label: `Finished ${threadId}`,
      status: "success",
    };
  }

  if (ev.type === "event.received") {
    const msg = compactText(data.message);
    if (!msg) return null;
    const internal = ["admin", "system", "inject"].some((c) => msg.startsWith(`[${c}]`));
    if (internal) return null;
    return {
      ...base,
      key: ev.id || `event:${threadId}:${ev.time}:${msg.slice(0, 24)}`,
      kind: "channel",
      label: msg,
      detail: compactText(data.source),
      status: "info",
    };
  }

  if (ev.type === "thread.message") {
    return {
      ...base,
      key: ev.id || `thread-message:${threadId}:${ev.time}`,
      kind: "thread",
      label: compactText(data.message, "Thread message"),
      detail: compactText(data.from && data.to ? `${data.from} -> ${data.to}` : ""),
      status: "info",
    };
  }

  if (ev.type.includes("error")) {
    return {
      ...base,
      key: ev.id || `error:${threadId}:${ev.time}`,
      kind: "error",
      label: compactText(data.error || data.message || ev.type, ev.type),
      status: "error",
    };
  }

  return null;
}

function mergeRuntimeEvent(prev: RuntimeEventItem[], ev: TelemetryEvent): RuntimeEventItem[] {
  const item = normalizeRuntimeEvent(ev);
  if (!item) return prev;
  const idx = prev.findIndex((r) => r.key === item.key);
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = {
      ...next[idx],
      ...item,
      label:
        item.kind === "tool" && item.status !== "running" && item.label === item.detail
          ? next[idx].label
          : item.label || next[idx].label,
      detail: item.detail || next[idx].detail,
    };
    return next;
  }
  return [...prev, item].slice(-MAX_RUNTIME_EVENTS);
}

function telemetryTimeMs(ev: TelemetryEvent): number {
  const ms = Date.parse(ev.time || "");
  return Number.isFinite(ms) ? ms : 0;
}

function restoreCheckpointMs(ev: TelemetryEvent): number {
  if (ev.type !== "execution.restored") return 0;
  const ms = Date.parse(String(ev.data?.checkpoint_time || ""));
  return Number.isFinite(ms) ? ms : 0;
}

// AgentView is the rich per-instance view: chat panel + activity/fleet/cards
// side panel, lifecycle controls (start/stop/pause/delete), thread detail
// modal. Used by the /instances/:id route to render whichever instance the
// user navigated to.
//
// onDelete runs the API call + parent-side cleanup. The modal awaits
// it, so it must reject (not just return) on failure — otherwise the
// modal would close with no error message. onReload is called after
// lifecycle actions (start/stop) so the parent can refresh its
// instance metadata.
export function AgentView({
  instance,
  onDelete,
  onReload,
  initialThreads = [],
}: {
  instance: Agent;
  onDelete: () => void | Promise<void>;
  onReload: () => void;
  initialThreads?: Thread[];
}) {
  // Event bus for fan-out to sibling panels.
  //
  // We used to pass the latest SSE event as a React state prop (`latestEvent`)
  // to ActivityPanel/FleetCards. That was broken for streaming text: when
  // several llm.chunk events arrive in the same React tick, setLatestEvent
  // is called rapidly and only the *last* event survives the render — every
  // intermediate chunk is dropped, which is exactly the "missing middle
  // words" symptom we saw in the Thoughts panel.
  //
  // Instead, panels register a synchronous listener via `subscribe(cb)` and
  // receive every event in order with no batching.
  const listenersRef = useRef<Set<EventListener>>(new Set());
  // Top-level event-id dedup for handleEvent. Bounded at 500.
  const seenHandledEventsRef = useRef<Set<string>>(new Set());
  const seenHandledOrderRef = useRef<string[]>([]);
  // Live events (llm.tool_chunk, etc.) have no event.id — dedup them
  // by a (type|thread|time|tool|chunk-prefix) hash so StrictMode's
  // double-mount SSE doesn't feed every chunk through twice.
  const seenLiveRef = useRef<Set<string>>(new Set());
  const seenLiveOrderRef = useRef<string[]>([]);
  const subscribe: SubscribeFn = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [view, setView] = useState<RuntimeView>("stream");
  // Whether the channels MCP is currently attached to this instance.
  // When the user detaches it via the MCP panel the chat bridge stops
  // receiving user messages — we gray out the chat column to make that
  // state obvious instead of silently dropping typed messages.
  const [channelsAttached, setChannelsAttached] = useState(true);

  // Track threads, tools, thoughts, events for the fleet graph
  const [graphThreads, setGraphThreads] = useState<Thread[]>(initialThreads);
  const [graphActiveTools, setGraphActiveTools] = useState<Record<string, string>>({});
  const [graphThoughts, setGraphThoughts] = useState<Record<string, string>>({});
  const [graphEvents, setGraphEvents] = useState<FleetEvent[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEventItem[]>([]);

  // Thread detail modal
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadLiveEvents, setThreadLiveEvents] = useState<Record<string, TelemetryEvent[]>>({});

  // Reset all live state when the instance changes — critical because
  // react-router keeps the component mounted when navigating between
  // /instances/:id → /instances/:other, and stale threads from the previous
  // instance would otherwise leak into the fleet graph.
  useEffect(() => {
    setGraphThreads(initialThreads);
    setGraphActiveTools({});
    setGraphThoughts({});
    setGraphEvents([]);
    setRuntimeEvents([]);
    setThreadLiveEvents({});
    seenHandledEventsRef.current = new Set();
    seenHandledOrderRef.current = [];
    seenLiveRef.current = new Set();
    seenLiveOrderRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  // Poll instance config for the channels MCP presence so the chat
  // panel can gray itself out when an operator detaches channels from
  // the MCP list. 5s cadence matches the MCP panel's own refresh so
  // the two views stay in sync.
  useEffect(() => {
    if (instance.status !== "running") {
      setChannelsAttached(false);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      core.config(instance.id)
        .then((c) => {
          if (cancelled) return;
          const has = (c.mcp_servers || []).some(
            (s) => s.name === "channels" || s.name === "apteva-channels",
          );
          setChannelsAttached(has);
        })
        .catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [instance.id, instance.status]);

  // Top-level dedup. ChatPanel's EventSource is the single source of truth
  // for SSE in this view; if the same event.id arrives twice (StrictMode
  // double-mount, browser EventSource reconnect, etc.) we drop the
  // duplicate here so neither the fan-out subscribers nor the local
  // state mutations below ever see it twice. This is the belt; the
  // panels (ChatPanel, ActivityPanel) keep their own dedup as
  // suspenders, since they each have rendering paths that historically
  // produced visible duplicates.
  const handleEvent = (event: TelemetryEvent) => {
    if (event.id) {
      if (seenHandledEventsRef.current.has(event.id)) return;
      seenHandledEventsRef.current.add(event.id);
      seenHandledOrderRef.current.push(event.id);
      if (seenHandledOrderRef.current.length > 500) {
        const old = seenHandledOrderRef.current.shift();
        if (old) seenHandledEventsRef.current.delete(old);
      }
    } else {
      // Live event (no id). Build a best-effort dedup key. Collisions
      // would require two live events with identical type + thread +
      // timestamp + tool + first 40 chars of payload — vanishingly
      // unlikely in practice.
      const d = event.data || {};
      const key = [
        event.type,
        event.thread_id || "",
        event.time || "",
        String((d as any).tool || (d as any).name || ""),
        String((d as any).id || ""),
        String((d as any).chunk || "").slice(0, 40),
        String((d as any).text || "").slice(0, 40),
      ].join("|");
      if (seenLiveRef.current.has(key)) return;
      seenLiveRef.current.add(key);
      seenLiveOrderRef.current.push(key);
      if (seenLiveOrderRef.current.length > 1000) {
        const old = seenLiveOrderRef.current.shift();
        if (old) seenLiveRef.current.delete(old);
      }
    }
    const restoreMs = restoreCheckpointMs(event);
    if (restoreMs > 0) {
      setRuntimeEvents((prev) => prev.filter((e) => telemetryTimeMs(e.raw) < restoreMs));
      setThreadLiveEvents((prev) => {
        const next: Record<string, TelemetryEvent[]> = {};
        for (const [threadId, events] of Object.entries(prev)) {
          const kept = events.filter((e) => telemetryTimeMs(e) < restoreMs);
          if (kept.length > 0) next[threadId] = kept;
        }
        return next;
      });
      setGraphEvents((prev) => prev.filter((e) => e.time < restoreMs));
      setGraphActiveTools({});
      setGraphThoughts({});
    }
    // Fan out to every subscribed panel synchronously — no React batching.
    listenersRef.current.forEach((cb) => cb(event));
    const data = event.data || {};
    setRuntimeEvents((prev) => mergeRuntimeEvent(prev, event));

    // Collect live events per thread for detail modal
    if (event.thread_id) {
      setThreadLiveEvents((prev) => {
        const arr = prev[event.thread_id] || [];
        return { ...prev, [event.thread_id]: [...arr.slice(-200), event] };
      });
    }

    // Track threads
    if (event.type === "thread.spawn") {
      setGraphThreads((prev) => {
        if (prev.some((t) => t.id === event.thread_id)) return prev;
        const parentId = data.parent_id || "main";
        let depth = 0;
        if (parentId !== "main") {
          const parent = prev.find((t) => t.id === parentId);
          depth = parent ? (parent.depth || 0) + 1 : 1;
        }
        return [...prev, { id: event.thread_id, parent_id: parentId, depth, directive: data.directive || "", tools: [], iteration: 0, rate: "reactive", model: "", age: "0s" }];
      });
    }
    if (event.type === "thread.done") {
      setGraphThreads((prev) => prev.filter((t) => t.id !== event.thread_id));
      setGraphActiveTools((prev) => { const n = { ...prev }; delete n[event.thread_id]; return n; });
      setGraphThoughts((prev) => { const n = { ...prev }; delete n[event.thread_id]; return n; });
    }
    if (event.type === "thread.renamed") {
      const oldID = String(data.old_id || event.thread_id || "");
      const newID = String(data.new_id || oldID);
      const newName = String(data.name || "");
      setGraphThreads((prev) => prev.map((t) => {
        if (t.id === oldID) return { ...t, id: newID, name: newName };
        if (oldID !== newID && t.parent_id === oldID) return { ...t, parent_id: newID };
        return t;
      }));
      if (oldID !== newID) {
        setGraphActiveTools((prev) => {
          if (!(oldID in prev)) return prev;
          const n = { ...prev };
          n[newID] = n[oldID];
          delete n[oldID];
          return n;
        });
        setGraphThoughts((prev) => {
          if (!(oldID in prev)) return prev;
          const n = { ...prev };
          n[newID] = n[oldID];
          delete n[oldID];
          return n;
        });
      }
    }

    // Track active tools — keep visible for 3s after completion
    // Skip noisy inline tools (send, pace, done, evolve, remember) and channels from display
    const hiddenTools = new Set(["send", "pace", "done", "evolve", "remember", "channels_respond", "channels_status"]);
    const toolName = String(data.name || "");
    const showTool = event.thread_id && toolName && !hiddenTools.has(toolName) && !toolName.startsWith("channels_");

    if (event.type === "tool.call" && showTool) {
      setGraphActiveTools((prev) => ({ ...prev, [event.thread_id]: toolName }));
      setGraphEvents((prev) => [...prev.slice(-30), { type: "tool", from: event.thread_id, to: event.thread_id, text: toolName, time: Date.now() }]);
    }
    if (event.type === "tool.result" && showTool) {
      const threadId = event.thread_id;
      const toolName = data.name;
      setTimeout(() => {
        setGraphActiveTools((prev) => {
          if (prev[threadId] === toolName) {
            const n = { ...prev };
            delete n[threadId];
            return n;
          }
          return prev;
        });
      }, 3000);
    }

    // Track thread messages (from→to communication)
    if (event.type === "thread.message") {
      const from = data.from || event.thread_id;
      const to = data.to || "";
      if (from && to) {
        setGraphEvents((prev) => [...prev.slice(-30), { type: "message", from, to, text: data.message, time: Date.now() }]);
      }
    }

    // Track event.received (messages arriving at threads)
    if (event.type === "event.received" && data.source === "thread") {
      const msg = String(data.message || "");
      const match = msg.match(/\[from:(\S+)\]/);
      if (match) {
        setGraphEvents((prev) => [...prev.slice(-30), { type: "message", from: match[1], to: event.thread_id, text: msg.slice(0, 60), time: Date.now() }]);
      }
    }

    // Track thoughts
    if (event.type === "llm.done" && data.message) {
      const text = String(data.message).slice(0, 100);
      setGraphThoughts((prev) => ({ ...prev, [event.thread_id]: text }));
      setGraphThreads((prev) => prev.map((t) =>
        t.id === event.thread_id ? { ...t, iteration: data.iteration || t.iteration, rate: data.rate || t.rate } : t
      ));
    }
  };

  // Telemetry input — consumes the project-wide bus
  // (window.__aptevaTelemetryBus) filtered to this instance. Pre-bus
  // we opened a per-instance EventSource against
  // /api/instances/<id>/events; that worked but every instance page
  // we navigated to spent a connection-budget slot on its own SSE,
  // duplicating events the dashboard was already pulling for
  // ActivityFeed / Agents list. The bus collapses all telemetry
  // consumers in the dashboard onto ONE socket per project.
  //
  // Every incoming event goes through handleEvent (top-level dedup)
  // which then fans out to every subscribe(cb) caller. The chat
  // panel's status dot + the stats badge + Activity + FleetCards are
  // all downstream of this one stream.
  //
  // NB: this call MUST live below `const handleEvent = …`. The hook
  // reads its callback synchronously to populate a ref; if we placed
  // it above the const, we'd hit a TDZ ("Cannot access … before
  // initialization") on every render. Keeping it here also matches
  // the order rule for hooks — same call sequence on every render.
  useTelemetryEvents(
    instance.status === "running" ? instance.id : undefined,
    handleEvent,
  );

  // Sync threads from poll (works for both running and stopped)
  useEffect(() => {
    const poll = () => {
      core.threads(instance.id).then(setGraphThreads).catch(() => {});
    };
    poll();
    if (instance.status !== "running") return;
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [instance.id, instance.status]);

  const advancedContent =
    view === "activity" ? (
      <ActivityPanel instance={instance} subscribe={subscribe} onReload={onReload} onThreadOpen={setSelectedThreadId} />
    ) : view === "fleet" ? (
      <FleetGraph threads={graphThreads} activeTools={graphActiveTools} thoughts={graphThoughts} events={graphEvents} onNodeClick={setSelectedThreadId} />
    ) : view === "memory" ? (
      instance.status === "running" ? (
        <MemoryPanel instanceId={instance.id} />
      ) : (
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Start the agent to view its memory.
        </div>
      )
    ) : view === "unconscious" ? (
      instance.status === "running" ? (
        <UnconsciousPanel instanceId={instance.id} />
      ) : (
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Start the agent to view its unconscious activity.
        </div>
      )
    ) : view === "skills" ? (
      <SkillsPanel instanceId={instance.id} />
    ) : view === "apps" ? (
      <div className="h-full overflow-auto p-3 space-y-3">
        <AppPanels
          slot="instance.tab"
          instanceId={instance.id}
          projectId={instance.project_id || undefined}
          className="space-y-3"
        />
      </div>
    ) : view === "evals" ? (
      <EvalsPanel agentID={instance.id} />
    ) : view === "cards" ? (
      <FleetCards threads={graphThreads} subscribe={subscribe} activeTools={graphActiveTools} thoughts={graphThoughts} />
    ) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Reset confirmation */}
      <Modal open={showResetConfirm} onClose={() => setShowResetConfirm(false)}>
        <div className="p-6">
          <h3 className="text-text text-lg font-bold mb-2">Reset Agent</h3>
          <p className="text-text-dim text-sm mb-6">
            Wipe <span className="text-text font-bold">{instance.name}</span>'s conversation history and kill every sub-thread?
            Directive, MCP servers, and integrations are kept. This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
              disabled={resetBusy}
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setResetBusy(true);
                try {
                  await core.resetInstance(instance.id, { history: true, threads: true });
                  setShowResetConfirm(false);
                  onReload();
                } finally {
                  setResetBusy(false);
                }
              }}
              disabled={resetBusy}
              className="px-4 py-2 bg-yellow text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {resetBusy ? "resetting…" : "Reset"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation. Mirrors the Reset modal: busy state
          disables the buttons, errors surface inline. The modal stays
          open until the API call resolves so a failure doesn't get
          swallowed by an immediate close + navigate. onDelete is the
          parent's "happy path" — we only call it when the API succeeds. */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => {
          if (deleteBusy) return;
          setShowDeleteConfirm(false);
          setDeleteError(null);
        }}
      >
        <div className="p-6">
          <h3 className="text-text text-lg font-bold mb-2">Delete Agent</h3>
          <p className="text-text-dim text-sm mb-4">
            Delete <span className="text-text font-bold">{instance.name}</span>?
            All conversation history, telemetry, files, and chat messages
            for this agent will be removed. This cannot be undone.
          </p>
          {deleteError && (
            <p className="text-red text-sm mb-4 break-words">{deleteError}</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteError(null);
              }}
              disabled={deleteBusy}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setDeleteBusy(true);
                setDeleteError(null);
                try {
                  await onDelete();
                  // Parent navigates away on success; this component
                  // unmounts before reaching the finally block in the
                  // happy path. Closing the modal here is harmless if
                  // navigation does happen, defensive if it doesn't.
                  setShowDeleteConfirm(false);
                } catch (err) {
                  setDeleteError(
                    err instanceof Error ? err.message : "Failed to delete agent",
                  );
                } finally {
                  setDeleteBusy(false);
                }
              }}
              disabled={deleteBusy}
              className="px-4 py-2 bg-red text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {deleteBusy ? "deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Config modal */}
      <ConfigModal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        instance={instance}
        onSaved={onReload}
      />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Chat panel */}
        <div className="border-r border-border w-1/3 min-w-[320px]">
          {instance.status !== "running" ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Agent is stopped. Start it to begin chatting.
            </div>
          ) : !channelsAttached ? (
            <div className="relative h-full">
              <div className="pointer-events-none opacity-40 h-full">
                <ChatPanel instanceId={instance.id} subscribe={subscribe} onEvent={handleEvent} />
              </div>
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-xs text-center text-xs text-text-dim bg-bg-card/90 border border-border rounded-lg p-4">
                  Chat is disabled because the <code className="text-text-muted">channels</code> MCP
                  is not attached. Re-attach it from the MCP panel to restore
                  chat.
                </div>
              </div>
            </div>
          ) : (
            <ChatPanel instanceId={instance.id} subscribe={subscribe} onEvent={handleEvent} />
          )}
        </div>

        <AgentRuntimePanel
          instance={instance}
          threads={graphThreads}
          activeTools={graphActiveTools}
          thoughts={graphThoughts}
          events={runtimeEvents}
          view={view}
          onViewChange={setView}
          onThreadOpen={setSelectedThreadId}
          subscribe={subscribe}
          onPause={async () => { await instances.pause(instance.id); onReload(); }}
          onStop={async () => { await instances.stop(instance.id); onReload(); }}
          onStart={async () => { await instances.start(instance.id); onReload(); }}
          onConfig={() => setShowConfig(true)}
          onReset={() => setShowResetConfirm(true)}
          onDelete={() => setShowDeleteConfirm(true)}
          advancedContent={advancedContent}
        />
      </div>

      {/* Thread detail modal */}
      <ThreadDetailModal
        open={!!selectedThreadId}
        onClose={() => setSelectedThreadId(null)}
        thread={graphThreads.find((t) => t.id === selectedThreadId) || null}
        instanceId={instance.id}
        liveEvents={selectedThreadId ? (threadLiveEvents[selectedThreadId] || []) : []}
        onKilled={() => {
          if (selectedThreadId) {
            setGraphThreads((prev) => prev.filter((t) => t.id !== selectedThreadId));
          }
        }}
      />
    </div>
  );
}

function AgentRuntimePanel({
  instance,
  threads,
  activeTools,
  thoughts,
  events,
  view,
  onViewChange,
  onThreadOpen,
  subscribe,
  onPause,
  onStop,
  onStart,
  onConfig,
  onReset,
  onDelete,
  advancedContent,
}: {
  instance: Agent;
  threads: Thread[];
  activeTools: Record<string, string>;
  thoughts: Record<string, string>;
  events: RuntimeEventItem[];
  view: RuntimeView;
  onViewChange: (v: RuntimeView) => void;
  onThreadOpen: (id: string) => void;
  subscribe: SubscribeFn;
  onPause: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onConfig: () => void;
  onReset: () => void;
  onDelete: () => void;
  advancedContent: ReactNode;
}) {
  const [mcpServers, setMCPServers] = useState<MCPServerConfig[]>([]);
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [channelRows, setChannelRows] = useState<ChannelInfo[]>([]);
  const [executionControl, setExecutionControl] = useState<ExecutionControlStatus>({
    mode: "auto",
    scope: "instance",
    follow: "active",
    waiting: false,
  });
  const [executionBusy, setExecutionBusy] = useState<"run" | "pause" | "step" | "back" | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      core.config(instance.id)
        .then((c) => {
          if (!cancelled) {
            setMCPServers(c.mcp_servers || []);
            if (c.execution_control) setExecutionControl(c.execution_control);
          }
        })
        .catch(() => {});
      core.status(instance.id)
        .then((s) => {
          if (!cancelled && s.execution_control) setExecutionControl(s.execution_control);
        })
        .catch(() => {});
      appsAPI.list(instance.project_id)
        .then((rows) => {
          if (!cancelled) setInstalledApps(rows || []);
        })
        .catch(() => {});
      channels.list({ instanceId: instance.id })
        .then((rows) => {
          if (!cancelled) setChannelRows(rows || []);
        })
        .catch(() => {});
    };
    load();
    if (instance.status !== "running") return () => { cancelled = true; };
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [instance.id, instance.project_id, instance.status]);

  useEffect(() => {
    return subscribe((event) => {
      if (!event.type.startsWith("execution.")) return;
      const data = event.data || {};
      if (event.type === "execution.waiting") {
        setExecutionControl((prev) => ({
          ...prev,
          mode: prev.mode === "auto" ? "step" : prev.mode,
          waiting: true,
          phase: String(data.phase || ""),
          active_thread_id: event.thread_id || String(data.thread_id || "main"),
          iteration: typeof data.iteration === "number" ? data.iteration : prev.iteration,
          tool: typeof data.tool === "string" ? data.tool : undefined,
          call_id: typeof data.call_id === "string" ? data.call_id : undefined,
          summary: typeof data.summary === "string" ? data.summary : undefined,
          args: data.args && typeof data.args === "object" ? data.args as Record<string, string> : undefined,
        }));
      } else if (event.type === "execution.released" || event.type === "execution.cancelled") {
        setExecutionControl((prev) => ({ ...prev, waiting: false }));
      } else if (event.type === "execution.mode_changed") {
        setExecutionControl((prev) => ({
          ...prev,
          ...(data as Partial<ExecutionControlStatus>),
          mode: (data.mode === "paused" || data.mode === "step" || data.mode === "auto") ? data.mode : prev.mode,
        }));
      }
    });
  }, [subscribe]);

  const sendExecutionControl = async (action: "run" | "pause" | "step") => {
    setExecutionBusy(action);
    try {
      const res = await core.control(instance.id, action);
      setExecutionControl(res.execution_control);
    } finally {
      setExecutionBusy(null);
    }
  };

  const restorePreviousStep = async () => {
    const checkpointId = executionControl.restore_checkpoint_id;
    if (!checkpointId) return;
    setExecutionBusy("back");
    try {
      const res = await core.restoreCheckpoint(instance.id, checkpointId);
      setExecutionControl(res.execution_control);
    } finally {
      setExecutionBusy(null);
    }
  };

  const views: RuntimeView[] = [
    "stream",
    "activity",
    "fleet",
    "cards",
    "memory",
    "unconscious",
    "skills",
    "apps",
    "evals",
  ];

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-bg">
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${instance.status === "running" ? "bg-green" : instance.status === "paused" ? "bg-yellow" : "bg-red"}`} />
              <h1 className="text-text text-sm font-bold truncate">{instance.name}</h1>
              <span className="text-[10px] text-text-muted uppercase tracking-wide">{instance.status}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
              <span>{instance.mode}</span>
              <span>agent #{instance.id}</span>
              {instance.project_id && <span>project {instance.project_id}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {instance.status === "running" ? (
              <>
                <button onClick={onPause} className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-accent hover:border-accent">Pause</button>
                <button onClick={onStop} className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-red hover:border-red">Stop</button>
              </>
            ) : (
              <button onClick={onStart} className="px-2 py-1 border border-accent rounded text-[11px] text-accent hover:bg-accent hover:text-bg">Start</button>
            )}
            <button onClick={onConfig} className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-text">Config</button>
            <button onClick={onReset} className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-yellow">Reset</button>
            <button onClick={onDelete} className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-red">Delete</button>
          </div>
        </div>
        <LiveStatsBar instanceId={instance.id} subscribe={subscribe} />
        <ExecutionControlStrip
          status={executionControl}
          disabled={instance.status !== "running" || executionBusy !== null}
          busy={executionBusy}
          onRun={() => sendExecutionControl("run")}
          onPause={() => sendExecutionControl("pause")}
          onStep={() => sendExecutionControl("step")}
          onBack={restorePreviousStep}
          onThreadOpen={onThreadOpen}
        />
        <AppPanels
          slot="instance.status"
          instanceId={instance.id}
          projectId={instance.project_id || undefined}
          className="space-y-1.5"
        />
      </div>

      <div className="shrink-0 grid grid-cols-2 divide-x divide-border border-b border-border">
        <ThreadSummary
          threads={threads}
          activeTools={activeTools}
          thoughts={thoughts}
          onThreadOpen={onThreadOpen}
        />
        <CapabilityShelf
          mcpServers={mcpServers}
          apps={installedApps}
          channels={channelRows}
          onManage={() => onViewChange("activity")}
        />
      </div>

      <div className="border-b border-border px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-text-muted shrink-0">View</span>
        <div className="flex items-center gap-1 overflow-x-auto">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={`px-2 py-1 rounded text-[11px] capitalize whitespace-nowrap transition-colors ${
                view === v ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {view === "stream" ? <RuntimeStream events={events} /> : advancedContent}
      </div>
      {instance.status === "running" && (
        <InjectPanel instanceId={instance.id} threads={threads} />
      )}
    </section>
  );
}

function ExecutionControlStrip({
  status,
  disabled,
  busy,
  onRun,
  onPause,
  onStep,
  onBack,
  onThreadOpen,
}: {
  status: ExecutionControlStatus;
  disabled: boolean;
  busy: "run" | "pause" | "step" | "back" | null;
  onRun: () => void | Promise<void>;
  onPause: () => void | Promise<void>;
  onStep: () => void | Promise<void>;
  onBack: () => void | Promise<void>;
  onThreadOpen: (id: string) => void;
}) {
  const mode = status.mode || "auto";
  const view = executionControlView(status);
  const thread = status.active_thread_id || "main";
  const backLabel =
    status.restore_phase === "input.ready"
      ? "Back to input"
      : status.restore_phase === "llm.start"
        ? "Back to prompt"
        : "Back";
  const backTitle =
    status.restore_phase === "input.ready"
      ? "Go back before the current input event. The agent will wait for a new event."
      : status.restore_summary
        ? `Go back to: ${status.restore_summary}`
        : "Go back one step";
  const modeClass =
    mode === "auto"
      ? "text-green bg-green/10"
      : view.waiting
        ? "text-yellow bg-yellow/10"
        : "text-text-muted bg-bg-hover";

  return (
    <div className="flex items-center gap-2 rounded border border-border bg-bg-card/40 px-2 py-1.5">
      <span className={`w-6 h-6 rounded flex items-center justify-center text-[11px] shrink-0 ${modeClass}`}>
        {view.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-text-muted shrink-0">Step Mode</span>
          <button
            type="button"
            onClick={() => onThreadOpen(thread)}
            className="text-[11px] text-text hover:text-accent truncate"
            disabled={!thread}
          >
            {thread}
          </button>
          <span className="text-[11px] text-text truncate">{view.title}</span>
        </div>
        <div className="text-[11px] text-text-dim truncate">{view.detail}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {status.can_restore && status.restore_checkpoint_id && (
          <button
            onClick={onBack}
            disabled={disabled}
            className="h-7 px-2.5 min-w-[3.75rem] border border-border rounded text-[11px] text-text-muted hover:text-yellow hover:border-yellow disabled:opacity-40"
            title={backTitle}
          >
            {busy === "back" ? "…" : backLabel}
          </button>
        )}
        <button
          onClick={onRun}
          disabled={disabled}
          className="w-7 h-7 border border-border rounded text-[11px] text-text-muted hover:text-green hover:border-green disabled:opacity-40"
          title="Run continuously"
        >
          {busy === "run" ? "…" : "▶"}
        </button>
        <button
          onClick={onPause}
          disabled={disabled}
          className="w-7 h-7 border border-border rounded text-[11px] text-text-muted hover:text-yellow hover:border-yellow disabled:opacity-40"
          title="Pause at the next execution gate"
        >
          {busy === "pause" ? "…" : "Ⅱ"}
        </button>
        <button
          onClick={onStep}
          disabled={disabled}
          className={`h-7 border rounded text-[11px] disabled:opacity-40 ${
            view.nextClassName || "w-7 border-border text-text-muted hover:text-accent hover:border-accent"
          }`}
          title={view.nextTitle}
        >
          {busy === "step" ? "…" : view.nextLabel}
        </button>
      </div>
    </div>
  );
}

function executionControlView(status: ExecutionControlStatus): {
  icon: string;
  waiting: boolean;
  title: string;
  detail: string;
  nextTitle: string;
  nextLabel: string;
  nextClassName?: string;
} {
  const mode = status.mode || "auto";
  const waiting = !!status.waiting;
  const phase = status.phase || "";
  const tool = status.tool || "";
  const summary = status.summary || "";
  const call = status.call_id ? `call ${status.call_id}` : "";
  const subject = tool || call || "step";
  const argsText = formatExecutionArgs(status.args);
  const nextStepClass = "px-2.5 min-w-[5.5rem] text-accent border-accent bg-accent/10 hover:bg-accent hover:text-bg";
  const armedStepClass = "px-2.5 min-w-[5.5rem] border-border text-text-muted hover:text-accent hover:border-accent";

  if (mode === "auto") {
    return {
      icon: "▶",
      waiting: false,
      title: "Running continuously",
      detail: "Next button enables one-step execution.",
      nextTitle: "Switch to step mode and advance one gate",
      nextLabel: "Step",
      nextClassName: "px-2.5 min-w-[4rem] border-border text-text-muted hover:text-accent hover:border-accent",
    };
  }
  if (!waiting) {
    return {
      icon: "●",
      waiting: false,
      title: mode === "paused" ? "Will pause at next gate" : "Waiting for next gate",
      detail: "No step is currently waiting. The agent will stop when it reaches the next model or tool boundary.",
      nextTitle: "Queue one step when the next gate is reached",
      nextLabel: "Step once",
      nextClassName: armedStepClass,
    };
  }

  switch (phase) {
    case "llm.done":
      return {
        icon: "Ⅱ",
        waiting,
        title: "Next step: review model decision",
        detail: summary ? `Next will continue from: ${summary}` : "Next will save the model response and process any tool calls.",
        nextTitle: "Accept the model decision and continue",
        nextLabel: "Next step",
        nextClassName: nextStepClass,
      };
    case "tool.before":
      return {
        icon: "Ⅱ",
        waiting,
        title: `Next step: approve ${subject}`,
        detail: argsText
          ? `${summary && summary !== subject ? `${summary} · ` : ""}Args: ${argsText}`
          : summary && summary !== subject
            ? `Review before running: ${summary}`
            : "Review before running this tool.",
        nextTitle: `Approve and run ${subject}`,
        nextLabel: "Approve",
        nextClassName: nextStepClass,
      };
    case "tool.after":
      return {
        icon: "Ⅱ",
        waiting,
        title: `Next step: review ${subject} result`,
        detail: summary && summary !== subject ? `Next returns this result to the model: ${summary}` : "Next returns this result to the model.",
        nextTitle: "Return tool result to the model",
        nextLabel: "Next step",
        nextClassName: nextStepClass,
      };
    case "iteration.done":
      return {
        icon: "Ⅱ",
        waiting,
        title: "Next step: finish iteration",
        detail: summary || "Next will move to sleep or the next queued event.",
        nextTitle: "Finish this iteration",
        nextLabel: "Next step",
        nextClassName: nextStepClass,
      };
    case "input.ready":
      return {
        icon: "Ⅱ",
        waiting,
        title: "Next step: send input",
        detail: summary || "Next will prepare the model call.",
        nextTitle: "Continue to model call",
        nextLabel: "Next step",
        nextClassName: nextStepClass,
      };
    case "llm.start":
      return {
        icon: "Ⅱ",
        waiting,
        title: "Next step: call model",
        detail: summary || "Next will send the prompt to the model.",
        nextTitle: "Call the model",
        nextLabel: "Next step",
        nextClassName: nextStepClass,
      };
    default:
      return {
        icon: "Ⅱ",
        waiting,
        title: phase ? `Next step: ${phase}` : "Next step required",
        detail: summary || "Next advances one controlled step.",
        nextTitle: "Advance one execution gate",
        nextLabel: "Next step",
        nextClassName: nextStepClass,
      };
  }
}

function formatExecutionArgs(args?: Record<string, string>): string {
  if (!args) return "";
  const parts = Object.entries(args)
    .filter(([k]) => k !== "_reason")
    .slice(0, 4)
    .map(([k, v]) => `${k}=${truncateUI(String(v), 80)}`);
  const extra = Object.keys(args).filter((k) => k !== "_reason").length - parts.length;
  if (extra > 0) parts.push(`+${extra} more`);
  return parts.join(", ");
}

function truncateUI(value: string, max: number): string {
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function ThreadSummary({
  threads,
  activeTools,
  thoughts,
  onThreadOpen,
}: {
  threads: Thread[];
  activeTools: Record<string, string>;
  thoughts: Record<string, string>;
  onThreadOpen: (id: string) => void;
}) {
  const rows = threads.length > 0 ? threads : [{ id: "main", directive: "", tools: [], iteration: 0, rate: "", model: "", age: "" }];
  const sorted = [...rows].sort((a, b) => (a.depth || 0) - (b.depth || 0) || a.id.localeCompare(b.id)).slice(0, 8);

  return (
    <div className="p-3 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] uppercase tracking-wide text-text-muted font-bold">Current work</h2>
        <span className="text-[10px] text-text-dim">{rows.length} threads</span>
      </div>
      <div className="space-y-1">
        {sorted.map((t) => {
          const tool = activeTools[t.id];
          const thought = thoughts[t.id];
          const depth = Math.min(t.depth || 0, 3);
          const state = tool ? `tool: ${tool}` : thought ? "thinking" : t.rate || "waiting";
          return (
            <button
              key={t.id}
              onClick={() => onThreadOpen(t.id)}
              className="w-full min-w-0 flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-hover transition-colors"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tool ? "bg-accent animate-pulse" : thought ? "bg-yellow" : "bg-text-dim"}`} />
              <span className="text-xs text-text truncate">{t.name || t.id}</span>
              <span className="text-[10px] text-text-muted truncate flex-1">{state}</span>
              {t.age && <span className="text-[10px] text-text-dim tabular-nums shrink-0">{t.age}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CapabilityShelf({
  mcpServers,
  apps,
  channels: channelRows,
  onManage,
}: {
  mcpServers: MCPServerConfig[];
  apps: AppRow[];
  channels: ChannelInfo[];
  onManage: () => void;
}) {
  const names = new Set(mcpServers.map((s) => s.name));
  const system = [
    { name: "channels", label: "Channels", tools: "chat / email / Slack" },
    { name: "apteva-server", label: "Apteva Server", tools: "agent control" },
  ];
  const appCaps = apps
    .filter((a) => a.status === "running" && ((a.surfaces?.mcp_tool_count || 0) > 0 || (a.surfaces?.ui_panel_count || 0) > 0))
    .slice(0, 5);
  const custom = mcpServers
    .filter((m) => !["channels", "apteva-channels", "apteva-server"].includes(m.name))
    .slice(0, 4);

  return (
    <div className="p-3 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] uppercase tracking-wide text-text-muted font-bold">Capabilities</h2>
        <button onClick={onManage} className="text-[10px] text-accent hover:text-accent-hover">
          Manage
        </button>
      </div>
      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
        <CapabilityGroup title="System">
          {system.map((s) => {
            const attached = names.has(s.name) || (s.name === "channels" && names.has("apteva-channels"));
            return (
              <CapabilityRow
                key={s.name}
                icon={attached ? "✓" : "○"}
                name={s.label}
                detail={s.tools}
                status={attached ? "attached" : "missing"}
                tone={attached ? "ok" : "warn"}
              />
            );
          })}
        </CapabilityGroup>
        {channelRows.length > 0 && (
          <CapabilityGroup title="Channels">
            {channelRows.slice(0, 4).map((c) => (
              <CapabilityRow key={c.id} icon="↗" name={c.name || c.type} detail={c.type} status={c.status} tone="ok" />
            ))}
          </CapabilityGroup>
        )}
        {appCaps.length > 0 && (
          <CapabilityGroup title="Apps">
            {appCaps.map((a) => (
              <CapabilityRow
                key={a.install_id}
                icon="◇"
                imageUrl={a.icon}
                name={a.display_name || a.name}
                detail={`${a.surfaces?.mcp_tool_count || 0} tools${a.surfaces?.ui_panel_count ? " · UI" : ""}`}
                status={a.status}
                tone="ok"
              />
            ))}
          </CapabilityGroup>
        )}
        {custom.length > 0 && (
          <CapabilityGroup title="MCPs">
            {custom.map((m) => (
              <CapabilityRow
                key={m.name}
                icon={m.connected === false ? "○" : "✓"}
                name={m.name}
                detail={m.transport || (m.url ? "http" : "stdio")}
                status={m.connected === false ? "offline" : "attached"}
                tone={m.connected === false ? "warn" : "ok"}
              />
            ))}
          </CapabilityGroup>
        )}
      </div>
    </div>
  );
}

function CapabilityGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-text-dim mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CapabilityRow({
  icon,
  imageUrl,
  name,
  detail,
  status,
  tone,
}: {
  icon: string;
  imageUrl?: string;
  name: string;
  detail: string;
  status: string;
  tone: "ok" | "warn";
}) {
  const [brokenImage, setBrokenImage] = useState(false);
  useEffect(() => {
    setBrokenImage(false);
  }, [imageUrl]);

  const canShowImage = !!imageUrl && !brokenImage;
  return (
    <div className="flex items-center gap-2 min-w-0 rounded px-2 py-1.5 bg-bg-card/40">
      <span className={`w-5 h-5 rounded flex items-center justify-center text-[11px] shrink-0 ${tone === "ok" ? "text-green bg-green/10" : "text-yellow bg-yellow/10"}`}>
        {canShowImage ? (
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full rounded object-cover"
            onError={() => setBrokenImage(true)}
          />
        ) : (
          icon
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text truncate">{name}</div>
        <div className="text-[10px] text-text-dim truncate">{detail}</div>
      </div>
      <span className="text-[10px] text-text-muted shrink-0">{status}</span>
    </div>
  );
}

function RuntimeStream({ events }: { events: RuntimeEventItem[] }) {
  const [filter, setFilter] = useState<"all" | RuntimeEventItem["kind"]>("all");
  const [query, setQuery] = useState("");
  const visible = events
    .filter((e) => filter === "all" || e.kind === filter)
    .filter((e) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${e.kind} ${e.label} ${e.detail || ""} ${e.threadId || ""}`.toLowerCase().includes(q);
    })
    .slice()
    .reverse();

  const filters: Array<"all" | RuntimeEventItem["kind"]> = ["all", "thought", "tool", "thread", "channel", "error"];

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[11px] capitalize whitespace-nowrap ${
                filter === f ? "bg-bg-hover text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stream"
          className="ml-auto w-44 bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-accent"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-dim text-sm">
            Runtime events will appear here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {visible.map((e) => (
              <RuntimeRow key={e.key} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function runtimeVisual(event: RuntimeEventItem): {
  icon: string;
  iconClass: string;
  labelClass: string;
  hoverBorder: string;
} {
  if (event.status === "error") {
    return {
      icon: "!",
      iconClass: "text-red bg-red/10",
      labelClass: "text-red",
      hoverBorder: "hover:border-red/40",
    };
  }

  if (event.kind === "tool") {
    if (event.status === "running") {
      return {
        icon: "⟳",
        iconClass: "text-yellow bg-yellow/10 animate-spin",
        labelClass: "text-yellow",
        hoverBorder: "hover:border-yellow/40",
      };
    }
    return {
      icon: event.status === "success" ? "✓" : "◇",
      iconClass: event.status === "success" ? "text-green bg-green/10" : "text-yellow bg-yellow/10",
      labelClass: "text-yellow",
      hoverBorder: "hover:border-yellow/40",
    };
  }

  if (event.kind === "thought") {
    return {
      icon: event.status === "running" ? "◐" : "◆",
      iconClass: event.status === "running" ? "text-accent bg-accent/10 animate-pulse" : "text-accent bg-accent/10",
      labelClass: "text-accent",
      hoverBorder: "hover:border-accent/40",
    };
  }

  if (event.kind === "thread") {
    return {
      icon: event.status === "success" ? "✓" : "↳",
      iconClass: "text-blue bg-blue/10",
      labelClass: "text-blue",
      hoverBorder: "hover:border-blue/40",
    };
  }

  if (event.kind === "channel") {
    return {
      icon: "→",
      iconClass: "text-green bg-green/10",
      labelClass: "text-green",
      hoverBorder: "hover:border-green/40",
    };
  }

  return {
    icon: "•",
    iconClass: "text-text-muted bg-bg-hover",
    labelClass: "text-text-muted",
    hoverBorder: "hover:border-border",
  };
}

function RuntimeRow({ event }: { event: RuntimeEventItem }) {
  const visual = runtimeVisual(event);

  return (
    <details className={`group rounded border border-transparent hover:bg-bg-card/40 ${visual.hoverBorder}`}>
      <summary className="list-none cursor-pointer px-2 py-2 flex items-start gap-2 min-w-0">
        <span className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[11px] shrink-0 ${visual.iconClass}`}>
          {visual.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[10px] uppercase tracking-wide shrink-0 ${visual.labelClass}`}>{event.kind}</span>
            <span className="text-xs text-text truncate">{event.label}</span>
          </div>
          {event.detail && (
            <div className="text-[11px] text-text-dim truncate mt-0.5">{event.detail}</div>
          )}
        </div>
        {event.durationMs != null && (
          <span className="text-[10px] text-text-dim tabular-nums shrink-0">{durationLabel(event.durationMs)}</span>
        )}
        <span className="text-[10px] text-text-dim tabular-nums shrink-0">
          {new Date(event.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </summary>
      <div className="px-8 pb-2">
        <pre className="text-[10px] text-text-muted bg-bg-input border border-border rounded p-2 overflow-auto max-h-56">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      </div>
    </details>
  );
}

// --- Config Modal ---

function ConfigModal({ open, onClose, instance, onSaved }: {
  open: boolean;
  onClose: () => void;
  instance: Agent;
  onSaved: () => void;
}) {
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [providerDetails, setProviderDetails] = useState<Record<number, ProviderDetail>>({});
  const [availableModels, setAvailableModels] = useState<Record<number, ModelInfo[]>>({});
  const [loadingModels, setLoadingModels] = useState<number | null>(null);
  const [defaultProvider, setDefaultProvider] = useState("");
  const [modelLarge, setModelLarge] = useState("");
  const [modelMedium, setModelMedium] = useState("");
  const [modelSmall, setModelSmall] = useState("");
  const [directive, setDirective] = useState("");
  const [mode, setMode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // provKey collapses a Provider's display name to the kebab-case
  // identifier the backend uses everywhere (createProviderByName,
  // FetchModels, isLLMKey, config.json's providers[i].name). Without
  // the space-to-hyphen substitution, "OpenCode Go" lowercased to
  // "opencode go" — which matches NO case in the core dispatch, so
  // selecting it as default silently dropped the provider from the pool
  // and the agent fell back to whatever was first in config order.
  const provKey = (p: Provider) => {
    const raw = p.type === "llm" ? p.name : p.type;
    return raw.toLowerCase().trim().replace(/\s+/g, "-");
  };

  useEffect(() => {
    if (!open) return;
    setDirective(instance.directive || "");
    setMode(instance.mode || "autonomous");
    setError("");

    try {
      const cfg = JSON.parse(instance.config || "{}");
      setDefaultProvider(cfg.default_provider || "");
    } catch { setDefaultProvider(""); }

    providersAPI.list(instance.project_id).then((list) => {
      const llm = (list || []).filter((p) => p.type === "llm");
      setProviderList(llm);
      for (const p of llm) {
        providersAPI.get(p.id).then((d) => {
          setProviderDetails((prev) => ({ ...prev, [p.id]: d }));
        }).catch(() => {});
      }
      // Pre-select the first available LLM provider when the instance has
      // no stored default_provider yet. Without this the small/medium/large
      // rows render empty on a fresh instance even though the project has
      // providers configured — user then has to click twice (provider
      // dropdown, then save) before anything meaningful shows.
      setDefaultProvider((cur) => {
        if (cur) return cur;
        const first = llm[0];
        return first ? provKey(first) : "";
      });
    }).catch(() => {});
  }, [open, instance.id]);

  // When provider selection changes, load its current model settings
  const selectedDetail = providerList.find((p) => provKey(p) === defaultProvider);
  const selectedData = selectedDetail ? providerDetails[selectedDetail.id] : null;

  useEffect(() => {
    if (selectedData) {
      setModelLarge(selectedData.data.model_large || "");
      setModelMedium(selectedData.data.model_medium || "");
      setModelSmall(selectedData.data.model_small || "");
    } else {
      setModelLarge(""); setModelMedium(""); setModelSmall("");
    }
  }, [selectedData?.data?.model_large, selectedData?.data?.model_medium, selectedData?.data?.model_small]);

  // Auto-fetch models when a provider is selected
  useEffect(() => {
    if (!selectedDetail || availableModels[selectedDetail.id]) return;
    setLoadingModels(selectedDetail.id);
    providersAPI.models(selectedDetail.id).then((m) => {
      setAvailableModels((prev) => ({ ...prev, [selectedDetail.id]: m }));
    }).catch(() => {}).finally(() => setLoadingModels(null));
  }, [selectedDetail?.id]);

  const handleRefreshModels = async () => {
    if (!selectedDetail) return;
    setLoadingModels(selectedDetail.id);
    try {
      const m = await providersAPI.models(selectedDetail.id);
      setAvailableModels((prev) => ({ ...prev, [selectedDetail.id]: m }));
    } catch (err: any) {
      setError("Failed to fetch models: " + (err.message || ""));
    } finally { setLoadingModels(null); }
  };

  const models = selectedDetail ? availableModels[selectedDetail.id] : undefined;

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      // Update model sizes on the provider if changed
      if (selectedDetail && selectedData) {
        const d = { ...selectedData.data };
        let changed = false;
        if (modelLarge !== (d.model_large || "")) { d.model_large = modelLarge; changed = true; }
        if (modelMedium !== (d.model_medium || "")) { d.model_medium = modelMedium; changed = true; }
        if (modelSmall !== (d.model_small || "")) { d.model_small = modelSmall; changed = true; }
        if (changed) {
          await providersAPI.update(selectedDetail.id, selectedDetail.type, selectedDetail.name, d);
        }
      }

      const provs = defaultProvider
        ? providerList.map((p) => ({ name: provKey(p), default: provKey(p) === defaultProvider }))
        : undefined;
      await instances.updateConfig(instance.id, {
        directive: directive || undefined,
        mode: mode || undefined,
        providers: provs,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally { setSaving(false); }
  };

  // Some providers (Fireworks, OpenRouter) return the same model id under
  // multiple "tier" variants — first-occurrence wins so the dropdown
  // stays stable + react keys are unique.
  const uniqueModels = useMemo(() => {
    if (!models) return undefined;
    const seen = new Set<string>();
    const out: typeof models = [];
    for (const m of models) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [models]);

  const modelSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex items-center gap-2">
      <span className="text-text-muted text-xs w-16 shrink-0">{label}</span>
      {uniqueModels ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-text font-mono focus:outline-none focus:border-accent"
        >
          <option value="">— not set —</option>
          {uniqueModels.map((m) => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
      ) : (
        <span className="text-text-dim text-xs font-mono flex-1">{value || "—"}</span>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
        <h3 className="text-text text-base font-bold">Agent Config</h3>

        {/* Default provider */}
        <div>
          <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Provider</label>
          <select
            value={defaultProvider}
            onChange={(e) => setDefaultProvider(e.target.value)}
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value="">Auto (first available)</option>
            {providerList.map((p) => (
              <option key={p.id} value={provKey(p)}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Models */}
        {selectedDetail && (
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-[10px] font-bold uppercase tracking-wide">Models</span>
              <button
                onClick={handleRefreshModels}
                disabled={loadingModels === selectedDetail.id}
                className="text-[10px] text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
              >
                {loadingModels === selectedDetail.id ? "Loading..." : "Refresh"}
              </button>
            </div>
            <div className="space-y-1.5">
              {modelSelect("Large", modelLarge, setModelLarge)}
              {modelSelect("Medium", modelMedium, setModelMedium)}
              {modelSelect("Small", modelSmall, setModelSmall)}
            </div>
          </div>
        )}

        {/* Mode */}
        <div>
          <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Mode</label>
          <div className="flex gap-2">
            {["autonomous", "cautious", "learn"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex-1 capitalize ${
                  mode === m ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Directive */}
        <div>
          <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Directive</label>
          <textarea
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            rows={4}
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent resize-none font-mono"
            placeholder="What should this agent do?"
          />
        </div>

        {error && <p className="text-red text-xs">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose}
            className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
