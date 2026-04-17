import { useState, useEffect, useRef, useCallback } from "react";
import { instances, core, providers as providersAPI, type Instance, type Thread, type TelemetryEvent, type Provider, type ProviderDetail, type ModelInfo } from "../api";

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
  const [showConfig, setShowConfig] = useState(false);
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
            onClick={() => setShowConfig(true)}
            className="px-2.5 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-accent hover:border-accent transition-colors"
            title="Instance settings"
          >
            Config
          </button>
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

      {/* Config modal */}
      <ConfigModal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        instance={instance}
        onSaved={onReload}
      />

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

// --- Config Modal ---

function ConfigModal({ open, onClose, instance, onSaved }: {
  open: boolean;
  onClose: () => void;
  instance: Instance;
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

  const provKey = (p: Provider) => p.type === "llm" ? p.name.toLowerCase() : p.type.toLowerCase();

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

  const modelSelect = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex items-center gap-2">
      <span className="text-text-muted text-xs w-16 shrink-0">{label}</span>
      {models ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-text font-mono focus:outline-none focus:border-accent"
        >
          <option value="">— not set —</option>
          {models.map((m) => (
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
        <h3 className="text-text text-base font-bold">Instance Config</h3>

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
