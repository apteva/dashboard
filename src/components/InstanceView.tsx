import { useState, useEffect, useRef, useCallback } from "react";
import { instances, core, type Instance, type Thread, type TelemetryEvent } from "../api";

export type EventListener = (event: TelemetryEvent) => void;
export type SubscribeFn = (listener: EventListener) => () => void;
import { ChatPanel } from "./ChatPanel";
import { ActivityPanel } from "./ActivityPanel";
import { FleetGraph, type FleetEvent } from "./FleetGraph";
import { FleetCards } from "./FleetCards";
import { ThreadDetailModal } from "./ThreadDetailModal";
import { Modal } from "./Modal";
import { LiveStatsBar } from "./LiveStatsBar";

// InstanceView is the rich per-instance view: chat panel + activity/fleet/cards
// side panel, lifecycle controls (start/stop/pause/delete), thread detail
// modal. Used by the /instances/:id route to render whichever instance the
// user navigated to.
//
// onDelete is called after a successful delete so the parent can navigate
// back to the instances list. onReload is called after lifecycle actions
// (start/stop) so the parent can refresh its instance metadata.
export function InstanceView({
  instance,
  onDelete,
  onReload,
  initialThreads = [],
}: {
  instance: Instance;
  onDelete: () => void;
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
  const subscribe: SubscribeFn = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [view, setView] = useState<"activity" | "fleet" | "cards">("activity");

  // Track threads, tools, thoughts, events for the fleet graph
  const [graphThreads, setGraphThreads] = useState<Thread[]>(initialThreads);
  const [graphActiveTools, setGraphActiveTools] = useState<Record<string, string>>({});
  const [graphThoughts, setGraphThoughts] = useState<Record<string, string>>({});
  const [graphEvents, setGraphEvents] = useState<FleetEvent[]>([]);

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
    setThreadLiveEvents({});
    seenHandledEventsRef.current = new Set();
    seenHandledOrderRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

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
    }
    // Fan out to every subscribed panel synchronously — no React batching.
    listenersRef.current.forEach((cb) => cb(event));
    const data = event.data || {};

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

    // Track active tools — keep visible for 3s after completion
    // Skip noisy inline tools (send, pace, done, evolve, remember) and channels from display
    const hiddenTools = new Set(["send", "pace", "done", "evolve", "remember", "channels_respond", "channels_status", "channels_ask"]);
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${instance.status === "running" ? "bg-green" : "bg-red"}`} />
          <h1 className="text-text text-sm font-bold">{instance.name}</h1>
          {/* View toggle */}
          <div className="flex border border-border rounded-lg overflow-hidden ml-4">
            {(["activity", "fleet", "cards"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs transition-colors capitalize ${view === v ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {instance.status === "running" && (
            <>
              <button
                onClick={async () => { await instances.pause(instance.id); }}
                className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                Pause
              </button>
              <button
                onClick={async () => { await instances.stop(instance.id); onReload(); }}
                className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors"
              >
                Stop
              </button>
            </>
          )}
          {instance.status === "stopped" && (
            <button
              onClick={async () => { await instances.start(instance.id); onReload(); }}
              className="px-2.5 py-1 border border-accent rounded-lg text-xs text-accent hover:bg-accent hover:text-bg transition-colors"
            >
              Start
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Live stats strip — iterations, tokens, cost, projected $/day.
          Aggregates llm.done telemetry via the shared event bus so every
          iteration across main + sub-threads contributes. Mirrors the
          CLI/TUI token strip. */}
      <LiveStatsBar instanceId={instance.id} subscribe={subscribe} />

      {/* Delete confirmation */}
      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)}>
        <div className="p-6">
          <h3 className="text-text text-lg font-bold mb-2">Delete Agent</h3>
          <p className="text-text-dim text-sm mb-6">
            Delete <span className="text-text font-bold">{instance.name}</span>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
              className="px-4 py-2 bg-red text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity">
              Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Chat panel — hidden in fleet view but stays mounted for SSE */}
        <div className={`border-r border-border ${view === "fleet" ? "w-0 min-w-0 overflow-hidden" : "w-1/3 min-w-[300px]"}`}>
          {instance.status === "running" ? (
            <ChatPanel instanceId={instance.id} onEvent={handleEvent} />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Instance is stopped. Start it to begin chatting.
            </div>
          )}
        </div>

        {/* Right panel — Activity, Fleet graph, or Cards */}
        <div className="flex-1">
          {view === "activity" ? (
            <ActivityPanel instance={instance} subscribe={subscribe} onReload={onReload} />
          ) : view === "fleet" ? (
            <FleetGraph threads={graphThreads} activeTools={graphActiveTools} thoughts={graphThoughts} events={graphEvents} onNodeClick={setSelectedThreadId} />
          ) : (
            <FleetCards threads={graphThreads} subscribe={subscribe} activeTools={graphActiveTools} thoughts={graphThoughts} />
          )}
        </div>
      </div>

      {/* Thread detail modal */}
      <ThreadDetailModal
        open={!!selectedThreadId}
        onClose={() => setSelectedThreadId(null)}
        thread={graphThreads.find((t) => t.id === selectedThreadId) || null}
        instanceId={instance.id}
        liveEvents={selectedThreadId ? (threadLiveEvents[selectedThreadId] || []) : []}
      />
    </div>
  );
}
