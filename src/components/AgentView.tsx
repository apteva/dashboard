import { ServiceTierSelect, agentServiceTiers, serviceTierPatch } from "./ServiceTierSelect";
import { AppIcon } from "@apteva/ui-kit";
import { AgentIconPicker, AgentMark, suggestedAgentIcon } from "./AgentMark";
import { PickerOption } from "./PickerOption";
import { ProactivityControl } from "./ProactivityControl";
import { defaultProactivity } from "../agentBehavior";
import { behaviorDescriptions, behaviorExplanation } from "../agentBehavior";
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import {
  apps as appsAPI,
  core,
  instances,
  mcpServers as mcpServersAPI,
  integrations,
  telemetry,
  type Agent,
  type AppRow,
  type ConnectionInfo,
  type ExecutionControlStatus,
  type MCPServer,
  type MCPServerConfig,
  type ModelInfo,
  type PromptComposition,
  type RuntimeConnection,
  type Status,
  type TelemetryEvent,
  type Thread,
} from "../api";
import { useTelemetryConnectionState, useTelemetryEvents } from "../hooks/useTelemetryBus";
import { sleepClassName, sleepLabel, sleepProgress, sleepTitle } from "../utils/sleepStatus";
import { threadTokenUsage } from "../utils/threadTokenUsage";
import { useAssistantPageDetails } from "./chat/pageContext";
import { useProjects } from "../hooks/useProjects";
import { resolveEffectiveAgentProvider } from "../utils/providerSelection";
import { splitToolTelemetryPaintFrame } from "../utils/toolTelemetryPaint";

export type EventListener = (event: TelemetryEvent) => void;
export type SubscribeFn = (listener: EventListener) => () => void;
import { MemoryPanel } from "./MemoryPanel";
import { UnconsciousPanel } from "./UnconsciousPanel";
import { InjectPanel } from "./InjectPanel";
import { ThreadDetailModal, formatContextResetResult } from "./ThreadDetailModal";
import { AppPanels } from "./AppPanels";
import { Modal } from "./Modal";
import { SkillsPanel } from "./SkillsPanel";
import { structureDirectiveDraft } from "../utils/directiveMarkdown";
import { useAudience, audienceShows, type AudienceSection } from "../hooks/useAudience";
import { AgentOverview } from "./AgentOverview";
import { AgentActivity } from "./AgentActivity";
import { AgentDiagnostics } from "./AgentDiagnostics";
import { AgentSummaryBar, useAgentUsage } from "./AgentSummaryBar";
import { AgentCapabilityIcons } from "./AgentCapabilityIcons";
import { buildToolVisualRegistry } from "./chat/toolVisuals";
import type { Audience } from "../hooks/useAudience";

type RuntimeView = "overview" | "stream" | "activity" | "memory" | "skills" | "apps" | "capabilities";

export { mergeRuntimeEvent } from "../utils/runtimeActivity";
export type { RuntimeEventItem } from "../utils/runtimeActivity";
import { mergeRuntimeEvent, telemetryTimeMs, HISTORICAL_RUNTIME_EVENT_LIMIT, type RuntimeEventItem } from "../utils/runtimeActivity";

function restoreCheckpointMs(ev: TelemetryEvent): number {
  if (ev.type !== "execution.restored") return 0;
  const ms = Date.parse(String(ev.data?.checkpoint_time || ""));
  return Number.isFinite(ms) ? ms : 0;
}

