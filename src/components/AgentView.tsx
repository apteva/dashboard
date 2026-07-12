import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import {
  apps as appsAPI,
  core,
  instances,
  mcpServers as mcpServersAPI,
  providers as providersAPI,
  telemetry,
  type Agent,
  type AppRow,
  type ExecutionControlStatus,
  type MCPServer,
  type MCPServerConfig,
  type ModelInfo,
  type PromptComposition,
  type Provider,
  type ProviderDetail,
  type Status,
  type TelemetryEvent,
  type Thread,
} from "../api";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";
import { sleepClassName, sleepLabel, sleepProgress, sleepTitle } from "../utils/sleepStatus";

export type EventListener = (event: TelemetryEvent) => void;
export type SubscribeFn = (listener: EventListener) => () => void;
import { ChatPanel } from "./ChatPanel";
import { ActivityPanel } from "./ActivityPanel";
import { MemoryPanel } from "./MemoryPanel";
import { UnconsciousPanel } from "./UnconsciousPanel";
import { InjectPanel } from "./InjectPanel";
import { ThreadDetailModal } from "./ThreadDetailModal";
import { AppPanels } from "./AppPanels";
import { Modal } from "./Modal";
import { LiveStatsBar } from "./LiveStatsBar";
import { SkillsPanel } from "./SkillsPanel";
import { EvalsPanel } from "./EvalsPanel";
import { structureDirectiveDraft } from "../utils/directiveMarkdown";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { AgentCurrentStatus, useCurrentStatuses } from "./dashboard/CurrentStatuses";
import {
  appendRuntimeThoughtText,
  cleanReasoningDisplay,
  type RuntimeThoughtText,
} from "../utils/runtimeThought";

type RuntimeView = "stream" | "activity" | "memory" | "skills" | "apps" | "evals";

interface RuntimeEventItem {
  key: string;
  kind: "thought" | "tool" | "thread" | "channel" | "error" | "event";
  label: string;
  detail?: string;
  reasoningDetail?: string;
  responseDetail?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  threadId?: string;
  status?: "running" | "success" | "error" | "info";
  durationMs?: number;
  time: string;
  raw: TelemetryEvent;
}

const MAX_RUNTIME_EVENTS = 250;
const HISTORICAL_RUNTIME_EVENT_LIMIT = 300;
const RUNTIME_THOUGHT_MERGE_WINDOW_MS = 5 * 60 * 1000;

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
  if (ev.type === "llm.done" || ev.type === "llm.error") {
    return `thought:${ev.thread_id || "main"}:${ev.id || ev.time || iteration}`;
  }
  return `thought:${ev.thread_id || "main"}:${iteration || ev.id || ev.time}`;
}

function toolArgsValue(data: Record<string, any>): unknown {
  if ("args" in data) return data.args;
  if ("arguments" in data) return data.arguments;
  if ("input" in data) return data.input;
  if ("params" in data) return data.params;
  return undefined;
}

function toolResultValue(data: Record<string, any>): unknown {
  if ("result" in data) return data.result;
  if ("output" in data) return data.output;
  if ("error" in data) return data.error;
  if ("message" in data) return data.message;
  return undefined;
}

function parseJSONIfPossible(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function sanitizeToolPayload(value: unknown, depth = 0): unknown {
  const parsed = parseJSONIfPossible(value);
  if (parsed == null) return parsed;
  if (typeof parsed === "string") {
    if (parsed.length > 400) return `${parsed.slice(0, 400)}… (${parsed.length.toLocaleString()} chars)`;
    return parsed;
  }
  if (typeof parsed !== "object") return parsed;
  if (depth > 5) return "[nested object]";
  if (Array.isArray(parsed)) {
    const items = parsed.slice(0, 20).map((item) => sanitizeToolPayload(item, depth + 1));
    return parsed.length > 20 ? [...items, `… ${parsed.length - 20} more items`] : items;
  }

  const obj = parsed as Record<string, unknown>;
  if (obj._binary === true) return "[binary payload]";
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("base64") ||
      lower.includes("screenshot") ||
      lower.includes("image") ||
      lower.includes("audio") ||
      lower.includes("blob")
    ) {
      if (typeof val === "string") {
        out[key] = `[${val.length.toLocaleString()} chars omitted]`;
      } else if (val && typeof val === "object") {
        out[key] = sanitizeToolPayload(val, depth + 1);
      } else {
        out[key] = val;
      }
      continue;
    }
    out[key] = sanitizeToolPayload(val, depth + 1);
  }
  return out;
}

