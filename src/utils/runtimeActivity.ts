import { runtimeToolLabel } from "./runtimeToolLabel";
import type { TelemetryEvent } from "../api";
import { formatToolPayload } from "./runtimePayload";
import { appendRuntimeThoughtText, type RuntimeThoughtText } from "./runtimeThought";

export interface RuntimeEventItem {
  key: string;
  /** Stable display identity across streaming and completion records. */
  activityId?: string;
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
export const HISTORICAL_RUNTIME_EVENT_LIMIT = 300;
const RUNTIME_THOUGHT_MERGE_WINDOW_MS = 5 * 60 * 1000;

function compactText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s || fallback;
}

function runtimeToolCallID(ev: TelemetryEvent): string {
  return compactText(ev.data?.id || ev.data?.call_id || ev.data?.tool_call_id);
}

function toolEventKey(ev: TelemetryEvent, name: string): string {
  const id = runtimeToolCallID(ev);
  return `tool:${ev.thread_id || "main"}:${id || `${name}:${ev.id || ev.time}`}`;
}

// Keep the retained window chronological too: sorting only at render time
// would still let late history evict newer activity at the size limit.
function orderedRuntimeEvents(events: RuntimeEventItem[]): RuntimeEventItem[] {
  return [...events].sort((a, b) =>
    telemetryTimeMs(a.raw) - telemetryTimeMs(b.raw) || a.key.localeCompare(b.key),
  ).slice(-MAX_RUNTIME_EVENTS);
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

function normalizeRuntimeEvent(ev: TelemetryEvent): RuntimeEventItem | null {
  const data = ev.data || {};
  const threadId = ev.thread_id || "main";
  const base = {
    activityId: ev.id || `${ev.type}:${threadId}:${ev.time}`,
    threadId,
    time: ev.time,
    raw: ev,
  };

  if (ev.type === "llm.tool_chunk") {
    const name = compactText(data.tool || data.name);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_send", "channels_status", "channels_publish", "channels_set_status"].includes(name)) return null;
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
    if (["pace", "done", "channels_respond", "channels_send", "channels_status", "channels_publish", "channels_set_status"].includes(name)) return null;
    const reason = compactText(data.reason);
    const args = formatToolPayload(toolArgsValue(data));
    return {
      ...base,
      key: toolEventKey(ev, name),
      kind: "tool",
      label: runtimeToolLabel(name, reason, `Running ${name}`),
      detail: name,
      toolName: name,
      toolArgs: args,
      status: "running",
    };
  }

  if (ev.type === "tool.result") {
    const name = compactText(data.name || data.tool);
    if (!name) return null;
    if (["pace", "done", "channels_respond", "channels_send", "channels_status", "channels_publish", "channels_set_status"].includes(name)) return null;
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
    const message = String(data.message || "").trim();
    return {
      ...base,
      key: thoughtEventKey(ev),
      kind: "thought",
      label: "Completed reasoning step",
      detail: message || compactText(data.model),
      responseDetail: message || undefined,
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

  if (ev.type === "realtime.session_started") {
    return {
      ...base,
      key: ev.id || `realtime-start:${threadId}:${ev.time}`,
      kind: "thread",
      label: "Live voice connected",
      detail: [data.voice, data.model].filter(Boolean).join(" · "),
      status: "running",
    };
  }

  if (ev.type === "realtime.user" || ev.type === "realtime.assistant") {
    return {
      ...base,
      key: ev.id || `${ev.type}:${threadId}:${ev.time}`,
      kind: ev.type === "realtime.user" ? "channel" : "thought",
      label: ev.type === "realtime.user" ? "Operator said" : "Agent said",
      detail: compactText(data.text),
      responseDetail: ev.type === "realtime.assistant" ? compactText(data.text) : undefined,
      status: "info",
    };
  }

  if (ev.type === "realtime.bridge_connected" || ev.type === "realtime.bridge_disconnected") {
    return {
      ...base,
      key: ev.id || `${ev.type}:${threadId}:${ev.time}`,
      kind: "thread",
      label: ev.type === "realtime.bridge_connected" ? "Voice audio connected" : "Voice audio disconnected",
      status: ev.type === "realtime.bridge_connected" ? "success" : "info",
    };
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

export function mergeRuntimeEvent(prev: RuntimeEventItem[], ev: TelemetryEvent): RuntimeEventItem[] {
  // Live text is buffered upstream and can arrive after the stored completion.
  // Enrich that same activity without reopening it or duplicating its response.
  if (["llm.start", "llm.thinking", "llm.chunk"].includes(ev.type)) {
    const completedIndex = findCompletedRuntimeThought(prev, ev);
    if (completedIndex >= 0) {
      const text = String(ev.data?.text || ev.data?.chunk || "");
      if (ev.type === "llm.start" || !text) return prev;
      const completed = prev[completedIndex];
      // llm.done.message already contains the complete output when provided.
      if (ev.type === "llm.chunk" && completed.raw.data?.message) return prev;
      const content = appendRuntimeThoughtText(
        { reasoning: completed.reasoningDetail, response: completed.responseDetail },
        ev.type === "llm.thinking" ? "reasoning" : "response", text,
      );
      const next = [...prev];
      next[completedIndex] = { ...completed, reasoningDetail: content.reasoning, responseDetail: content.response,
        detail: content.response || content.reasoning || completed.detail };
      return next;
    }
  }
  const item = normalizeRuntimeEvent(ev);
  if (!item) return prev;
  let idx = prev.findIndex((r) => r.key === item.key);
  if (idx < 0 && item.kind === "tool" && item.toolName) {
    idx = findRecentRuntimeTool(prev, item);
  }
  if (idx < 0 && (ev.type === "llm.done" || ev.type === "llm.error")) {
    idx = findRecentRuntimeThought(prev, item);
  }
  if (idx >= 0) {
    const next = [...prev];
    const prevItem = next[idx];
    if (item.kind === "tool" && prevItem.status !== "running" && item.status === "running") {
      // Historical starts may add the reason/arguments, but cannot reopen a
      // finished call, replace its result timestamp, or replay streamed args.
      if (ev.type === "tool.call") {
        next[idx] = { ...prevItem, toolArgs: item.toolArgs || prevItem.toolArgs,
          label: item.label || prevItem.label };
      }
      return orderedRuntimeEvents(next);
    }
    const args =
      ev.type === "llm.tool_chunk" && item.toolArgs
        ? `${prevItem.toolArgs || ""}${item.toolArgs}`
        : item.toolArgs || prevItem.toolArgs;
    let thoughtText: RuntimeThoughtText = {
      reasoning: prevItem.reasoningDetail || item.reasoningDetail,
      response: ev.type === "llm.done" ? item.responseDetail || prevItem.responseDetail : prevItem.responseDetail || item.responseDetail,
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
    const detail = ev.type === "llm.error" ? item.detail : thoughtText.response || thoughtText.reasoning || item.detail || prevItem.detail;
    next[idx] = {
      ...prevItem,
      ...item,
      activityId: prevItem.activityId || prevItem.key,
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
    return orderedRuntimeEvents(next);
  }
  return orderedRuntimeEvents([...prev, item]);
}

function runtimeEventIteration(ev?: TelemetryEvent): string {
  const value = ev?.data?.iteration;
  return value == null ? "" : String(value);
}

function runtimeThoughtMergeWindow(ev: TelemetryEvent): number {
  // Long provider calls still belong to their original start event.
  const duration = Number(ev.data?.duration_ms) || 0;
  return Math.max(RUNTIME_THOUGHT_MERGE_WINDOW_MS, duration + 5_000);
}

function findCompletedRuntimeThought(prev: RuntimeEventItem[], ev: TelemetryEvent): number {
  const iteration = runtimeEventIteration(ev);
  const startedMs = telemetryTimeMs(ev);
  if (!iteration || !startedMs) return -1;
  return prev.findIndex((candidate) => {
    if (candidate.raw.type !== "llm.done" && candidate.raw.type !== "llm.error") return false;
    if (candidate.threadId !== (ev.thread_id || "main")) return false;
    if (runtimeEventIteration(candidate.raw) !== iteration) return false;
    const finishedMs = telemetryTimeMs(candidate.raw);
    return finishedMs >= startedMs && finishedMs - startedMs <= runtimeThoughtMergeWindow(candidate.raw);
  });
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
    if (itemMs && candidateMs && (candidateMs > itemMs || itemMs - candidateMs > runtimeThoughtMergeWindow(item.raw))) continue;
    return i;
  }
  return -1;
}

function findRecentRuntimeTool(prev: RuntimeEventItem[], item: RuntimeEventItem): number {
  const itemID = runtimeToolCallID(item.raw);
  const itemMs = telemetryTimeMs(item.raw);
  for (let i = prev.length - 1; i >= 0; i--) {
    const candidate = prev[i];
    if (candidate.kind !== "tool") continue;
    if (candidate.threadId !== item.threadId) continue;
    if (candidate.toolName !== item.toolName && candidate.detail !== item.toolName) continue;
    const candidateID = runtimeToolCallID(candidate.raw);
    // Explicit call identities must never be replaced by a same-name match.
    if (itemID && candidateID && itemID !== candidateID) continue;
    const candidateMs = telemetryTimeMs(candidate.raw);
    if (!itemMs || !candidateMs || Math.abs(itemMs - candidateMs) > RUNTIME_THOUGHT_MERGE_WINDOW_MS) continue;
    if (candidate.status !== "running") {
      // A late start can enrich an existing result, not a later new call.
      if (item.status !== "running" || itemMs > candidateMs) continue;
    } else if (item.status !== "running" && candidateMs > itemMs) {
      continue;
    }
    return i;
  }
  return -1;
}

export function telemetryTimeMs(ev: TelemetryEvent): number {
  const ms = Date.parse(ev.time || "");
  return Number.isFinite(ms) ? ms : 0;
}