// AgentView is the rich per-instance runtime view with lifecycle controls
// (start/stop/pause/delete) and a thread detail
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
  initialThreadId,
}: {
  instance: Agent;
  onDelete: () => void | Promise<void>;
  onReload: () => void;
  initialThreads?: Thread[];
  initialThreadId?: string;
}) {
  // Event bus for fan-out to sibling panels.
  //
  // We used to pass the latest SSE event as a React state prop (`latestEvent`)
  // to runtime panels. That was broken for streaming text: when
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
  const pendingRuntimeEventsRef = useRef<TelemetryEvent[]>([]);
  const runtimeFrameRef = useRef<number | null>(null);
  const lastStoredTelemetryMsRef = useRef(0);
  const liveActivitySinceRef = useRef(Date.now());
  const handleEventRef = useRef<(event: TelemetryEvent) => void>(() => {});
  const subscribe: SubscribeFn = useCallback((cb) => {
    listenersRef.current.add(cb);
    return () => { listenersRef.current.delete(cb); };
  }, []);
  const rememberHandledEventID = useCallback((id: string) => {
    if (seenHandledEventsRef.current.has(id)) return false;
    seenHandledEventsRef.current.add(id);
    seenHandledOrderRef.current.push(id);
    if (seenHandledOrderRef.current.length > 500) {
      const old = seenHandledOrderRef.current.shift();
      if (old) seenHandledEventsRef.current.delete(old);
    }
    return true;
  }, []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [view, setView] = useState<RuntimeView>("overview");

  // Track threads, tools, and active LLM calls for the runtime summary.
  const [graphThreads, setGraphThreads] = useState<Thread[]>(initialThreads);
  const [graphActiveTools, setGraphActiveTools] = useState<Record<string, string>>({});
  const [graphThinking, setGraphThinking] = useState<Record<string, boolean>>({});
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEventItem[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(true);

  // Thread detail modal
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadLiveEvents, setThreadLiveEvents] = useState<Record<string, TelemetryEvent[]>>({});

  useEffect(() => {
    if (initialThreadId) setSelectedThreadId(initialThreadId);
  }, [initialThreadId, instance.id]);

  // Reset all live state when the instance changes — critical because
  // react-router keeps the component mounted when navigating between
  // /instances/:id → /instances/:other, and stale threads from the previous
  // instance would otherwise leak into the runtime summary.
  useEffect(() => {
    setView("overview");
    setGraphThreads(initialThreads);
    setGraphActiveTools({});
    setGraphThinking({});
    setRuntimeEvents([]);
    setRuntimeLoading(true);
    setThreadLiveEvents({});
    setResetFeedback(null);
    setShowResetConfirm(false);
    seenHandledEventsRef.current = new Set();
    seenHandledOrderRef.current = [];
    seenLiveRef.current = new Set();
    seenLiveOrderRef.current = [];
    pendingRuntimeEventsRef.current = [];
    lastStoredTelemetryMsRef.current = 0;
    liveActivitySinceRef.current = Date.now();
    if (runtimeFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeFrameRef.current);
      runtimeFrameRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  useEffect(() => {
    let cancelled = false;
    setRuntimeLoading(true);
    telemetry.query(instance.id, undefined, HISTORICAL_RUNTIME_EVENT_LIMIT)
      .then((events) => {
        if (cancelled) return;
        const historical = [...events].reverse();
        if (historical.length === 0) return;
        for (const event of historical) {
          const ms = telemetryTimeMs(event);
          if (ms > lastStoredTelemetryMsRef.current) lastStoredTelemetryMsRef.current = ms;
        }
        setRuntimeEvents((prev) => historical.reduce(mergeRuntimeEvent, prev));
        setThreadLiveEvents((prev) => {
          const next: Record<string, TelemetryEvent[]> = { ...prev };
          for (const event of historical) {
            const threadId = event.thread_id || "main";
            const arr = next[threadId] || [];
            next[threadId] = [...arr, event].slice(-200);
          }
          return next;
        });
        for (const event of historical) {
          if (event.id) rememberHandledEventID(event.id);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRuntimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instance.id, rememberHandledEventID]);

  const applyRuntimeEvents = useCallback((events: TelemetryEvent[]) => {
    if (events.length === 0) return;
    setRuntimeEvents((prev) => events.reduce(mergeRuntimeEvent, prev));
    setThreadLiveEvents((prev) => {
      const next: Record<string, TelemetryEvent[]> = { ...prev };
      for (const event of events) {
        if (!event.thread_id) continue;
        const arr = next[event.thread_id] || [];
        next[event.thread_id] = [...arr, event].slice(-200);
      }
      return next;
    });
  }, []);

  const flushRuntimeEventFrame = useCallback(function flushRuntimeEventFrame() {
    runtimeFrameRef.current = null;
    const { paint, deferred } = splitToolTelemetryPaintFrame(pendingRuntimeEventsRef.current);
    pendingRuntimeEventsRef.current = deferred;
    applyRuntimeEvents(paint);
    if (pendingRuntimeEventsRef.current.length > 0) {
      runtimeFrameRef.current = window.requestAnimationFrame(flushRuntimeEventFrame);
    }
  }, [applyRuntimeEvents]);

  // Restore/reset paths need an immediate, complete drain. Live delivery uses
  // flushRuntimeEventFrame instead so a fast chunk → call → result burst gets
  // a browser paint at each lifecycle boundary.
  const flushRuntimeEvents = useCallback(() => {
    if (runtimeFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeFrameRef.current);
      runtimeFrameRef.current = null;
    }
    const pending = pendingRuntimeEventsRef.current;
    pendingRuntimeEventsRef.current = [];
    applyRuntimeEvents(pending);
  }, [applyRuntimeEvents]);

  const queueRuntimeEvent = useCallback((event: TelemetryEvent) => {
    pendingRuntimeEventsRef.current.push(event);
    if (runtimeFrameRef.current !== null) return;
    runtimeFrameRef.current = window.requestAnimationFrame(flushRuntimeEventFrame);
  }, [flushRuntimeEventFrame]);

  useEffect(() => () => {
    if (runtimeFrameRef.current !== null) {
      window.cancelAnimationFrame(runtimeFrameRef.current);
      runtimeFrameRef.current = null;
    }
    pendingRuntimeEventsRef.current = [];
  }, []);

  // Top-level dedup. The shared telemetry stream is the source of truth
  // for this view; if the same event.id arrives twice (StrictMode
  // double-mount, browser EventSource reconnect, etc.) we drop the
  // duplicate here so neither the fan-out subscribers nor the local
  // state mutations below ever see it twice. This is the belt; the
  // panels keep their own dedup as suspenders, since they each have
  // rendering paths that historically produced visible duplicates.
  const handleEvent = (event: TelemetryEvent) => {
    if (event.id) {
      if (!rememberHandledEventID(event.id)) return;
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
    // Initial catch-up and SSE reconnects can replay old work. Keep it in
    // the activity feed without treating it as the agent's current state.
    const eventMs = telemetryTimeMs(event);
    if (eventMs > 0 && eventMs < liveActivitySinceRef.current) {
      queueRuntimeEvent(event);
      lastStoredTelemetryMsRef.current = Math.max(lastStoredTelemetryMsRef.current, eventMs);
      return;
    }
    const restoreMs = restoreCheckpointMs(event);
    if (restoreMs > 0) {
      flushRuntimeEvents();
      setRuntimeEvents((prev) => prev.filter((e) => telemetryTimeMs(e.raw) < restoreMs));
      setThreadLiveEvents((prev) => {
        const next: Record<string, TelemetryEvent[]> = {};
        for (const [threadId, events] of Object.entries(prev)) {
          const kept = events.filter((e) => telemetryTimeMs(e) < restoreMs);
          if (kept.length > 0) next[threadId] = kept;
        }
        return next;
      });
      setGraphActiveTools({});
      setGraphThinking({});
    }
    // Fan out to every subscribed panel synchronously — no React batching.
    listenersRef.current.forEach((cb) => cb(event));
    const data = event.data || {};
    queueRuntimeEvent(event);
    if (!["llm.start", "llm.chunk", "llm.thinking", "llm.tool_chunk"].includes(event.type)) {
      const ms = telemetryTimeMs(event);
      if (ms > lastStoredTelemetryMsRef.current) lastStoredTelemetryMsRef.current = ms;
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
        return [...prev, {
          id: event.thread_id,
          parent_id: parentId,
          depth,
          directive: data.directive || "",
          tools: data.tools || [],
          mcp_names: data.mcp || [],
          realtime: !!data.realtime,
          voice: data.voice || undefined,
          provider: data.provider || undefined,
          iteration: 0,
          rate: "reactive",
          model: "",
          age: "0s",
        }];
      });
    }
    if (event.type === "thread.done") {
      setGraphThreads((prev) => prev.filter((t) => t.id !== event.thread_id));
      setGraphActiveTools((prev) => { const n = { ...prev }; delete n[event.thread_id]; return n; });
      setGraphThinking((prev) => { const n = { ...prev }; delete n[event.thread_id]; return n; });
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
        setGraphThinking((prev) => {
          if (!(oldID in prev)) return prev;
          const n = { ...prev };
          n[newID] = n[oldID];
          delete n[oldID];
          return n;
        });
      }
    }

    const threadId = event.thread_id || "main";
    if (event.type === "llm.start") {
      setGraphThinking((prev) => ({ ...prev, [threadId]: true }));
    }
    if (event.type === "llm.done" || event.type === "llm.error") {
      setGraphThinking((prev) => {
        if (!prev[threadId]) return prev;
        const n = { ...prev };
        delete n[threadId];
        return n;
      });
    }

    // Track only unfinished tools. Completed work remains in the activity
    // feed, but must not keep the agent header in the Working state.
    // Skip noisy inline tools (send, pace, done, evolve, remember) and channels from display
    const hiddenTools = new Set(["send", "pace", "done", "evolve", "remember", "channels_respond", "channels_send", "channels_status", "channels_publish", "channels_set_status"]);
    const toolName = String(data.name || "");
    const showTool = event.thread_id && toolName && !hiddenTools.has(toolName) && !toolName.startsWith("channels_");

    if (event.type === "tool.call" && showTool) {
      setGraphActiveTools((prev) => ({ ...prev, [event.thread_id]: toolName }));
    }
    if (event.type === "tool.result" && showTool) {
      const threadId = event.thread_id;
      const toolName = data.name;
      setGraphActiveTools((prev) => {
        if (prev[threadId] !== toolName) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
    }

    if (event.type === "llm.done" && data.message) {
      setGraphThreads((prev) => prev.map((t) =>
        t.id === event.thread_id ? { ...t, iteration: data.iteration || t.iteration, rate: data.rate || t.rate } : t
      ));
    }
  };
  handleEventRef.current = handleEvent;

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
  // panel's status dot + the stats badge + Activity are
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

  // SSE is the fast path; stored telemetry is the correctness backstop. Query
  // a small overlap window so any event missed during a reconnect or server
  // restart is fanned through the same deduped handler within five seconds.
  useEffect(() => {
    if (instance.status !== "running") return;
    let cancelled = false;
    let inFlight = false;
    const reconcile = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const sinceMs = Math.max(0, lastStoredTelemetryMsRef.current - 2_000);
        const events = await telemetry.query(
          instance.id,
          undefined,
          1000,
          undefined,
          sinceMs > 0 ? new Date(sinceMs).toISOString() : undefined,
        );
        if (cancelled) return;
        const historical = [...events].reverse();
        for (const event of historical) {
          handleEventRef.current(event);
          const ms = telemetryTimeMs(event);
          if (ms > lastStoredTelemetryMsRef.current) lastStoredTelemetryMsRef.current = ms;
        }
      } catch {
        // The next interval, reconnect, or visibility transition retries.
      } finally {
        inFlight = false;
      }
    };
    const recover = () => {
      if (document.visibilityState === "hidden") return;
      void reconcile();
    };
    void reconcile();
    const interval = window.setInterval(() => void reconcile(), 5_000);
    window.addEventListener("online", recover);
    window.addEventListener("apteva.telemetry.reconnected", recover);
    window.addEventListener("apteva.telemetry.gap", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", recover);
      window.removeEventListener("apteva.telemetry.reconnected", recover);
      window.removeEventListener("apteva.telemetry.gap", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [instance.id, instance.status]);

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
    view === "memory" ? (
      <div className="h-full min-h-0 flex flex-col">
          <UnconsciousPanel instanceId={instance.id} compact onAgentReload={onReload} />
          {instance.status === "running" ? (
          <div className="flex-1 min-h-0">
            <MemoryPanel instanceId={instance.id} />
          </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
              Start the agent to inspect persisted memories.
            </div>
          )}
      </div>
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
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Reset confirmation */}
      <Modal
        open={showResetConfirm}
        onClose={() => {
          if (resetBusy) return;
          setShowResetConfirm(false);
          setResetFeedback(null);
        }}
      >
        <div className="p-6">
          <h3 className="text-text text-lg font-bold mb-2">Reset context</h3>
          <p className="text-text-dim text-sm mb-4">
            Wipe <span className="text-text font-bold">{instance.name}</span>'s conversation history and kill every sub-thread?
            Directive, MCP servers, and integrations are kept. This cannot be undone.
          </p>
          {resetFeedback && (
            <div
              role={resetFeedback.tone === "error" ? "alert" : "status"}
              className={`mb-5 rounded border px-3 py-2 text-xs leading-relaxed ${
                resetFeedback.tone === "error"
                  ? "border-red/40 bg-red/10 text-red"
                  : "border-green/40 bg-green/10 text-green"
              }`}
            >
              <span className="font-bold">
                {resetFeedback.tone === "error" ? "Context cleanup failed. " : "Context cleaned. "}
              </span>
              <span className={resetFeedback.tone === "error" ? "" : "text-text-muted"}>
                {resetFeedback.message}
              </span>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setShowResetConfirm(false);
                setResetFeedback(null);
              }}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
              disabled={resetBusy}
            >
              {resetFeedback?.tone === "success" ? "Close" : "Cancel"}
            </button>
            <button
              onClick={async () => {
                setResetBusy(true);
                setResetFeedback(null);
                try {
                  const response = await core.resetInstance(instance.id, { history: true, threads: true });
                  const result = response.reset;
                  const message = result
                    ? `${formatContextResetResult(result)} Removed ${result.threads_removed || 0} ${result.threads_removed === 1 ? "sub-thread" : "sub-threads"}.`
                    : "The core confirmed the cleanup. Refresh the agent to inspect the new context.";
                  setResetFeedback({ tone: "success", message });
                  setGraphThreads((prev) => prev.filter((thread) => thread.id === "main"));
                  onReload();
                } catch (error: any) {
                  setResetFeedback({
                    tone: "error",
                    message: error?.message || "Context cleanup failed",
                  });
                } finally {
                  setResetBusy(false);
                }
              }}
              disabled={resetBusy}
              className="px-4 py-2 bg-yellow text-bg rounded-lg text-sm font-bold hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              {resetBusy ? "resetting…" : resetFeedback?.tone === "success" ? "Reset again" : "Reset context"}
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <AgentRuntimePanel
            key={instance.id}
            instance={instance}
            threads={graphThreads}
            activeTools={graphActiveTools}
            thinking={graphThinking}
            events={runtimeEvents}
            runtimeLoading={runtimeLoading}
            view={view}
            onViewChange={setView}
            onThreadOpen={setSelectedThreadId}
            subscribe={subscribe}
            onPause={async () => { await instances.pause(instance.id); onReload(); }}
            onStop={async () => { await instances.stop(instance.id); onReload(); }}
            onStart={async () => { await instances.start(instance.id); onReload(); }}
            onConfig={() => setShowConfig(true)}
            onAppearanceSaved={onReload}
            onReset={() => setShowResetConfirm(true)}
            onDelete={() => setShowDeleteConfirm(true)}
            advancedContent={advancedContent}
          />
        </div>
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

export function AgentRuntimePanel({
  instance,
  threads,
  activeTools,
  thinking,
  events,
  runtimeLoading,
  view,
  onViewChange,
  onThreadOpen,
  subscribe,
  onPause,
  onStop,
  onStart,
  onConfig,
  onAppearanceSaved,
  onReset,
  onDelete,
  advancedContent,
}: {
  instance: Agent;
  threads: Thread[];
  activeTools: Record<string, string>;
  thinking: Record<string, boolean>;
  events: RuntimeEventItem[];
  runtimeLoading: boolean;
  view: RuntimeView;
  onViewChange: (v: RuntimeView) => void;
  onThreadOpen: (id: string) => void;
  subscribe: SubscribeFn;
  onPause: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onStart: () => void | Promise<void>;
  onConfig: () => void;
  onAppearanceSaved: () => void;
  onReset: () => void;
  onDelete: () => void;
  advancedContent: ReactNode;
}) {
  // The Settings interface preference is the only audience selector.
  const { audience: selectedAudience } = useAudience();
  const { currentProject: contextProject } = useProjects();
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [mcpServers, setMCPServers] = useState<MCPServerConfig[]>([]);
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [mcpInventory, setMCPInventory] = useState<MCPServer[]>([]);
  const toolRegistry = useMemo(() => buildToolVisualRegistry(installedApps, connections, mcpInventory), [installedApps, connections, mcpInventory]);
  const [showCapabilitiesManage, setShowCapabilitiesManage] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [appearanceIcon, setAppearanceIcon] = useState(instance.icon || "robot");
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [appearanceError, setAppearanceError] = useState("");
  const openAppearance = () => {
    setAppearanceIcon(suggestedAgentIcon(instance.icon));
    setAppearanceError("");
    setShowAppearance(true);
  };
  const saveAppearance = async () => {
    setAppearanceSaving(true);
    setAppearanceError("");
    try {
      await instances.updateIdentity(instance.id, { icon: appearanceIcon, icon_color: "accent" });
      onAppearanceSaved();
      window.dispatchEvent(new Event("apteva:agents-changed"));
      setShowAppearance(false);
    } catch (err) {
      setAppearanceError(err instanceof Error ? err.message : "Could not save agent icon");
    } finally {
      setAppearanceSaving(false);
    }
  };
  const [selectedRuntimeThread, setSelectedRuntimeThread] = useState("main");
  useAssistantPageDetails(instance.project_id || contextProject?.id || "", { viewed_agent_id: instance.id, viewed_agent_name: instance.name, thread_id: selectedRuntimeThread, tab: view });
  const [executionControl, setExecutionControl] = useState<ExecutionControlStatus>({
    mode: "auto",
    scope: "instance",
    follow: "active",
    waiting: false,
  });
  const [liveStatus, setLiveStatus] = useState<Status | null>(null);
  const [executionBusy, setExecutionBusy] = useState<"run" | "pause" | "step" | "back" | null>(null);
  const [showDeveloperControls, setShowDeveloperControls] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const performLifecycleAction = async (action: () => void | Promise<void>) => {
    setLifecycleBusy(true);
    setLifecycleError("");
    try {
      await action();
      const next = await core.status(instance.id).catch(() => null);
      if (next) { setLiveStatus(next); if (next.execution_control) setExecutionControl(next.execution_control); }
    } catch (error) {
      setLifecycleError(error instanceof Error ? error.message : "Could not update this agent.");
    } finally { setLifecycleBusy(false); }
  };
  const telemetryConnection = useTelemetryConnectionState();

  useEffect(() => {
    setSelectedRuntimeThread("main");
    setLiveStatus(null);
  }, [instance.id]);

  const selectRuntimeThread = (threadId: string) => {
    setSelectedRuntimeThread(threadId);
  };

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
          if (!cancelled) {
            setLiveStatus(s);
            if (s.execution_control) setExecutionControl(s.execution_control);
          }
        })
        .catch(() => {});
      integrations.connections(instance.project_id, { includeAppOwned: true })
        .then((rows) => { if (!cancelled) setConnections(rows); }).catch(() => {});
      appsAPI.list(instance.project_id)
        .then((rows) => {
          if (!cancelled) setInstalledApps(rows || []);
        })
        .catch(() => {});
      mcpServersAPI.list(instance.project_id, { includeAppOwned: true })
        .then((rows) => {
          if (!cancelled) setMCPInventory(rows || []);
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

  const primaryViews: Array<{ id: RuntimeView; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "stream", label: "Activity" },
    { id: "memory", label: "Knowledge" },
    { id: "capabilities", label: "Capabilities" },
    ...(installedApps.some((app) => app.status === "running" && app.ui_panels?.some((panel) => panel.slot === "instance.tab")) ? [{ id: "apps" as const, label: "App panels" }] : []),
    ...(selectedAudience === "developer" || view === "activity" ? [{ id: "activity" as const, label: "Diagnostics" }] : []),
  ];
  const diagnostics = view === "activity";
  const usage = useAgentUsage(instance.id, subscribe);
  const working = instance.status === "running" && (Object.values(activeTools).some(Boolean) || Object.values(thinking).some(Boolean));
  const isPaused = instance.status === "paused" || !!liveStatus?.paused || executionControl.mode === "paused";
  const statusLabel = instance.status === "stopped" ? "Stopped" : isPaused ? "Paused"
    : instance.status !== "running" ? instance.status
    : executionControl.waiting ? "Needs attention"
    : telemetryConnection !== "open" ? "Reconnecting" : working ? "Working" : "Ready";
  const togglePause = async () => {
    if (!isPaused || liveStatus?.paused) await onPause();
    if (isPaused && executionControl.mode === "paused") await sendExecutionControl("run");
  };
  const executionControlsVisible = diagnostics && (showDeveloperControls || executionControl.mode !== "auto" || !!executionControl.waiting);
  const openDiagnostics = () => onViewChange("activity");

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <Modal open={showAppearance} ariaLabel="Change agent icon" onClose={() => { if (!appearanceSaving) setShowAppearance(false); }} width="max-w-xl">
        <div className="page-safe-bottom max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <h2 className="text-base font-bold text-text">Agent icon</h2>
          <p className="mt-1 text-xs text-text-muted">Choose a visual for {instance.name}. This does not change how the agent works.</p>
          <div className="mt-5"><AgentIconPicker icon={appearanceIcon} onIconChange={setAppearanceIcon} /></div>
          {appearanceError && <p role="alert" className="mt-4 text-xs text-red">{appearanceError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={appearanceSaving} onClick={() => setShowAppearance(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted">Cancel</button>
            <button type="button" disabled={appearanceSaving} onClick={() => void saveAppearance()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50">{appearanceSaving ? "Saving…" : "Save icon"}</button>
          </div>
        </div>
      </Modal>
      <Modal
        open={showCapabilitiesManage}
        ariaLabel="Apps and MCP servers"
        onClose={() => setShowCapabilitiesManage(false)}
        width="max-w-3xl"
      >
        <div className="w-full max-h-[80vh] flex flex-col bg-bg-card">
          <div className="shrink-0 p-5 border-b border-border flex items-start justify-between gap-4">
            <div>
              <h2 className="text-text text-lg font-bold">Capabilities</h2>
              <p className="text-text-dim text-xs mt-1">
                Choose apps, integrations, and MCP servers this agent can use.
              </p>
            </div>
            <button
              onClick={() => setShowCapabilitiesManage(false)}
              className="text-text-muted hover:text-text text-sm"
              title="Close"
            >
              ×
            </button>
          </div>
          <CapabilitiesManager
            instanceId={instance.id}
            projectId={instance.project_id || undefined}
            attached={mcpServers}
            apps={installedApps}
            inventory={mcpInventory}
            onAttachedChange={setMCPServers}
            onInventoryChange={setMCPInventory}
            onDone={() => setShowCapabilitiesManage(false)}
          />
        </div>
      </Modal>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4">
        <button type="button" onClick={openAppearance} className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-accent" aria-label={`Change icon for ${instance.name}`}>
          <AgentMark icon={instance.icon} color={instance.icon_color} size="sm" />
        </button>
        <h1 title={instance.name} className="min-w-0 flex-1 truncate text-sm font-bold text-text">{instance.name}</h1>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted" role="status" title={statusLabel}>
          <span className={`h-2 w-2 rounded-full ${statusLabel === "Working" ? "bg-accent motion-safe:animate-pulse" : statusLabel === "Ready" ? "bg-green" : statusLabel === "Needs attention" ? "bg-yellow" : "bg-text-dim"}`} />
          <span className="sr-only md:not-sr-only">{statusLabel}</span>
        </span>
        <button type="button" onClick={() => setShowCapabilitiesManage(true)} className="flex min-h-9 shrink-0 items-center rounded-md border border-border px-2 text-left hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent" aria-label="Manage capabilities">
          <AgentCapabilityIcons attached={mcpServers} skills={[]} catalog={{ apps: installedApps, connections, inventory: mcpInventory }} compact />
        </button>
        {instance.status === "running" ? (
          <button type="button" disabled={lifecycleBusy} onClick={() => void performLifecycleAction(togglePause)} className="hidden h-9 shrink-0 rounded-md border border-border px-3 text-xs text-text-muted hover:text-text disabled:opacity-50 sm:inline-flex sm:items-center">{lifecycleBusy ? "Updating…" : isPaused ? "Resume" : "Pause"}</button>
        ) : (
          <button type="button" disabled={lifecycleBusy} onClick={() => void performLifecycleAction(onStart)} className="h-9 shrink-0 rounded-md border border-border px-2 text-xs text-accent hover:border-accent disabled:opacity-50 sm:px-3">{lifecycleBusy ? "Starting…" : instance.status === "paused" ? "Resume" : "Start"}</button>
        )}
        <AgentRuntimeActionsMenu paused={isPaused} presentationAudience={selectedAudience} instance={instance} developerControlsVisible={executionControlsVisible}
          onPause={() => performLifecycleAction(togglePause)} onStop={() => performLifecycleAction(onStop)} onConfig={onConfig} onAppearance={openAppearance}
          onCapabilities={() => setShowCapabilitiesManage(true)} onDiagnostics={openDiagnostics}
          onToggleDeveloperControls={() => { openDiagnostics(); setShowDeveloperControls((visible) => !visible); }}
          onReset={onReset} onDelete={onDelete} />
      </header>
      <AgentSummaryBar instance={instance} usage={usage} />
      {lifecycleError && <div role="alert" className="shrink-0 border-b border-red/30 px-4 py-3 text-xs text-red">{lifecycleError}</div>}
      {executionControl.waiting && !isPaused && !diagnostics && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-yellow/30 bg-yellow/5 px-4 py-3 text-xs text-text">
        <span className="flex-1">This agent is waiting for an execution decision.</span><button type="button" onClick={openDiagnostics} className="min-h-9 rounded-lg border border-yellow/40 px-3 text-yellow">Review</button>
      </div>}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:px-5" aria-label="Agent workspace">
        {primaryViews.map((item) => <button type="button" key={item.id} onClick={() => onViewChange(item.id)} aria-current={view === item.id ? "page" : undefined}
          className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-medium ${view === item.id ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}>{item.label}</button>)}
      </nav>
      {diagnostics && <>
        <RuntimeContextStrip instanceId={instance.id} threads={threads} activeTools={activeTools} thinking={thinking} selectedThreadId={selectedRuntimeThread} onThreadSelect={selectRuntimeThread} onThreadOpen={onThreadOpen} />
        {executionControlsVisible && <div className="shrink-0 border-b border-border px-4 py-2"><ExecutionControlStrip status={executionControl} disabled={instance.status !== "running" || executionBusy !== null} busy={executionBusy} onRun={() => sendExecutionControl("run")} onPause={() => sendExecutionControl("pause")} onStep={() => sendExecutionControl("step")} onBack={restorePreviousStep} onThreadOpen={onThreadOpen} /></div>}
      </>}

      <div className="min-h-0 flex-1">
        {view === "overview" ? <div className="h-full overflow-y-auto">
          <AgentOverview key={`${instance.id}:${selectedAudience}`} instance={instance} projectId={instance.project_id || contextProject?.id}
            audience={selectedAudience} toolRegistry={toolRegistry} events={events} loading={runtimeLoading}
            attachmentKey={mcpServers.map((server) => `${server.name}:${server.url}`).join("|")}
            onDetails={onThreadOpen} onActivity={() => onViewChange("stream")} onCapabilities={() => setShowCapabilitiesManage(true)}
            />
        </div> : view === "stream" ? <div className="h-full overflow-y-auto p-3 sm:p-4"><div className="w-full"><AgentActivity toolRegistry={toolRegistry} events={events} threads={threads} loading={runtimeLoading} onDetails={onThreadOpen} /></div></div>
        : view === "activity" ? <AgentDiagnostics instance={instance} status={liveStatus} execution={executionControl} connection={telemetryConnection} usage={usage} onActivity={() => onViewChange("stream")} onConfig={onConfig} /> : view === "capabilities" ? <AgentCapabilitiesView instance={instance} attached={mcpServers} inventory={mcpInventory} onManage={() => setShowCapabilitiesManage(true)} />
        : advancedContent}
      </div>
      {diagnostics && instance.status === "running" && <InjectPanel instanceId={instance.id} threads={threads} />}

    </section>
  );
}

function AgentRuntimeActionsMenu({
  instance,
  presentationAudience,
  paused,
  developerControlsVisible,
  onPause,
  onStop,
  onConfig,
  onAppearance,
  onCapabilities,
  onDiagnostics,
  onToggleDeveloperControls,
  onReset,
  onDelete,
}: {
  instance: Agent;
  presentationAudience: Audience;
  paused: boolean;
  developerControlsVisible: boolean;
  onPause: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onConfig: () => void;
  onAppearance: () => void;
  onCapabilities: () => void;
  onDiagnostics: () => void;
  onToggleDeveloperControls: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const shows = (section: AudienceSection) => audienceShows(presentationAudience, section);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  const choose = (action: () => void | Promise<void>) => {
    setOpen(false);
    void action();
  };

  const itemClass = "flex min-h-10 w-full items-center px-3 text-left text-xs text-text transition-colors hover:bg-bg-hover";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-lg leading-none transition-colors ${
          open ? "border-text-dim bg-bg-hover text-text" : "border-border text-text-muted hover:bg-bg-hover hover:text-text"
        }`}
        aria-label={`Actions for ${instance.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-bg-card py-1 shadow-2xl shadow-black/60">
          <button type="button" role="menuitem" onClick={() => choose(onConfig)} className={itemClass}>Settings</button>
          <button type="button" role="menuitem" onClick={() => choose(onAppearance)} className={itemClass}>Change icon</button>
          <button type="button" role="menuitem" onClick={() => choose(onCapabilities)} className={itemClass}>Add apps &amp; MCPs</button>
          {instance.status === "running" && (
            <button type="button" role="menuitem" onClick={() => choose(onPause)} className={itemClass}>{paused ? "Resume agent" : "Pause agent"}</button>
          )}
          {(shows("agent.diagnostics") || shows("agent.stepControls")) && (
            <div className="my-1 border-t border-border" />
          )}
          {shows("agent.diagnostics") && (
            <button type="button" role="menuitem" onClick={() => choose(onDiagnostics)} className={itemClass}>Open diagnostics</button>
          )}
          {shows("agent.stepControls") && (
            <button type="button" role="menuitem" onClick={() => choose(onToggleDeveloperControls)} className={itemClass}>
              {developerControlsVisible ? "Hide step controls" : "Show step controls"}
            </button>
          )}
          <div className="my-1 border-t border-border" />
          {instance.status !== "stopped" && <button type="button" role="menuitem" onClick={() => choose(onStop)} className={`${itemClass} text-red`}>Stop agent</button>}
          {shows("agent.resetContext") && (
            <button type="button" role="menuitem" onClick={() => choose(onReset)} className={`${itemClass} text-yellow`}>Reset context</button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onDelete)} className={`${itemClass} text-red`}>Delete agent</button>
        </div>
      )}
    </div>
  );
}

function RuntimeContextStrip({
  instanceId,
  threads,
  activeTools,
  thinking,
  selectedThreadId,
  onThreadSelect,
  onThreadOpen,
}: {
  instanceId: number;
  threads: Thread[];
  activeTools: Record<string, string>;
  thinking: Record<string, boolean>;
  selectedThreadId: string;
  onThreadSelect: (id: string) => void;
  onThreadOpen: (id: string) => void;
}) {
  const mainThread: Thread = { id: "main", directive: "", tools: [], iteration: 0, rate: "", model: "", age: "" };
  const rows = threads.some((thread) => thread.id === "main") ? threads : [mainThread, ...threads];
  const selected = rows.find((thread) => thread.id === selectedThreadId) || rows[0] || mainThread;
  const tool = activeTools[selected.id];
  const isThinking = !!thinking[selected.id];
  const state = tool
    ? `Using ${tool}`
    : selected.realtime
      ? "Live voice"
      : isThinking
        ? "Thinking"
        : selected.sleep_state
          ? sleepLabel(selected, { compact: true })
        : selected.rate || "Waiting";
  const [usage, setUsage] = useState<ReturnType<typeof threadTokenUsage> | null>(null);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    setUsage(null);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const events = await telemetry.query(instanceId, "llm.done", 300, selected.id);
        if (!cancelled) setUsage(threadTokenUsage(events));
      } catch {
        if (!cancelled) setUsage(null);
      } finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(load, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [instanceId, selected.id]);

  return (
    <div className="shrink-0 flex min-w-0 flex-wrap items-center gap-2 border-b border-border/70 bg-bg-card/30 px-3 py-2 sm:px-4">
      <span className="text-[9px] font-bold uppercase tracking-wide text-text-dim">Thread</span>
      {rows.length > 1 ? (
        <select
          value={selected.id}
          onChange={(event) => onThreadSelect(event.target.value)}
          className="h-8 max-w-48 rounded-md border border-border bg-bg-input px-2 text-xs text-text focus:border-accent focus:outline-none"
          aria-label="Runtime thread"
        >
          {rows.map((thread) => <option key={thread.id} value={thread.id}>{thread.name || thread.id}</option>)}
        </select>
      ) : (
        <span className="text-xs font-medium text-text">{selected.name || selected.id}</span>
      )}
      {selected.realtime && (
        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
          Voice{selected.voice ? ` · ${selected.voice}` : ""}
        </span>
      )}
      <span className={`h-1.5 w-1.5 rounded-full ${tool ? "bg-accent animate-pulse" : isThinking ? "bg-yellow animate-pulse" : "bg-text-dim"}`} />
      <span className="max-w-52 truncate text-[11px] text-text-muted">{state}</span>
      {usage && <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim tabular-nums" title="Selected thread · latest 300 completed LLM calls. Arrows indicate input and output tokens; cached tokens are included in input. A dash means cache usage was not reported.">
        <span className="whitespace-nowrap">{formatCompactNumber(usage.in)} ↑</span>
        <span className="whitespace-nowrap">{formatCompactNumber(usage.out)} ↓</span>
        <span className="whitespace-nowrap">cached {usage.cacheReported ? formatCompactNumber(usage.cache) : "—"}</span>
        {usage.cacheWrite > 0 && <span className="whitespace-nowrap">cache write {formatCompactNumber(usage.cacheWrite)}</span>}
      </span>}
      <button type="button" onClick={() => onThreadOpen(selected.id)} className="rounded px-1.5 py-1 text-[10px] text-text-dim hover:bg-bg-hover hover:text-text">Details</button>

    </div>
  );
}

function AgentCapabilitiesView({
  instance,
  attached,
  inventory,
  onManage,
}: {
  instance: Agent;
  attached: MCPServerConfig[];
  inventory: MCPServer[];
  onManage: () => void;
}) {
  const [section, setSection] = useState<"connections" | "skills" | "apps">("connections");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 flex items-center gap-1 border-b border-border px-3 py-2 sm:px-4">
        {([
          ["connections", `MCP & Apps ${attached.length}`],
          ["skills", "Skills"],
          ["apps", "App panels"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`rounded-md px-2.5 py-1.5 text-[11px] ${section === id ? "bg-bg-hover text-text" : "text-text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
        <button type="button" onClick={onManage} className="ml-auto rounded-md border border-accent/50 px-2.5 py-1.5 text-[11px] text-accent hover:bg-accent/10">
          Add apps &amp; MCPs
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {section === "connections" ? (
          <div className="h-full overflow-y-auto p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text">Attached capabilities</h2>
              <p className="mt-1 text-xs text-text-muted">Apps and MCP servers available to this agent. Use Add apps & MCPs to attach or remove them.</p>
            </div>
            {attached.length === 0 ? (
              <button type="button" onClick={onManage} className="flex w-full items-center justify-between rounded-lg border border-dashed border-border px-4 py-5 text-left hover:border-accent/60 hover:bg-bg-card">
                <span>
                  <span className="block text-sm text-text">No capabilities attached</span>
                  <span className="mt-1 block text-xs text-text-muted">Select an app or MCP server for this agent.</span>
                </span>
                <span className="text-xs font-semibold text-accent">Add capability</span>
              </button>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {attached.map((capability) => {
                  const row = inventory.find((candidate) =>
                    mcpCapabilityAliases(candidate).some((alias) => capabilityKey(alias) === capabilityKey(capability.name)),
                  );
                  return (
                    <button key={capability.name} type="button" onClick={onManage} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-bg-card/50 p-3 text-left hover:border-accent/50 hover:bg-bg-hover">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${capability.connected === false ? "bg-red" : "bg-green"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text">{row ? displayMCPName(row) : capabilityDisplayName(capability.name)}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-text-muted">{row ? `${row.tool_count || 0} tools · ${sourceLabel(row)}` : capability.transport || "MCP server"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : section === "skills" ? (
          <SkillsPanel instanceId={instance.id} />
        ) : (
          <div className="h-full overflow-auto p-3">
            <AppPanels
              slot="instance.tab"
              instanceId={instance.id}
              projectId={instance.project_id || undefined}
              className="h-full space-y-3"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function capabilityDisplayName(name: string): string {
  return name
    .replace(/^apteva[-_]/, "")
    .replace(/^mcp[-_:]/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusFallbackForInstance(status: string) {
  if (status === "running") return { sleep_state: "unknown" };
  if (status === "paused") return { sleep_state: "paused" };
  return { sleep_state: "stopped" };
}

function SleepPill({ sleep }: { sleep: Status | { sleep_state?: string } | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const now = Date.now();
  const progress = sleepProgress(sleep, now);
  return (
    <span
      className={`relative inline-flex min-w-[92px] items-center justify-center overflow-hidden rounded border border-border px-2 py-0.5 text-[10px] font-mono ${sleepClassName(sleep)}`}
      title={sleepTitle(sleep, now)}
    >
      {progress != null && sleep?.sleep_state === "sleeping" && (
        <span
          className="absolute inset-y-0 left-0 bg-current opacity-10"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
      <span className="relative truncate">{sleepLabel(sleep, { compact: true, now })}</span>
    </span>
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
  const { shows } = useAudience();
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

  // Step/run/back controls are a debugging affordance. Non-developer
  // audiences never drive the loop by hand, so the whole strip goes.
  if (!shows("agent.stepMode")) return null;

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

export function CapabilitiesManager({
  instanceId,
  projectId,
  attached,
  apps,
  inventory: inventoryProp,
  onAttachedChange,
  onInventoryChange,
  onDone,
}: {
  instanceId: number;
  projectId?: string;
  attached: MCPServerConfig[];
  apps: AppRow[];
  inventory: MCPServer[];
  onAttachedChange: (servers: MCPServerConfig[]) => void;
  onInventoryChange: (servers: MCPServer[]) => void;
  onDone?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    integrations.connections(projectId).then((rows) => { if (!cancelled) setConnections(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"attached" | "apps" | "integrations" | "custom">("attached");
  const showAttachedOnly = category === "attached";

  const loadInventory = useCallback(() => {
    setLoading(true);
    mcpServersAPI
      .list(projectId)
      .then((rows) => onInventoryChange(rows || []))
      .catch((err) => setError(err?.message || "Failed to load capabilities"))
      .finally(() => setLoading(false));
  }, [projectId, onInventoryChange]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  const attachedNames = useMemo(
    () => new Set(attached.map((server) => server.name)),
    [attached],
  );
  const attachedKeys = useMemo(() => attachedCapabilityKeys(attached), [attached]);

  const refreshAttached = async () => {
    const config = await core.config(instanceId);
    onAttachedChange(config.mcp_servers || []);
  };

  const attachInventory = async (row: MCPServer, _aliases?: string[]) => {
    const entry = configFromInventory(row);
    if (!entry) return;
    setBusyKey(`mcp:${mcpName(row)}`);
    setError(null);
    try {
      await core.mutateMCPServers(instanceId, [row.id], "add");
      await refreshAttached();
    } catch (err: any) {
      setError(err?.message || "Failed to enable capability");
    } finally {
      setBusyKey(null);
    }
  };

  const detachInventory = async (row: MCPServer, name: string) => {
    setBusyKey(`mcp:${name}`);
    setError(null);
    try {
      await core.mutateMCPServers(instanceId, [row.id], "remove");
      await refreshAttached();
    } catch (err: any) {
      setError(err?.message || "Failed to disable capability");
    } finally {
      setBusyKey(null);
    }
  };

  const appInventoryByKey = useMemo(() => {
    const out = new Map<string, MCPServer>();
    for (const row of inventoryProp) {
      if (row.source !== "app") continue;
      for (const alias of mcpCapabilityAliases(row)) {
        const key = capabilityKey(alias);
        if (key && !out.has(key)) out.set(key, row);
      }
    }
    return out;
  }, [inventoryProp]);

  const appRows = apps
    .filter((app) => (app.surfaces?.mcp_tool_count || 0) > 0)
    .sort((a, b) => (a.display_name || a.name).localeCompare(b.display_name || b.name));
  const matchedAppInventoryIDs = new Set(
    appRows
      .map((app) => findAppInventoryRow(app, appInventoryByKey)?.id)
      .filter((id): id is number => typeof id === "number"),
  );
  const integrationRows = inventoryProp
    .filter((row) => row.source !== "app" && row.source !== "custom" && row.source !== "managed")
    .sort((a, b) => compareMCPRowsByAttachment(a, b, attachedKeys));
  const customRows = inventoryProp
    .filter((row) => row.source === "custom" || row.source === "managed")
    .sort((a, b) => compareMCPRowsByAttachment(a, b, attachedKeys));
  const orphanAppRows = inventoryProp
    .filter((row) => row.source === "app" && !matchedAppInventoryIDs.has(row.id))
    .sort((a, b) => displayMCPName(a).localeCompare(displayMCPName(b)));
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (...values: Array<string | undefined>) =>
    !normalizedQuery || values.some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  const visibleAppRows = appRows.filter((app) => {
    const row = findAppInventoryRow(app, appInventoryByKey);
    const enabled = capabilityIsAttached(attachedKeys, appCapabilityAliases(app, row));
    return (!showAttachedOnly || enabled) && matchesQuery(app.display_name, app.name, app.description, row?.name, row?.description);
  });
  const visibleOrphanAppRows = orphanAppRows.filter((row) =>
    (!showAttachedOnly || mcpRowIsAttached(attachedKeys, row)) && matchesQuery(row.name, row.description),
  );
  const visibleIntegrationRows = integrationRows.filter((row) =>
    (!showAttachedOnly || mcpRowIsAttached(attachedKeys, row)) && matchesQuery(row.name, row.description, mcpName(row), connections.find((c) => c.id === row.connection_id)?.app_name, connections.find((c) => c.id === row.connection_id)?.name),
  );
  const visibleCustomRows = customRows.filter((row) =>
    (!showAttachedOnly || mcpRowIsAttached(attachedKeys, row)) && matchesQuery(row.name, row.description, mcpName(row)),
  );
  const visibleCount = visibleAppRows.length + visibleOrphanAppRows.length + visibleIntegrationRows.length + visibleCustomRows.length;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg-card px-4 py-3">
        <div className="relative min-w-[14rem] flex-1">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search capabilities"
            placeholder="Search apps and MCP servers…"
            className="h-10 w-full rounded-lg border border-border bg-bg-input pl-9 pr-3 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex w-full flex-wrap items-center gap-1" aria-label="Capability categories">
          {([
            ["attached", "Attached", attached.length],
            ["apps", "Apps", appRows.length + orphanAppRows.length],
            ["integrations", "Integrations", integrationRows.length],
            ["custom", "MCP servers", customRows.length],
          ] as const).map(([id, label, count]) => (
            <button key={id} type="button" aria-pressed={category === id}
              onClick={() => setCategory(id)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${category === id ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-bg-hover"}`}>
              {label} <span className="ml-1 text-[10px] opacity-70">{count}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto space-y-5 p-3" style={{ maxHeight: "min(55vh, 520px)" }}>
      {error && <div role="alert" className="rounded-lg border border-red/40 bg-red/10 p-3 text-xs text-red">{error}</div>}
      {!loading && (category === "attached" ? visibleCount === 0 : category === "apps" ? visibleAppRows.length + visibleOrphanAppRows.length === 0 : category === "integrations" ? visibleIntegrationRows.length === 0 : visibleCustomRows.length === 0) && (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-text-muted">{normalizedQuery ? "No capabilities match your search." : category === "attached" ? "No capabilities attached yet." : "Nothing available in this category yet."}</p>
          {category === "attached" && !normalizedQuery && <button type="button" onClick={() => setCategory("apps")} className="mt-4 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text hover:border-accent hover:text-accent">+ Add apps</button>}
        </div>
      )}
      {((category === "apps" || category === "attached") && (visibleAppRows.length > 0 || visibleOrphanAppRows.length > 0)) && <CapabilitySection
        title="Apps"
        hint="Tools and skills for your agent"
      >
        {visibleAppRows.map((app) => {
          const row = findAppInventoryRow(app, appInventoryByKey);
          const aliases = appCapabilityAliases(app, row);
          const name = row ? mcpName(row) : app.name;
          const enabled = capabilityIsAttached(attachedKeys, aliases);
          return (
            <CapabilityToggleRow
              key={`app:${app.install_id}`}
              title={app.display_name || app.name}
              detail={`${app.project_id ? "Project app" : "Global app"} · v${app.version} · ${app.description || "Tools for your agent"}`}
              icon={<AppIcon src={app.icon} iconStyle={app.icon_style} name={app.display_name || app.name} size="md" className="text-accent" />}
              meta={`${app.surfaces?.mcp_tool_count || 0} tools`}
              enabled={enabled}
              disabled={!row}
              busy={busyKey === `mcp:${name}`}
              onToggle={() => row && (enabled ? detachInventory(row, name) : attachInventory(row, aliases))}
            />
          );
        })}
        {visibleOrphanAppRows.map((row) => {
          const name = mcpName(row);
          const enabled = attachedNames.has(name);
          return (
            <CapabilityToggleRow
              key={`app-orphan:${row.id}`}
              title={displayMCPName(row)}
              detail={row.name}
              meta={`${row.tool_count || 0} tools`}
              enabled={enabled}
              busy={busyKey === `mcp:${name}`}
              onToggle={() => enabled ? detachInventory(row, name) : attachInventory(row)}
            />
          );
        })}
      </CapabilitySection>}

      {((category === "integrations" || category === "attached") && visibleIntegrationRows.length > 0) && <CapabilitySection
        title="Integrations"
        hint="Connected accounts your agent can use"
      >
        {visibleIntegrationRows.map((row) => {
          const connection = connections.find((c) => c.id === row.connection_id);
          const name = mcpName(row);
          const aliases = mcpCapabilityAliases(row);
          const enabled = capabilityIsAttached(attachedKeys, aliases);
          return (
            <CapabilityToggleRow
              key={`integration:${row.id}`}
              title={connection?.app_name || displayMCPName(row)}
              detail={connection?.name || row.name}
              icon={<AppIcon src={connection?.logo} name={connection?.app_name || displayMCPName(row)} size="md" framed={false} className="rounded-md bg-white text-gray-800" />}
              meta={`${row.tool_count || 0} tools · ${scopeLabel(row)}`}
              enabled={enabled}
              disabled={!configFromInventory(row)}
              busy={busyKey === `mcp:${name}`}
              onToggle={() => enabled ? detachInventory(row, name) : attachInventory(row, aliases)}
            />
          );
        })}
      </CapabilitySection>}

      {((category === "custom" || category === "attached") && visibleCustomRows.length > 0) && <CapabilitySection
        title="MCP servers"
        hint="Custom tools and services"
      >
        {visibleCustomRows.map((row) => {
          const name = mcpName(row);
          const aliases = mcpCapabilityAliases(row);
          const enabled = capabilityIsAttached(attachedKeys, aliases);
          return (
            <CapabilityToggleRow
              key={`custom:${row.id}`}
              title={displayMCPName(row)}
              detail={row.name}
              meta={`${row.tool_count || 0} tools · ${row.transport || "stdio"}`}
              enabled={enabled}
              disabled={!configFromInventory(row)}
              busy={busyKey === `mcp:${name}`}
              onToggle={() => enabled ? detachInventory(row, name) : attachInventory(row, aliases)}
            />
          );
        })}
      </CapabilitySection>}

      {loading && (
        <div className="text-center text-xs text-text-muted py-2">Loading capabilities…</div>
      )}
      </div>
      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <span className="text-[11px] text-text-dim">{attached.length} attached · Changes apply immediately</span>
        {onDone && <button type="button" onClick={onDone} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text hover:border-accent hover:text-accent">Done</button>}
      </div>
    </div>
  );
}

function CapabilitySection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="text-[10px] uppercase tracking-wide text-text-muted font-bold shrink-0">{title}</h3>
        <span className="hidden sm:block text-[10px] text-text-dim truncate min-w-0">{hint}</span>
      </div>
      <div className="space-y-1">
        {children}
      </div>
    </section>
  );
}

function CapabilityToggleRow({ title, detail, meta, icon, enabled, disabled, busy, onToggle }: {
  title: string;
  detail: string;
  meta: string;
  icon?: ReactNode;
  enabled: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return <PickerOption
    name={title}
    description={truncateUI(detail, 180)}
    badge={busy ? "Updating…" : disabled ? "Unavailable" : meta}
    icon={icon || <AppIcon name={title} size="md" className="text-accent" />}
    selected={enabled}
    disabled={disabled || busy}
    onToggle={onToggle}
  />;
}

function mcpName(row: MCPServer): string {
  return row.proxy_config?.name || row.name;
}

function displayMCPName(row: MCPServer): string {
  return row.description || row.name;
}

function sourceLabel(row: MCPServer): string {
  if (row.source === "remote") return "remote";
  if (row.source === "local") return "integration";
  return row.source || "mcp";
}

function scopeLabel(row: MCPServer): string {
  return row.project_id ? "project" : "global";
}

function configFromInventory(row: MCPServer): MCPServerConfig | null {
  if (row.proxy_config) {
    return {
      name: row.proxy_config.name,
      transport: row.proxy_config.transport,
      url: row.proxy_config.url,
      command: row.proxy_config.command,
      args: row.proxy_config.args,
    };
  }
  if (row.url || row.transport === "http") {
    return {
      name: row.name,
      transport: row.transport || "http",
      url: row.url,
    };
  }
  if (row.command) {
    return {
      name: row.name,
      transport: row.transport || "stdio",
      command: row.command,
      args: row.args ? row.args.split(/\s+/).filter(Boolean) : undefined,
    };
  }
  return null;
}

function capabilityKey(value?: string | number | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function uniqueCapabilityAliases(values: Array<string | number | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    const key = capabilityKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function appMCPURLSlug(rawURL?: string): string {
  const match = String(rawURL || "").match(/\/api\/apps\/([^/?#]+)\/mcp/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function mcpURLInstallID(rawURL?: string): string {
  const text = String(rawURL || "");
  if (!text) return "";
  try {
    const parsed = new URL(text, window.location.origin);
    return parsed.searchParams.get("install_id") || "";
  } catch {
    const match = text.match(/[?&]install_id=([^&#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }
}

function appInstallAliases(installID?: number | string | null): string[] {
  if (installID === undefined || installID === null || installID === "") return [];
  return [`install:${installID}`, `app:${installID}`];
}

function mcpCapabilityAliases(row: MCPServer): string[] {
  const url = row.proxy_config?.url || row.url || "";
  const installID = mcpURLInstallID(url);
  return uniqueCapabilityAliases([
    row.name,
    mcpName(row),
    row.description,
    appMCPURLSlug(url),
    ...appInstallAliases(installID),
  ]);
}

function appCapabilityAliases(app: AppRow, row?: MCPServer | null): string[] {
  return uniqueCapabilityAliases([
    app.name,
    app.display_name,
    ...appInstallAliases(app.install_id),
    ...(row ? mcpCapabilityAliases(row) : []),
  ]);
}

function attachedMCPAliases(server: MCPServerConfig): string[] {
  const installID = mcpURLInstallID(server.url);
  return uniqueCapabilityAliases([
    server.name,
    appMCPURLSlug(server.url),
    ...appInstallAliases(installID),
  ]);
}

function attachedCapabilityKeys(servers: MCPServerConfig[]): Set<string> {
  const out = new Set<string>();
  for (const server of servers) {
    for (const alias of attachedMCPAliases(server)) {
      const key = capabilityKey(alias);
      if (key) out.add(key);
    }
  }
  return out;
}

function capabilityIsAttached(attachedKeys: Set<string>, aliases: string[]): boolean {
  return aliases.some((alias) => attachedKeys.has(capabilityKey(alias)));
}

function mcpRowIsAttached(attachedKeys: Set<string>, row: MCPServer): boolean {
  return capabilityIsAttached(attachedKeys, mcpCapabilityAliases(row));
}

function compareMCPRowsByAttachment(a: MCPServer, b: MCPServer, attachedKeys: Set<string>): number {
  const aAttached = mcpRowIsAttached(attachedKeys, a);
  const bAttached = mcpRowIsAttached(attachedKeys, b);
  if (aAttached !== bAttached) return aAttached ? -1 : 1;
  const aActive = a.status === "running" || a.status === "reachable";
  const bActive = b.status === "running" || b.status === "reachable";
  if (aActive !== bActive) return aActive ? -1 : 1;
  return displayMCPName(a).localeCompare(displayMCPName(b));
}

function removeAttachedByAliases(servers: MCPServerConfig[], aliases: string[]): MCPServerConfig[] {
  const keys = new Set(aliases.map(capabilityKey).filter(Boolean));
  return servers.filter((server) => !attachedMCPAliases(server).some((alias) => keys.has(capabilityKey(alias))));
}

function findAppInventoryRow(app: AppRow, inventoryByKey: Map<string, MCPServer>): MCPServer | undefined {
  for (const alias of appCapabilityAliases(app)) {
    const row = inventoryByKey.get(capabilityKey(alias));
    if (row) return row;
  }
  return undefined;
}

type ThreadContextUsage = {
  bytes: number;
  estimatedTokens: number;
  maxTokens: number;
  percent: number | null;
  systemBytes: number;
  nativeBytes: number;
  extraBytes: number;
  conversationBytes: number;
};

function contextUsageFromComposition(composition?: PromptComposition): ThreadContextUsage {
  const bytes = Math.max(0, composition?.grand_total || 0);
  const estimatedTokens = Math.ceil(bytes / 4);
  const maxTokens = Math.max(0, composition?.model_max_tokens || 0);
  const percent = maxTokens > 0 ? Math.round((estimatedTokens / maxTokens) * 100) : null;
  return {
    bytes,
    estimatedTokens,
    maxTokens,
    percent,
    systemBytes: composition?.system?.total || 0,
    nativeBytes: composition?.native_bytes || 0,
    extraBytes: composition?.extra_bytes || 0,
    conversationBytes: composition?.conv_bytes || 0,
  };
}

function ContextUsageBar({ usage, label }: { usage?: ThreadContextUsage; label?: string }) {
  if (!usage) {
    return (
      <span
        className="hidden sm:inline-flex w-[128px] shrink-0 items-center gap-1.5"
        title="Context usage loading"
      >
        <span className="text-[10px] text-text-dim tabular-nums text-right shrink-0">ctx --</span>
        <span className="h-1 flex-1 rounded-full bg-bg-input" />
      </span>
    );
  }
  const pct = usage.percent == null ? null : Math.max(0, Math.min(100, usage.percent));
  const fill = pct == null
    ? 0
    : pct >= 80
      ? pct
      : pct >= 60
        ? pct
        : pct;
  const color = pct == null
    ? "bg-text-dim"
    : pct >= 80
      ? "bg-red"
      : pct >= 60
        ? "bg-yellow"
        : "bg-green";
  const value = pct == null ? `~${formatCompactNumber(usage.estimatedTokens)}` : `${pct}%`;
  const title = [
    `${label ? `${label} ` : ""}estimated context usage: ${value}`,
    `${formatCompactNumber(usage.estimatedTokens)} estimated tokens from ${formatCompactNumber(usage.bytes)} chars`,
    usage.maxTokens > 0 ? `model window: ${formatCompactNumber(usage.maxTokens)} tokens` : "model window: unknown",
    `system ${formatCompactNumber(usage.systemBytes)} chars`,
    `tools ${formatCompactNumber(usage.nativeBytes)} chars`,
    `memories/system ${formatCompactNumber(usage.extraBytes)} chars`,
    `conversation ${formatCompactNumber(usage.conversationBytes)} chars`,
  ].join("\n");
  return (
    <span className="hidden sm:inline-flex w-[128px] shrink-0 items-center gap-1.5" title={title} aria-label={title}>
      <span className="text-[10px] text-text-dim tabular-nums text-right shrink-0">
        {label ? `${label} ` : "ctx "}{value}
      </span>
      <span className="h-1 flex-1 rounded-full bg-bg-input overflow-hidden">
        <span
          className={`block h-full rounded-full ${color}`}
          style={{ width: pct == null ? "18%" : `${fill}%` }}
        />
      </span>
    </span>
  );
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const n = Math.max(0, Math.round(value));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function ThreadSummary({
  instanceId,
  running,
  threads,
  activeTools,
  thinking,
  selectedThreadId,
  onThreadSelect,
  onThreadOpen,
}: {
  instanceId: number;
  running: boolean;
  threads: Thread[];
  activeTools: Record<string, string>;
  thinking: Record<string, boolean>;
  selectedThreadId: string;
  onThreadSelect: (id: string) => void;
  onThreadOpen: (id: string) => void;
}) {
  const mainThread: Thread = { id: "main", directive: "", tools: [], iteration: 0, rate: "", model: "", age: "" };
  const rows = threads.some((t) => t.id === "main") ? threads : [mainThread, ...threads];
  const sorted = useMemo(
    () =>
      [...rows]
        .sort((a, b) => {
          if (a.id === "main") return -1;
          if (b.id === "main") return 1;
          return (a.depth || 0) - (b.depth || 0) || a.id.localeCompare(b.id);
        })
        .slice(0, 8),
    [rows],
  );
  const visibleThreadIds = useMemo(() => sorted.map((t) => t.id), [sorted]);
  const [contextUsage, setContextUsage] = useState<Record<string, ThreadContextUsage>>({});
  const [threadStats, setThreadStats] = useState<Record<string, { in: number; out: number; cache: number }>>({});

  useEffect(() => {
    let cancelled = false;
    const ids = visibleThreadIds;
    if (!running || ids.length === 0) {
      setContextUsage({});
      return;
    }
    const load = async () => {
      const pairs = await Promise.all(
        ids.map(async (threadId) => {
          try {
            const snapshot = await core.threadContext(instanceId, threadId);
            return [threadId, contextUsageFromComposition(snapshot.composition)] as const;
          } catch {
            return [threadId, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setContextUsage((prev) => {
        const next: Record<string, ThreadContextUsage> = {};
        for (const [threadId, usage] of pairs) {
          if (usage) next[threadId] = usage;
          else if (prev[threadId]) next[threadId] = prev[threadId];
        }
        return next;
      });
      const totals: Record<string, { in: number; out: number; cache: number }> = {};
      for (const threadId of ids) {
        try {
          const events = await telemetry.query(instanceId, undefined, 300, threadId);
          const t = { in: 0, out: 0, cache: 0 };
          for (const e of events) { const d = e.data || {}; t.in += Number(d.input_tokens ?? d.tokens_in ?? 0) || 0; t.out += Number(d.output_tokens ?? d.tokens_out ?? 0) || 0; t.cache += Number(d.cache_read_tokens ?? d.cached_tokens ?? 0) || 0; }
          totals[threadId] = t;
        } catch { /* telemetry is best effort */ }
      }
      if (!cancelled) setThreadStats(totals);
    };
    load();
    const timer = window.setInterval(load, 7000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [instanceId, running, visibleThreadIds.join("|")]);

  useEffect(() => {
    if (visibleThreadIds.length === 0) return;
    if (!visibleThreadIds.includes(selectedThreadId)) {
      onThreadSelect(visibleThreadIds[0]);
    }
  }, [visibleThreadIds.join("|"), selectedThreadId, onThreadSelect]);

  return (
    <div className="p-3 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] uppercase tracking-wide text-text-muted font-bold">Current work</h2>
        <span className="text-[10px] text-text-dim">{rows.length} threads</span>
      </div>
      <div className="space-y-1">
        {sorted.map((t) => {
          const tool = activeTools[t.id];
          const isThinking = !!thinking[t.id];
          const depth = Math.min(t.depth || 0, 3);
          const now = Date.now();
          const state = tool ? `tool: ${tool}` : isThinking ? "thinking" : t.sleep_state ? sleepLabel(t, { compact: true, now }) : t.rate || "waiting";
          const selected = selectedThreadId === t.id;
          return (
            <div
              key={t.id}
              className={`group w-full min-w-0 flex items-center gap-1 rounded transition-colors ${
                selected ? "bg-accent/10 ring-1 ring-accent/40" : "hover:bg-bg-hover"
              }`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <button
                type="button"
                onClick={() => onThreadSelect(t.id)}
                className="min-w-0 flex flex-1 items-center gap-2 py-1.5 pr-1 text-left"
                title={`Show runtime stream for ${t.name || t.id}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tool ? "bg-accent animate-pulse" : isThinking ? "bg-yellow animate-pulse" : selected ? "bg-accent" : "bg-text-dim"}`} />
                <span className={`text-xs truncate ${selected ? "text-accent font-medium" : "text-text"}`}>{t.name || t.id}</span>
                <span className="text-[10px] text-text-muted truncate flex-1" title={t.sleep_state ? sleepTitle(t, now) : undefined}>{state}</span>
                <ContextUsageBar usage={contextUsage[t.id]} />
                {threadStats[t.id] && (threadStats[t.id].in || threadStats[t.id].out || threadStats[t.id].cache) ? <span className="hidden lg:inline text-[9px] text-text-dim tabular-nums" title="Thread token usage">{formatCompactNumber(threadStats[t.id].in)}↑ {formatCompactNumber(threadStats[t.id].out)}↓{threadStats[t.id].cache ? ` · ${formatCompactNumber(threadStats[t.id].cache)} cache` : ""}</span> : null}
                {t.age && <span className="text-[10px] text-text-dim tabular-nums shrink-0">{t.age}</span>}
              </button>
              <button
                type="button"
                onClick={() => onThreadOpen(t.id)}
                className="mr-1 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-bg-hover hover:text-text"
                title={`Open ${t.name || t.id} details`}
              >
                open
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CapabilityShelf({
  mcpServers,
  apps,
  inventory,
  instanceId,
  onAttachedChange,
  onManage,
}: {
  mcpServers: MCPServerConfig[];
  apps: AppRow[];
  inventory: MCPServer[];
  instanceId: number;
  onAttachedChange: (servers: MCPServerConfig[]) => void;
  onManage: () => void;
}) {
  const [busyName, setBusyName] = useState<string | null>(null);
  const attachedKeys = attachedCapabilityKeys(mcpServers);
  const appInventoryByKey = new Map<string, MCPServer>();
  for (const row of inventory) {
    if (row.source === "app") {
      for (const alias of mcpCapabilityAliases(row)) {
        const key = capabilityKey(alias);
        if (key && !appInventoryByKey.has(key)) appInventoryByKey.set(key, row);
      }
    }
  }
  const appCaps = apps
    .filter((app) => {
      const row = findAppInventoryRow(app, appInventoryByKey);
      const attached = capabilityIsAttached(attachedKeys, appCapabilityAliases(app, row));
      const hasSurface = (app.surfaces?.mcp_tool_count || 0) > 0 || (app.surfaces?.ui_panel_count || 0) > 0;
      return attached || (app.status === "running" && hasSurface);
    })
    .sort((a, b) => {
      const aRow = findAppInventoryRow(a, appInventoryByKey);
      const bRow = findAppInventoryRow(b, appInventoryByKey);
      const aAttached = capabilityIsAttached(attachedKeys, appCapabilityAliases(a, aRow));
      const bAttached = capabilityIsAttached(attachedKeys, appCapabilityAliases(b, bRow));
      if (aAttached !== bAttached) return aAttached ? -1 : 1;
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;
      return (a.display_name || a.name).localeCompare(b.display_name || b.name);
    });
  const custom = inventory
    .filter((row) => row.source !== "app")
    .filter((row) => !["channels", "apteva-channels", "apteva-server"].includes(mcpName(row)))
    .sort((a, b) => compareMCPRowsByAttachment(a, b, attachedKeys))
    .slice(0, 4);

  const toggleInventory = async (row: MCPServer, enabled: boolean, aliases?: string[]) => {
    const entry = configFromInventory(row);
    if (!entry) return;
    setBusyName(entry.name);
    try {
      await core.mutateMCPServers(instanceId, [row.id], enabled ? "remove" : "add");
      const config = await core.config(instanceId);
      onAttachedChange(config.mcp_servers || []);
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className="p-3 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] uppercase tracking-wide text-text-muted font-bold">Capabilities</h2>
        <button onClick={onManage} className="text-[10px] text-accent hover:text-accent-hover">
          Manage
        </button>
      </div>
      <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
        {appCaps.length > 0 && (
          <CapabilityGroup title="Apps">
            {appCaps.map((a) => {
              const row = findAppInventoryRow(a, appInventoryByKey);
              const aliases = appCapabilityAliases(a, row);
              const rowName = row ? mcpName(row) : a.name;
              const checked = capabilityIsAttached(attachedKeys, aliases);
              return (
                <CapabilityRow
                  key={a.install_id}
                  checked={checked}
                  name={a.display_name || a.name}
                  meta={`${a.surfaces?.mcp_tool_count || 0} tools${a.surfaces?.ui_panel_count ? " · UI" : ""}`}
                  active={a.status === "running"}
                  disabled={!row}
                  busy={busyName === rowName}
                  onClick={() => row && toggleInventory(row, checked, aliases)}
                />
              );
            })}
          </CapabilityGroup>
        )}
        {custom.length > 0 && (
          <CapabilityGroup title="MCPs">
            {custom.map((row) => {
              const rowName = mcpName(row);
              const aliases = mcpCapabilityAliases(row);
              const checked = capabilityIsAttached(attachedKeys, aliases);
              return (
                <CapabilityRow
                  key={row.id}
                  checked={checked}
                  name={displayMCPName(row)}
                  meta={`${row.tool_count || 0} tools`}
                  active={row.status === "running" || row.status === "reachable"}
                  disabled={!configFromInventory(row)}
                  busy={busyName === rowName}
                  onClick={() => toggleInventory(row, checked, aliases)}
                />
              );
            })}
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
  checked,
  name,
  meta,
  active,
  disabled,
  busy,
  onClick,
}: {
  checked: boolean;
  name: string;
  meta: string;
  active: boolean;
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick && !disabled && !busy;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={`relative flex w-full items-center gap-2 min-w-0 rounded px-2 py-1.5 text-left transition-colors ${
        checked ? "bg-accent/10 hover:bg-accent/15" : clickable ? "bg-bg-card/40 hover:bg-bg-hover" : "bg-bg-card/40"
      } ${disabled ? "opacity-50 cursor-not-allowed" : clickable ? "cursor-pointer" : "cursor-default"}`}
      title={clickable ? (checked ? "Click to remove" : "Click to add") : undefined}
    >
      <span className={`absolute left-0 top-0 bottom-0 w-[2px] rounded-l ${checked ? "bg-accent" : "bg-transparent"}`} />
      <span
        className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
          checked ? "bg-accent border-accent text-bg" : "border-border"
        }`}
      >
        {checked && (
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5 L7 12 L13 5" />
          </svg>
        )}
      </span>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-green" : "bg-text-dim"}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text truncate">{name}</div>
      </div>
      <span className="text-[10px] text-text-muted shrink-0 max-w-24 truncate">{busy ? "saving…" : meta}</span>
    </button>
  );
}

// --- Config Modal ---

function ConfigModal({ open, onClose, instance, onSaved }: {
  open: boolean;
  onClose: () => void;
  instance: Agent;
  onSaved: () => void;
}) {
  const { shows } = useAudience();
  const [providerList, setProviderList] = useState<RuntimeConnection[]>([]);
  const [serviceTierOverrides, setServiceTierOverrides] = useState<Record<string, string | null>>({});
  const [availableModels, setAvailableModels] = useState<Record<number, ModelInfo[]>>({});
  const [loadingModels, setLoadingModels] = useState<number | null>(null);
  const [defaultProvider, setDefaultProvider] = useState("");
  const [modelLarge, setModelLarge] = useState("");
  const [modelMedium, setModelMedium] = useState("");
  const [modelSmall, setModelSmall] = useState("");
  const [directive, setDirective] = useState("");
  const [mode, setMode] = useState("");
  const [proactivity, setProactivity] = useState(defaultProactivity);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);
  const [realtimeAvailable, setRealtimeAvailable] = useState(false);
  const [realtimeVoice, setRealtimeVoice] = useState("marin");
  const [realtimeProvider, setRealtimeProvider] = useState("");
  const [realtimeModel, setRealtimeModel] = useState("");
  const [realtimeProviders, setRealtimeProviders] = useState<Array<{
    name: string;
    default?: boolean;
    models?: Partial<Record<"large" | "medium" | "small", string>>;
    realtime_voice?: string;
  }>>([]);
  const [realtimeVoiceMCP, setRealtimeVoiceMCP] = useState<string[]>([]);
  const [realtimeCapabilityOptions, setRealtimeCapabilityOptions] = useState<MCPServerConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    // Model catalogs can change while the dashboard stays open (for example
    // when a provider exposes a newly released model). Do not retain the
    // previous modal session's list when reopening the editor.
    setAvailableModels({});
    setDirective(instance.directive || "");
    setMode(instance.mode || "autonomous");
    setProactivity(instance.proactivity ?? defaultProactivity);
    setError("");

    setDefaultProvider("");
    setServiceTierOverrides(agentServiceTiers(instance.config));

    core.config(instance.id).then((config) => {
      setDirective(config.directive);
      setMode(config.mode);
      setProactivity(config.proactivity ?? instance.proactivity ?? defaultProactivity);
      setDefaultProvider(resolveEffectiveAgentProvider(instance.config || "{}", config.providers));
      const voiceProviders = (config.providers || []).filter((provider) => provider.name.endsWith("-realtime"));
      const selectedVoiceProvider = voiceProviders.find((provider) => provider.default) || voiceProviders[0];
      const capabilityOptions = (config.mcp_servers || []).filter((server) =>
        server.name !== "channels" &&
        server.name !== "apteva-channels" &&
        server.name !== "apteva-server",
      );
      const availableNames = new Set(capabilityOptions.map((server) => server.name));
      setRealtimeProviders(voiceProviders);
      setRealtimeProvider(selectedVoiceProvider?.name || "");
      setRealtimeModel(selectedVoiceProvider?.models?.large || "");
      setRealtimeAvailable(!!selectedVoiceProvider);
      setRealtimeEnabled(config.realtime_enabled ?? !!selectedVoiceProvider);
      setRealtimeVoice(config.realtime_voice || selectedVoiceProvider?.realtime_voice || "marin");
      setRealtimeCapabilityOptions(capabilityOptions);
      setRealtimeVoiceMCP((config.realtime_voice_mcp || []).filter((name) => availableNames.has(name)));
    }).catch(() => {
      setDefaultProvider(resolveEffectiveAgentProvider(instance.config || "{}"));
      setRealtimeAvailable(false);
      setRealtimeEnabled(false);
      setRealtimeProviders([]);
      setRealtimeProvider("");
      setRealtimeModel("");
      setRealtimeCapabilityOptions([]);
      setRealtimeVoiceMCP([]);
    });

    integrations
      .runtimeConnections(instance.project_id)
      .then((list) => setProviderList((list || []).filter((c, index, rows) => c.role === "llm" && rows.findIndex((row) => row.provider_key === c.provider_key) === index)))
      .catch(() => {});
  }, [open, instance.id]);

  // When provider selection changes, load its current model settings
  const selectedDetail = providerList.find((c) => c.provider_key === defaultProvider);
  const selectedData = selectedDetail?.runtime_config ?? null;

  useEffect(() => {
    if (selectedData) {
      setModelLarge(selectedData.model_large || "");
      setModelMedium(selectedData.model_medium || "");
      setModelSmall(selectedData.model_small || "");
    } else {
      setModelLarge(""); setModelMedium(""); setModelSmall("");
    }
  }, [selectedData?.model_large, selectedData?.model_medium, selectedData?.model_small]);

  // Auto-fetch models when a provider is selected
  useEffect(() => {
    if (!selectedDetail || availableModels[selectedDetail.id]) return;
    setLoadingModels(selectedDetail.id);
    integrations.connectionModels(selectedDetail.id)
      .then((m) => {
        setAvailableModels((prev) => ({ ...prev, [selectedDetail.id]: m }));
      })
      .catch((err: any) => setError("Failed to fetch models: " + (err.message || "")))
      .finally(() => setLoadingModels(null));
  }, [selectedDetail?.id]);

  const handleRefreshModels = async () => {
    if (!selectedDetail) return;
    setLoadingModels(selectedDetail.id);
    try {
      const m = await integrations.connectionModels(selectedDetail.id, true);
      setAvailableModels((prev) => ({ ...prev, [selectedDetail.id]: m }));
    } catch (err: any) {
      setError("Failed to fetch models: " + (err.message || ""));
    } finally { setLoadingModels(null); }
  };

  const models = selectedDetail ? availableModels[selectedDetail.id] : undefined;
  const selectedRealtimeConfig = realtimeProviders.find((provider) => provider.name === realtimeProvider);
  const realtimeCatalog = providerList.find((connection) => connection.realtime?.provider_key === realtimeProvider)?.realtime;
  const realtimeModelOptions = realtimeCatalog?.models || Array.from(new Set([
    selectedRealtimeConfig?.models?.large,
    selectedRealtimeConfig?.models?.medium,
    selectedRealtimeConfig?.models?.small,
  ].filter((model): model is string => !!model))).map((model) => ({ id: model, name: model, available: true }));
  const realtimeVoices = realtimeCatalog?.voices || (realtimeProvider === "openai-realtime"
    ? ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"]
    : [selectedRealtimeConfig?.realtime_voice || realtimeVoice]);
  const selectedRealtimeVoice = realtimeVoices.includes(realtimeVoice) ? realtimeVoice : realtimeVoices[0];

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      // Save model selections through the narrow server route. OAuth-backed
      // providers keep their nested credentials and account state untouched.
      if (selectedDetail && selectedData) {
        if (
          modelLarge !== (selectedData.model_large || "") ||
          modelMedium !== (selectedData.model_medium || "") ||
          modelSmall !== (selectedData.model_small || "")
        ) {
          // null clears a tier back to the provider default; an empty
          // string would be stored as a literal model id.
          await integrations.updateRuntimeConfig(selectedDetail.id, {
            model_large: modelLarge || null,
            model_medium: modelMedium || null,
            model_small: modelSmall || null,
          });
        }
      }

      const provs = defaultProvider
        ? providerList.map((c) => ({ name: c.provider_key, default: c.provider_key === defaultProvider }))
        : undefined;
      const result = await instances.updateConfig(instance.id, {
        directive: directive || undefined,
        mode: mode || undefined,
        proactivity,
        providers: provs,
        serviceTierOverrides: serviceTierPatch(instance.config, serviceTierOverrides),
        realtimeEnabled,
        realtimeProvider: realtimeAvailable ? realtimeProvider : undefined,
        realtimeModel: realtimeAvailable ? realtimeModel : undefined,
        realtimeVoice: selectedRealtimeVoice,
        realtimeVoiceMCP,
      });
      onSaved();
      if (result.behavior_sync?.pending) {
        setError("Saved. Behavior is still pending for some workers; active voice sessions will continue until they can accept the change.");
        return;
      }
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
            <option key={m.id} value={m.id}>
              {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
            </option>
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

        {/* Default provider. Gated with Models below: which LLM powers an
            agent is one concern, and showing the model pickers without the
            provider they belong to reads as an orphan. */}
        {shows("agent.provider") && (
          <div>
            <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Provider</label>
            <select
              value={defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            >
              <option value="">Auto (server default)</option>
              {providerList.map((c) => (
                <option key={c.id} value={c.provider_key}>{c.app_name}</option>
              ))}
            </select>
          </div>
        )}

        {shows("agent.provider") && <ServiceTierSelect connection={selectedDetail} inherit value={serviceTierOverrides[defaultProvider]} disabled={saving} onChange={(value) => setServiceTierOverrides((current) => ({ ...current, [defaultProvider]: value }))} />}

        {/* Models */}
        {shows("agent.provider") && selectedDetail && (
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

        <p className="text-xs text-text-muted">{behaviorDescriptions[mode as keyof typeof behaviorDescriptions]} {behaviorExplanation}</p>

        <ProactivityControl value={proactivity} onChange={setProactivity} />

        {/* Realtime voice */}
        {shows("agent.realtimeVoice") && (
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Realtime voice</div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-dim">
                Start temporary live voice threads from this agent's chat. Important decisions and the final handoff return to main.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={realtimeEnabled}
              disabled={!realtimeAvailable}
              onClick={() => setRealtimeEnabled((value) => !value)}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${realtimeEnabled ? "bg-accent" : "bg-border"}`}
              title={realtimeAvailable ? "Enable realtime voice" : "No realtime provider is configured"}
            >
              <span
                aria-hidden="true"
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  realtimeEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          {!realtimeAvailable ? (
            <p className="mt-3 text-[11px] text-text-muted">Connect a provider with realtime voice support to enable voice.</p>
          ) : realtimeEnabled ? (
            <div className="mt-4 space-y-4 border-t border-border/70 pt-4">
              {realtimeProviders.length > 1 && (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-dim">Voice provider</label>
                  <select
                    value={realtimeProvider}
                    onChange={(event) => {
                      const name = event.target.value;
                      const provider = realtimeProviders.find((candidate) => candidate.name === name);
                      setRealtimeProvider(name);
                      setRealtimeModel(provider?.models?.large || "");
                      setRealtimeVoice(provider?.realtime_voice || "");
                    }}
                    className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
                  >
                    {realtimeProviders.map((provider) => (
                      <option key={provider.name} value={provider.name}>{provider.name.replace("-realtime", "").replace(/^./, (letter) => letter.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
              )}
              {realtimeModelOptions.length > 0 && (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-dim">Live model</label>
                  <select
                    value={realtimeModel}
                    onChange={(event) => setRealtimeModel(event.target.value)}
                    className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
                  >
                    {realtimeModelOptions.map((model) => (
                      <option key={model.id} value={model.id} disabled={!model.available}>
                        {model.name}{model.available ? "" : " · requires Core update"}
                      </option>
                    ))}
                  </select>
                  {realtimeCatalog?.models.some((model) => !model.available) && (
                    <p className="mt-1 text-[11px] text-text-muted">Gemini 3.8 Live will be selectable after the agent Core protocol update.</p>
                  )}
                </div>
              )}
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-dim">Voice</label>
                <select
                  value={selectedRealtimeVoice}
                  onChange={(event) => setRealtimeVoice(event.target.value)}
                  className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-xs text-text focus:border-accent focus:outline-none"
                >
                  {realtimeVoices.map((voice) => (
                    <option key={voice} value={voice}>{voice[0].toUpperCase() + voice.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Voice capabilities</div>
                <p className="mt-1 text-[11px] text-text-muted">Optional MCP servers available during calls. Main keeps its complete capability set.</p>
                {realtimeCapabilityOptions.length === 0 ? (
                  <p className="mt-2 text-[11px] text-text-dim">No optional capabilities are attached.</p>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {realtimeCapabilityOptions.map((server) => {
                      const selected = realtimeVoiceMCP.includes(server.name);
                      return (
                        <button
                          key={server.name}
                          type="button"
                          onClick={() => setRealtimeVoiceMCP((current) => selected
                            ? current.filter((name) => name !== server.name)
                            : [...current, server.name])}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[11px] ${selected ? "border-accent/60 bg-accent/10 text-text" : "border-border text-text-muted hover:text-text"}`}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${selected ? "border-accent bg-accent text-bg" : "border-border"}`}>{selected ? "✓" : ""}</span>
                          <span className="truncate">{capabilityDisplayName(server.name)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        )}

        {/* Directive */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-text-muted text-xs font-bold uppercase tracking-wide block">Directive</label>
            <button
              type="button"
              onClick={() => setDirective((cur) => structureDirectiveDraft(cur, instance.name))}
              className="text-accent text-xs hover:underline"
            >
              Structure
            </button>
          </div>
          <textarea
            value={directive}
            onChange={(e) => setDirective(e.target.value)}
            rows={7}
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent resize-none font-mono"
            placeholder={"# Role\nYou are...\n\n# Goals\n- ..."}
          />
          <p className="text-text-dim text-xs mt-1">
            Stable markdown sections help later edits target one part of the directive.
          </p>
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