function formatToolPayload(value: unknown, max = 5000): string {
  if (value === undefined) return "";
  let text: string;
  const sanitized = sanitizeToolPayload(value);
  if (typeof sanitized === "string") {
    text = sanitized;
  } else {
    try {
      text = JSON.stringify(sanitized, null, 2);
    } catch {
      text = String(sanitized);
    }
  }
  if (text.length > max) return `${text.slice(0, max)}\n… (${text.length.toLocaleString()} chars total)`;
  return text;
}

function payloadPreview(text?: string, max = 160): string {
  if (!text) return "";
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function normalizeRuntimeEvent(ev: TelemetryEvent): RuntimeEventItem | null {
  const data = ev.data || {};
  const threadId = ev.thread_id || "main";
  const base = {
    threadId,
    time: ev.time,
    raw: ev,
  };

  if (ev.type === "llm.tool_chunk") {
    const name = compactText(data.tool || data.name);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_send", "channels_status"].includes(name)) return null;
    return {
      ...base,
      key: toolEventKey(ev, name),
      kind: "tool",
      label: `Preparing ${name}`,
      detail: name,
      toolName: name,
      toolArgs: String(data.chunk || ""),
      status: "running",
    };
  }

  if (ev.type === "tool.call") {
    const name = compactText(data.name);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_send", "channels_status"].includes(name)) return null;
    const reason = compactText(data.reason, `Running ${name}`);
    const args = formatToolPayload(toolArgsValue(data));
    return {
      ...base,
      key: toolEventKey(ev, name),
      kind: "tool",
      label: reason,
      detail: name,
      toolName: name,
      toolArgs: args,
      status: "running",
    };
  }

  if (ev.type === "tool.result") {
    const name = compactText(data.name || data.tool);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_send", "channels_status"].includes(name)) return null;
    const failed = !!data.is_error;
    return {
      ...base,
      key: toolEventKey(ev, name),
      kind: "tool",
      label: compactText(data.reason, name),
      detail: failed ? compactText(data.error || data.message, "Tool failed") : name,
      toolName: name,
      toolResult: formatToolPayload(toolResultValue(data)),
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

  if (ev.type === "llm.thinking") {
    const text = String(data.text || data.chunk || "");
    if (!text.trim()) return null;
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "thought",
      label: "Reasoning",
      detail: text,
      reasoningDetail: text,
      status: "running",
    };
  }

  if (ev.type === "llm.chunk") {
    const text = String(data.text || data.chunk || "");
    if (!text.trim()) return null;
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "thought",
      label: "Response",
      detail: text,
      responseDetail: text,
      status: "running",
    };
  }

  if (ev.type === "llm.done") {
    const message = compactText(data.message || data.model);
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "thought",
      label: "Completed reasoning step",
      detail: message,
      responseDetail: message,
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
  let idx = prev.findIndex((r) => r.key === item.key);
  if (idx < 0 && item.kind === "tool" && item.toolName) {
    idx = findRecentRuntimeTool(prev, item);
  }
  if (idx < 0 && item.kind === "thought" && (ev.type === "llm.done" || ev.type === "llm.error")) {
    idx = findRecentRuntimeThought(prev, item);
  }
  if (idx >= 0) {
    const next = [...prev];
    const prevItem = next[idx];
    const args =
      ev.type === "llm.tool_chunk" && item.toolArgs
        ? `${prevItem.toolArgs || ""}${item.toolArgs}`
        : item.toolArgs || prevItem.toolArgs;
    let thoughtText: RuntimeThoughtText = {
      reasoning: prevItem.reasoningDetail || item.reasoningDetail,
      response: prevItem.responseDetail || item.responseDetail,
    };
    if (ev.type === "llm.thinking" && item.reasoningDetail) {
      thoughtText = appendRuntimeThoughtText(
        { reasoning: prevItem.reasoningDetail, response: prevItem.responseDetail },
        "reasoning",
        item.reasoningDetail,
      );
    }
    if (ev.type === "llm.chunk" && item.responseDetail) {
      thoughtText = appendRuntimeThoughtText(
        { reasoning: prevItem.reasoningDetail, response: prevItem.responseDetail },
        "response",
        item.responseDetail,
      );
    }
    const detail = thoughtText.response || thoughtText.reasoning || item.detail || prevItem.detail;
    next[idx] = {
      ...prevItem,
      ...item,
      label:
        item.kind === "tool" && item.status !== "running" && item.label === item.detail
          ? prevItem.label
          : item.label || prevItem.label,
      detail,
      reasoningDetail: thoughtText.reasoning,
      responseDetail: thoughtText.response,
      toolArgs: args,
      toolResult: item.toolResult || prevItem.toolResult,
    };
    return next;
  }
  return [...prev, item].slice(-MAX_RUNTIME_EVENTS);
}

function runtimeEventIteration(ev?: TelemetryEvent): string {
  const value = ev?.data?.iteration;
  return value == null ? "" : String(value);
}

function findRecentRuntimeThought(prev: RuntimeEventItem[], item: RuntimeEventItem): number {
  const itemIteration = runtimeEventIteration(item.raw);
  if (!itemIteration) return -1;
  const itemMs = telemetryTimeMs(item.raw);
  for (let i = prev.length - 1; i >= 0; i--) {
    const candidate = prev[i];
    if (candidate.kind !== "thought") continue;
    if (candidate.threadId !== item.threadId) continue;
    if (candidate.status !== "running") continue;
    if (runtimeEventIteration(candidate.raw) !== itemIteration) continue;
    const candidateMs = telemetryTimeMs(candidate.raw);
    if (itemMs && candidateMs && Math.abs(itemMs - candidateMs) > RUNTIME_THOUGHT_MERGE_WINDOW_MS) continue;
    return i;
  }
  return -1;
}

function findRecentRuntimeTool(prev: RuntimeEventItem[], item: RuntimeEventItem): number {
  for (let i = prev.length - 1; i >= 0; i--) {
    const candidate = prev[i];
    if (candidate.kind !== "tool") continue;
    if (candidate.threadId !== item.threadId) continue;
    if (candidate.toolName !== item.toolName && candidate.detail !== item.toolName) continue;
    if (candidate.status !== "running" && item.status === "running") continue;
    return i;
  }
  return -1;
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

// AgentView is the rich per-instance view: chat panel + runtime side panel,
// lifecycle controls (start/stop/pause/delete), thread detail
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
  const [showConfig, setShowConfig] = useState(false);
  const [view, setView] = useState<RuntimeView>("stream");
  const [mobilePane, setMobilePane] = useState<"chat" | "runtime">("runtime");
  // Whether the channels MCP is currently attached to this instance.
  // When the user detaches it via the MCP panel the chat bridge stops
  // receiving user messages — we gray out the chat column to make that
  // state obvious instead of silently dropping typed messages.
  const [channelsAttached, setChannelsAttached] = useState(true);

  // Track threads, tools, and active LLM calls for the runtime summary.
  const [graphThreads, setGraphThreads] = useState<Thread[]>(initialThreads);
  const [graphActiveTools, setGraphActiveTools] = useState<Record<string, string>>({});
  const [graphThinking, setGraphThinking] = useState<Record<string, boolean>>({});
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEventItem[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(true);

  // Thread detail modal
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadLiveEvents, setThreadLiveEvents] = useState<Record<string, TelemetryEvent[]>>({});

  // Reset all live state when the instance changes — critical because
  // react-router keeps the component mounted when navigating between
  // /instances/:id → /instances/:other, and stale threads from the previous
  // instance would otherwise leak into the runtime summary.
  useEffect(() => {
    setGraphThreads(initialThreads);
    setGraphActiveTools({});
    setGraphThinking({});
    setRuntimeEvents([]);
    setRuntimeLoading(true);
    setThreadLiveEvents({});
    seenHandledEventsRef.current = new Set();
    seenHandledOrderRef.current = [];
    seenLiveRef.current = new Set();
    seenLiveOrderRef.current = [];
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
      setGraphActiveTools({});
      setGraphThinking({});
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

    // Track active tools — keep visible for 3s after completion
    // Skip noisy inline tools (send, pace, done, evolve, remember) and channels from display
    const hiddenTools = new Set(["send", "pace", "done", "evolve", "remember", "channels_respond", "channels_send", "channels_status"]);
    const toolName = String(data.name || "");
    const showTool = event.thread_id && toolName && !hiddenTools.has(toolName) && !toolName.startsWith("channels_");

    if (event.type === "tool.call" && showTool) {
      setGraphActiveTools((prev) => ({ ...prev, [event.thread_id]: toolName }));
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

    if (event.type === "llm.done" && data.message) {
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
    ) : view === "memory" ? (
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
    ) : view === "evals" ? (
      <EvalsPanel agentID={instance.id} />
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
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <div className="lg:hidden shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 bg-bg">
          <button
            type="button"
            onClick={() => setMobilePane("chat")}
            className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
              mobilePane === "chat"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-muted hover:text-text"
            }`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("runtime")}
            className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
              mobilePane === "runtime"
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-text-muted hover:text-text"
            }`}
          >
            Runtime
          </button>
        </div>
        {/* Chat panel */}
        <div className={`${mobilePane === "chat" ? "flex" : "hidden"} lg:flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-border lg:w-1/3 lg:min-w-[320px]`}>
          {instance.status !== "running" ? (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              Agent is stopped. Start it to begin chatting.
            </div>
          ) : !channelsAttached ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-xs text-center text-xs text-text-dim bg-bg-card border border-border rounded-lg p-4">
                Chat is disabled because the <code className="text-text-muted">channels</code> MCP
                is not attached. Re-attach it from Capabilities → Manage to restore
                chat.
              </div>
            </div>
          ) : (
            <ChatPanel instanceId={instance.id} subscribe={subscribe} />
          )}
        </div>

        <div className={`${mobilePane === "runtime" ? "flex" : "hidden"} lg:flex flex-1 min-w-0 min-h-0`}>
          <AgentRuntimePanel
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

function AgentRuntimePanel({
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
  onReset: () => void;
  onDelete: () => void;
  advancedContent: ReactNode;
}) {
  const currentStatuses = useCurrentStatuses(instance.project_id || undefined);
  const currentStatus = useMemo(
    () => currentStatuses.find((status) => status.instance_id === instance.id),
    [currentStatuses, instance.id],
  );
  const [mcpServers, setMCPServers] = useState<MCPServerConfig[]>([]);
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [mcpInventory, setMCPInventory] = useState<MCPServer[]>([]);
  const [showCapabilitiesManage, setShowCapabilitiesManage] = useState(false);
  const [selectedRuntimeThread, setSelectedRuntimeThread] = useState("main");
  const [executionControl, setExecutionControl] = useState<ExecutionControlStatus>({
    mode: "auto",
    scope: "instance",
    follow: "active",
    waiting: false,
  });
  const [liveStatus, setLiveStatus] = useState<Status | null>(null);
  const [executionBusy, setExecutionBusy] = useState<"run" | "pause" | "step" | "back" | null>(null);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  useEffect(() => {
    setSelectedRuntimeThread("main");
    setLiveStatus(null);
  }, [instance.id]);

  const selectRuntimeThread = (threadId: string) => {
    setSelectedRuntimeThread(threadId);
    onViewChange("stream");
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
      appsAPI.list(instance.project_id)
        .then((rows) => {
          if (!cancelled) setInstalledApps(rows || []);
        })
        .catch(() => {});
      mcpServersAPI.list(instance.project_id)
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

  const views: RuntimeView[] = [
    "stream",
    "activity",
    "memory",
    "skills",
    "apps",
    "evals",
  ];

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-bg">
      <Modal
        open={showCapabilitiesManage}
        onClose={() => setShowCapabilitiesManage(false)}
        width="max-w-[920px]"
      >
        <div className="w-full max-h-[84vh] flex flex-col bg-bg-card">
          <div className="shrink-0 px-4 py-3 border-b border-border flex items-start justify-between gap-4">
            <div>
              <h2 className="text-text text-sm font-bold">Manage Capabilities</h2>
              <p className="text-text-dim text-xs mt-1">
                Choose which MCP capabilities this agent can use.
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
          />
        </div>
      </Modal>
      <Modal open={showMobileActions} onClose={() => setShowMobileActions(false)} width="max-w-md" ariaLabel="Agent actions">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-accent">Agent actions</div>
          <div className="mt-1 truncate text-base font-semibold text-text">{instance.name}</div>
        </div>
        <div className="page-safe-bottom grid gap-2 p-3">
          {instance.status === "running" ? (
            <>
              <button type="button" onClick={() => { setShowMobileActions(false); void onPause(); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text">Pause</button>
              <button type="button" onClick={() => { setShowMobileActions(false); void onStop(); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-red">Stop</button>
            </>
          ) : (
            <button type="button" onClick={() => { setShowMobileActions(false); void onStart(); }} className="touch-target rounded-lg border border-accent px-4 text-left text-sm font-semibold text-accent">Start</button>
          )}
          <button type="button" onClick={() => { setShowMobileActions(false); onConfig(); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text">Configuration</button>
          <button type="button" onClick={() => { setShowMobileActions(false); onReset(); }} className="touch-target rounded-lg border border-yellow/40 px-4 text-left text-sm text-yellow">Reset agent</button>
          <button type="button" onClick={() => { setShowMobileActions(false); onDelete(); }} className="touch-target rounded-lg border border-red/40 px-4 text-left text-sm text-red">Delete agent</button>
        </div>
      </Modal>
      <div className="border-b border-border px-3 py-3 sm:px-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${instance.status === "running" ? "bg-green" : instance.status === "paused" ? "bg-yellow" : "bg-red"}`} />
              <h1 className="text-text text-sm font-bold truncate">{instance.name}</h1>
              <span className="text-[10px] text-text-muted uppercase tracking-wide">{instance.status}</span>
              <SleepPill sleep={liveStatus || statusFallbackForInstance(instance.status)} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
              <span>{instance.mode}</span>
              <span>agent #{instance.id}</span>
              {instance.project_id && <span>project {instance.project_id}</span>}
            </div>
            <AgentCurrentStatus status={currentStatus} />
          </div>
          <button type="button" onClick={() => setShowMobileActions(true)} className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-lg text-text-muted md:hidden" aria-label="Agent actions">⋮</button>
          <div className="hidden items-center gap-1.5 shrink-0 md:flex">
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
        <LiveStatsBar instanceId={instance.id} subscribe={subscribe} sleep={liveStatus} />
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

      {isDesktop ? (
      <div className="shrink-0 grid grid-cols-2 divide-x divide-border border-b border-border">
        <ThreadSummary
          instanceId={instance.id}
          running={instance.status === "running"}
          threads={threads}
          activeTools={activeTools}
          thinking={thinking}
          selectedThreadId={selectedRuntimeThread}
          onThreadSelect={selectRuntimeThread}
          onThreadOpen={onThreadOpen}
        />
        <CapabilityShelf
          mcpServers={mcpServers}
          apps={installedApps}
          inventory={mcpInventory}
          instanceId={instance.id}
          onAttachedChange={setMCPServers}
          onManage={() => setShowCapabilitiesManage(true)}
        />
      </div>
      ) : (
        <div className="shrink-0 border-b border-border bg-bg-card">
          <details open className="border-b border-border group">
            <summary className="touch-target flex cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-text">
              Current work and threads <span className="text-text-dim group-open:rotate-90">›</span>
            </summary>
            <ThreadSummary
              instanceId={instance.id}
              running={instance.status === "running"}
              threads={threads}
              activeTools={activeTools}
              thinking={thinking}
              selectedThreadId={selectedRuntimeThread}
              onThreadSelect={selectRuntimeThread}
              onThreadOpen={onThreadOpen}
            />
          </details>
          <details className="group">
            <summary className="touch-target flex cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold text-text">
              Capabilities <span className="text-text-dim group-open:rotate-90">›</span>
            </summary>
            <CapabilityShelf
              mcpServers={mcpServers}
              apps={installedApps}
              inventory={mcpInventory}
              instanceId={instance.id}
              onAttachedChange={setMCPServers}
              onManage={() => setShowCapabilitiesManage(true)}
            />
          </details>
        </div>
      )}

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
        {view === "stream" ? (
          <RuntimeStream events={events} selectedThreadId={selectedRuntimeThread} loading={runtimeLoading} />
        ) : advancedContent}
      </div>
      {instance.status === "running" && (
        <InjectPanel instanceId={instance.id} threads={threads} />
      )}
    </section>
  );
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

function CapabilitiesManager({
  instanceId,
  projectId,
  attached,
  apps,
  inventory: inventoryProp,
  onAttachedChange,
  onInventoryChange,
}: {
  instanceId: number;
  projectId?: string;
  attached: MCPServerConfig[];
  apps: AppRow[];
  inventory: MCPServer[];
  onAttachedChange: (servers: MCPServerConfig[]) => void;
  onInventoryChange: (servers: MCPServer[]) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const writeAttached = async (next: MCPServerConfig[]) => {
    await core.setMCPServers(instanceId, next);
    onAttachedChange(next);
  };

  const attachInventory = async (row: MCPServer, aliases?: string[]) => {
    const entry = configFromInventory(row);
    if (!entry) return;
    setBusyKey(`mcp:${mcpName(row)}`);
    setError(null);
    try {
      const next = [
        ...removeAttachedByAliases(attached, [...(aliases || mcpCapabilityAliases(row)), entry.name]),
        entry,
      ];
      await writeAttached(next);
    } catch (err: any) {
      setError(err?.message || "Failed to enable capability");
    } finally {
      setBusyKey(null);
    }
  };

  const detachName = async (name: string, aliases?: string[]) => {
    setBusyKey(`mcp:${name}`);
    setError(null);
    try {
      await writeAttached(removeAttachedByAliases(attached, aliases ? [...aliases, name] : [name]));
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
    .filter((row) => row.source !== "app" && row.source !== "custom")
    .sort((a, b) => compareMCPRowsByAttachment(a, b, attachedKeys));
  const customRows = inventoryProp
    .filter((row) => row.source === "custom")
    .sort((a, b) => compareMCPRowsByAttachment(a, b, attachedKeys));
  const orphanAppRows = inventoryProp
    .filter((row) => row.source === "app" && !matchedAppInventoryIDs.has(row.id))
    .sort((a, b) => displayMCPName(a).localeCompare(displayMCPName(b)));
  const appAttachedCount = appRows.filter((app) => {
    const row = findAppInventoryRow(app, appInventoryByKey);
    return capabilityIsAttached(attachedKeys, appCapabilityAliases(app, row));
  }).length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
      {error && (
        <div className="rounded border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </div>
      )}
      <CapabilitySection
        title={`Apps — ${appAttachedCount}/${appRows.length} attached`}
        hint="Installed apps exposing MCP tools"
      >
        {appRows.length === 0 && orphanAppRows.length === 0 && (
          <EmptyCapabilityRow text="No running app MCP surfaces in this project." />
        )}
        {appRows.map((app) => {
          const row = findAppInventoryRow(app, appInventoryByKey);
          const aliases = appCapabilityAliases(app, row);
          const name = row ? mcpName(row) : app.name;
          const enabled = capabilityIsAttached(attachedKeys, aliases);
          return (
            <CapabilityToggleRow
              key={`app:${app.install_id}`}
              title={app.display_name || app.name}
              detail={app.description || `${app.surfaces?.mcp_tool_count || 0} MCP tools`}
              meta={`${app.surfaces?.mcp_tool_count || 0} tools`}
              enabled={enabled}
              disabled={!row}
              busy={busyKey === `mcp:${name}`}
              onToggle={() => row && (enabled ? detachName(name, aliases) : attachInventory(row, aliases))}
            />
          );
        })}
        {orphanAppRows.map((row) => {
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
              onToggle={() => enabled ? detachName(name) : attachInventory(row)}
            />
          );
        })}
      </CapabilitySection>

      <CapabilitySection
        title={`Integrations — ${integrationRows.filter((row) => mcpRowIsAttached(attachedKeys, row)).length}/${integrationRows.length} attached`}
        hint="OAuth and integration-backed MCP servers"
      >
        {integrationRows.length === 0 && (
          <EmptyCapabilityRow text="No integration MCP servers available." />
        )}
        {integrationRows.map((row) => {
          const name = mcpName(row);
          const aliases = mcpCapabilityAliases(row);
          const enabled = capabilityIsAttached(attachedKeys, aliases);
          return (
            <CapabilityToggleRow
              key={`integration:${row.id}`}
              title={displayMCPName(row)}
              detail={row.name}
              meta={`${row.tool_count || 0} tools · ${mcpName(row)} · ${scopeLabel(row)}`}
              enabled={enabled}
              disabled={!configFromInventory(row)}
              busy={busyKey === `mcp:${name}`}
              onToggle={() => enabled ? detachName(name, aliases) : attachInventory(row, aliases)}
            />
          );
        })}
      </CapabilitySection>

      <CapabilitySection
        title={`Custom MCP Servers — ${customRows.filter((row) => mcpRowIsAttached(attachedKeys, row)).length}/${customRows.length} attached`}
        hint="Manually registered servers"
      >
        {customRows.length === 0 && (
          <EmptyCapabilityRow text="No custom MCP servers available." />
        )}
        {customRows.map((row) => {
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
              onToggle={() => enabled ? detachName(name, aliases) : attachInventory(row, aliases)}
            />
          );
        })}
      </CapabilitySection>

      {loading && (
        <div className="text-center text-xs text-text-muted py-2">Loading capabilities…</div>
      )}
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
      <div className="overflow-hidden rounded border border-border bg-bg">
        {children}
      </div>
    </section>
  );
}

function CapabilityToggleRow({
  title,
  detail,
  meta,
  enabled,
  disabled,
  busy,
  onToggle,
}: {
  title: string;
  detail: string;
  meta: string;
  enabled: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  const canToggle = !disabled && !busy;
  return (
    <div
      className={`group relative flex items-center gap-3 border-b border-border-subtle last:border-b-0 px-3.5 py-3 text-left select-none transition-colors ${
        enabled
          ? "bg-accent/10 hover:bg-accent/15"
          : canToggle
            ? "bg-bg hover:bg-bg-card cursor-pointer"
            : "bg-bg opacity-50 cursor-not-allowed"
      }`}
      onClick={() => {
        if (canToggle) onToggle();
      }}
      role="checkbox"
      aria-checked={enabled}
      tabIndex={canToggle ? 0 : -1}
      onKeyDown={(e) => {
        if (!canToggle) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      title={enabled ? "Click to disable" : "Click to enable"}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-[2px] transition-colors ${
          enabled ? "bg-accent" : "bg-transparent"
        }`}
      />
      <span
        aria-hidden="true"
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          enabled
            ? "bg-accent border-accent text-bg"
            : "bg-bg border-border group-hover:border-text-dim"
        }`}
      >
        {enabled && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5 L7 12 L13 5" />
          </svg>
        )}
      </span>
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${enabled ? "bg-green" : "bg-text-dim"}`} />
      <div className="min-w-0 flex-1 pr-2">
        <div className={`text-sm leading-tight truncate ${enabled ? "text-text font-medium" : "text-text"}`}>
          {title}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-text-muted truncate" title={detail}>
          {detail}
        </div>
      </div>
      <div
        className={`mt-0.5 shrink-0 rounded px-2 py-1 text-[10px] leading-none whitespace-nowrap ${
          enabled ? "bg-accent/15 text-accent" : "bg-bg-input text-text-muted"
        }`}
      >
        {meta}
      </div>
    </div>
  );
}

function EmptyCapabilityRow({ text }: { text: string }) {
  return <div className="px-3 py-3 text-xs text-text-muted">{text}</div>;
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
      const next = enabled
        ? removeAttachedByAliases(mcpServers, aliases ? [...aliases, entry.name] : [entry.name])
        : [...removeAttachedByAliases(mcpServers, [...(aliases || mcpCapabilityAliases(row)), entry.name]), entry];
      await core.setMCPServers(instanceId, next);
      onAttachedChange(next);
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

function RuntimeStream({
  events,
  selectedThreadId,
  loading,
}: {
  events: RuntimeEventItem[];
  selectedThreadId: string;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<"all" | RuntimeEventItem["kind"]>("all");
  const [query, setQuery] = useState("");
  const visible = events
    .filter((e) => (e.threadId || "main") === selectedThreadId)
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
        <span className="hidden sm:inline-flex shrink-0 rounded bg-bg-hover px-2 py-1 text-[10px] text-text-muted">
          thread: <span className="ml-1 text-text">{selectedThreadId}</span>
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stream"
          className="ml-auto w-32 sm:w-44 bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-accent"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-dim text-sm">
            {loading ? "Loading runtime events..." : `No runtime events for ${selectedThreadId}.`}
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
  const reasoning = cleanReasoningDisplay(event.reasoningDetail || "");
  const response = event.responseDetail || "";

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
          {(response || reasoning || event.detail) && (
            <div className="text-[11px] text-text-dim truncate mt-0.5">{response || reasoning || event.detail}</div>
          )}
          {event.kind === "tool" && event.toolArgs && (
            <div className="text-[10px] text-text-muted truncate mt-0.5 font-mono">
              args: {payloadPreview(event.toolArgs)}
            </div>
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
        <div className="space-y-2">
          {event.kind === "tool" && event.toolArgs && (
            <RuntimePayloadBlock title="Arguments" text={event.toolArgs} />
          )}
          {event.kind === "tool" && event.toolResult && (
            <RuntimePayloadBlock title="Result" text={event.toolResult} />
          )}
          {event.kind === "thought" && reasoning && (
            <RuntimePayloadBlock title="Reasoning" text={reasoning} dim />
          )}
          {event.kind === "thought" && response && (
            <RuntimePayloadBlock title="Response" text={response} />
          )}
          <RuntimePayloadBlock title="Raw event" text={formatToolPayload(event.raw)} dim />
        </div>
      </div>
    </details>
  );
}

function RuntimePayloadBlock({ title, text, dim }: { title: string; text: string; dim?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wide text-text-dim">{title}</div>
      <pre className={`text-[10px] ${dim ? "text-text-muted" : "text-text"} bg-bg-input border border-border rounded p-2 overflow-auto max-h-56`}>
        {text}
      </pre>
    </div>
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
    providersAPI.models(selectedDetail.id)
      .then(async (m) => {
        const detail = await providersAPI.get(selectedDetail.id);
        setAvailableModels((prev) => ({ ...prev, [selectedDetail.id]: m }));
        setProviderDetails((prev) => ({ ...prev, [selectedDetail.id]: detail }));
      })
      .catch((err: any) => setError("Failed to fetch models: " + (err.message || "")))
      .finally(() => setLoadingModels(null));
  }, [selectedDetail?.id]);

  const handleRefreshModels = async () => {
    if (!selectedDetail) return;
    setLoadingModels(selectedDetail.id);
    try {
      const m = await providersAPI.models(selectedDetail.id, true);
      const detail = await providersAPI.get(selectedDetail.id);
      setAvailableModels((prev) => ({ ...prev, [selectedDetail.id]: m }));
      setProviderDetails((prev) => ({ ...prev, [selectedDetail.id]: detail }));
    } catch (err: any) {
      setError("Failed to fetch models: " + (err.message || ""));
    } finally { setLoadingModels(null); }
  };

  const models = selectedDetail ? availableModels[selectedDetail.id] : undefined;

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      // Save model selections through the narrow server route. OAuth-backed
      // providers keep their nested credentials and account state untouched.
      if (selectedDetail && selectedData) {
        if (
          modelLarge !== (selectedData.data.model_large || "") ||
          modelMedium !== (selectedData.data.model_medium || "") ||
          modelSmall !== (selectedData.data.model_small || "")
        ) {
          await providersAPI.updateModels(selectedDetail.id, {
            large: modelLarge,
            medium: modelMedium,
            small: modelSmall,
          });
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
