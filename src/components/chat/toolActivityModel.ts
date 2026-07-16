import type { ChatMessageRow, TelemetryEvent } from "../../api";

export type ToolActivityState = "preparing" | "running" | "done";

export interface ToolActivity {
  /** Stable first-seen UI identity. Never replaced when the core later
   * supplies a provider call id. */
  id: string;
  /** Provider/core correlation id, when available. */
  callId?: string;
  threadId: string;
  name: string;
  reason: string;
  state: ToolActivityState;
  success?: boolean;
  durationMs?: number;
  startedAt: number;
  finishedAt?: number;
}

export const HIDDEN_CHAT_TOOLS = new Set([
  "pace",
  "done",
  "channels_respond",
  "channels_send",
  "channels_status",
  "channels_publish",
  "channels_set_status",
  "channels_request_approval",
]);

export const MAX_CHAT_TOOLS = 200;
export const TOOL_GROUP_IDLE_GAP_MS = 30_000;
export const MESSAGE_GROUP_GAP_MS = 5 * 60_000;
export const TIME_MARKER_GAP_MS = 15 * 60_000;

export function isChatConversationThread(threadId: string, chatId: string | null): boolean {
  const normalized = threadId || "main";
  if (normalized === "main") return true;
  if (!chatId) return false;
  return normalized === chatId || normalized === `chat-${chatId}`;
}

export function shouldHideChatTool(name: string, reason = ""): boolean {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName || HIDDEN_CHAT_TOOLS.has(normalizedName)) return true;
  if (normalizedName !== "send") return false;
  const normalizedReason = reason.trim().toLowerCase();
  if (!normalizedReason) return true;
  return (
    normalizedReason === "report completion" ||
    normalizedReason === "report back" ||
    normalizedReason === "report result" ||
    normalizedReason.includes("completion")
  );
}

function eventTime(event: TelemetryEvent): number {
  return Date.parse(event.time) || Date.now();
}

function eventToolName(event: TelemetryEvent): string {
  return String(event.data?.name || event.data?.tool || "").trim();
}

function explicitCallId(event: TelemetryEvent): string {
  const value =
    event.data?.id ??
    event.data?.call_id ??
    event.data?.tool_call_id ??
    event.data?.index;
  return value === undefined || value === null ? "" : String(value).trim();
}

function fallbackCallId(event: TelemetryEvent, name: string): string {
  return `fallback:${event.thread_id || "main"}:${name}:${event.id || event.time}`;
}

function matchingActivityKey(
  activities: ReadonlyMap<string, ToolActivity>,
  event: TelemetryEvent,
  name: string,
  states: ToolActivityState[],
): string | undefined {
  const threadId = event.thread_id || "main";
  return [...activities.entries()]
    .filter(([, tool]) => tool.threadId === threadId && tool.name === name && states.includes(tool.state))
    .sort((a, b) => a[1].startedAt - b[1].startedAt)[0]?.[0];
}

function explicitActivityKey(
  activities: ReadonlyMap<string, ToolActivity>,
  explicitId: string,
): string | undefined {
  if (!explicitId) return undefined;
  if (activities.has(explicitId)) return explicitId;
  return [...activities.entries()].find(([, tool]) => tool.callId === explicitId)?.[0];
}

function resultSucceeded(data: Record<string, unknown>): boolean {
  if (data.success === false || data.is_error === true) return false;
  const status = String(data.status || "").toLowerCase();
  if (status === "error" || status === "failed" || status === "failure") return false;
  return true;
}

function enforceToolCap(activities: Map<string, ToolActivity>): Map<string, ToolActivity> {
  if (activities.size <= MAX_CHAT_TOOLS) return activities;
  const completed = [...activities.values()]
    .filter((tool) => tool.state === "done")
    .sort((a, b) => (a.finishedAt || a.startedAt) - (b.finishedAt || b.startedAt));
  let remaining = activities.size - MAX_CHAT_TOOLS;
  for (const tool of completed) {
    if (remaining <= 0) break;
    activities.delete(tool.id);
    remaining -= 1;
  }
  return activities;
}

export function reduceToolActivity(
  previous: ReadonlyMap<string, ToolActivity>,
  event: TelemetryEvent,
): Map<string, ToolActivity> {
  if (event.type !== "llm.tool_chunk" && event.type !== "tool.call" && event.type !== "tool.result") {
    return previous instanceof Map ? previous : new Map(previous);
  }

  const name = eventToolName(event);
  const reason = String(event.data?.reason || "").trim();
  const explicitId = explicitCallId(event);
  const time = eventTime(event);
  const threadId = event.thread_id || "main";

  if (event.type === "llm.tool_chunk") {
    if (shouldHideChatTool(name)) return previous instanceof Map ? previous : new Map(previous);
    const existingKey = explicitActivityKey(previous, explicitId) || matchingActivityKey(previous, event, name, ["preparing"]);
    const id = existingKey || explicitId || fallbackCallId(event, name);
    if (previous.has(id)) return previous instanceof Map ? previous : new Map(previous);
    const next = new Map(previous);
    next.set(id, { id, callId: explicitId || undefined, threadId, name, reason: "", state: "preparing", startedAt: time });
    return enforceToolCap(next);
  }

  if (event.type === "tool.call") {
    const matchedKey = explicitActivityKey(previous, explicitId)
      || matchingActivityKey(previous, event, name, ["preparing"]);
    if (shouldHideChatTool(name, reason)) {
      if (!matchedKey) return previous instanceof Map ? previous : new Map(previous);
      const next = new Map(previous);
      next.delete(matchedKey);
      return next;
    }
    const existing = matchedKey ? previous.get(matchedKey) : undefined;
    const id = matchedKey || explicitId || fallbackCallId(event, name);
    const next = new Map(previous);
    next.set(id, {
      id,
      callId: explicitId || existing?.callId,
      threadId: existing?.threadId || threadId,
      name,
      reason: reason || existing?.reason || "",
      state: existing?.state === "done" ? "done" : "running",
      success: existing?.success,
      durationMs: existing?.durationMs,
      startedAt: existing?.startedAt ?? time,
      finishedAt: existing?.finishedAt,
    });
    return enforceToolCap(next);
  }

  if (!name || HIDDEN_CHAT_TOOLS.has(name.toLowerCase())) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  const matchedKey = explicitActivityKey(previous, explicitId)
    || matchingActivityKey(previous, event, name, ["running", "preparing"]);
  if (name.toLowerCase() === "send" && !matchedKey) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  const existing = matchedKey ? previous.get(matchedKey) : undefined;
  const id = matchedKey || explicitId || fallbackCallId(event, name);
  const next = new Map(previous);
  const rawDuration = event.data?.duration_ms;
  next.set(id, {
    id,
    callId: explicitId || existing?.callId,
    threadId: existing?.threadId || threadId,
    name,
    reason: existing?.reason || reason,
    state: "done",
    success: resultSucceeded(event.data || {}),
    durationMs: typeof rawDuration === "number" ? rawDuration : existing?.durationMs,
    startedAt: existing?.startedAt ?? time,
    finishedAt: time,
  });
  return enforceToolCap(next);
}

export function mergeToolActivityEvents(
  previous: ReadonlyMap<string, ToolActivity>,
  events: TelemetryEvent[],
): Map<string, ToolActivity> {
  return [...events]
    .sort((a, b) => eventTime(a) - eventTime(b))
    .reduce<Map<string, ToolActivity>>(
      (activities, event) => reduceToolActivity(activities, event),
      new Map(previous),
    );
}

export type ChatTimelineItem =
  | { kind: "message"; key: string; ts: number; endTs: number; message: ChatMessageRow; compactBefore: boolean }
  | { kind: "tool"; key: string; ts: number; endTs: number; tool: ToolActivity }
  | { kind: "toolGroup"; key: string; ts: number; endTs: number; tools: ToolActivity[]; parallel: boolean }
  | { kind: "day"; key: string; ts: number }
  | { kind: "time"; key: string; ts: number };

type ContentTimelineItem = Exclude<ChatTimelineItem, { kind: "day" | "time" }>;

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function toolsOverlap(tools: ToolActivity[]): boolean {
  if (tools.length < 2) return false;
  const sorted = [...tools].sort((a, b) => a.startedAt - b.startedAt);
  let latestFinish = sorted[0]!.finishedAt ?? Number.POSITIVE_INFINITY;
  for (let index = 1; index < sorted.length; index += 1) {
    const tool = sorted[index]!;
    if (tool.startedAt <= latestFinish) return true;
    latestFinish = Math.max(latestFinish, tool.finishedAt ?? Number.POSITIVE_INFINITY);
  }
  return false;
}

export function buildChatTimeline(
  messages: ChatMessageRow[],
  tools: Iterable<ToolActivity>,
  now = Date.now(),
): ChatTimelineItem[] {
  type RawItem =
    | { kind: "message"; ts: number; message: ChatMessageRow }
    | { kind: "tool"; ts: number; tool: ToolActivity };
  const raw: RawItem[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      ts: Date.parse(message.created_at) || 0,
      message,
    })),
    ...[...tools].map((tool) => ({ kind: "tool" as const, ts: tool.startedAt, tool })),
  ];
  raw.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.kind !== b.kind) return a.kind === "message" ? -1 : 1;
    if (a.kind === "message" && b.kind === "message") return a.message.id - b.message.id;
    if (a.kind === "tool" && b.kind === "tool") return a.tool.id.localeCompare(b.tool.id);
    return 0;
  });

  const content: ContentTimelineItem[] = [];
  let pendingTools: ToolActivity[] = [];
  const flushTools = () => {
    if (pendingTools.length === 0) return;
    const first = pendingTools[0]!;
    content.push({
      kind: "toolGroup",
      key: `tool-group:${first.id}:${first.startedAt}`,
      ts: first.startedAt,
      endTs: Math.max(...pendingTools.map((tool) => tool.finishedAt || tool.startedAt)),
      tools: pendingTools,
      parallel: toolsOverlap(pendingTools),
    });
    pendingTools = [];
  };

  for (const item of raw) {
    if (item.kind === "message") {
      flushTools();
      const previous = content[content.length - 1];
      const compactBefore =
        previous?.kind === "message" &&
        previous.message.role === item.message.role &&
        item.ts - previous.ts <= MESSAGE_GROUP_GAP_MS &&
        !previous.message.components?.length &&
        !item.message.components?.length;
      content.push({
        kind: "message",
        key: `message:${item.message.id}`,
        ts: item.ts,
        endTs: item.ts,
        message: item.message,
        compactBefore,
      });
      continue;
    }
    const previousTool = pendingTools[pendingTools.length - 1];
    if (previousTool && item.tool.startedAt - previousTool.startedAt > TOOL_GROUP_IDLE_GAP_MS) {
      flushTools();
    }
    pendingTools.push(item.tool);
  }
  flushTools();

  if (content.length === 0) return [];
  const dayKeys = new Set(content.map((item) => localDayKey(item.ts)));
  const showDayMarkers = dayKeys.size > 1 || !dayKeys.has(localDayKey(now));
  const timeline: ChatTimelineItem[] = [];
  let previousContent: ContentTimelineItem | undefined;
  for (const item of content) {
    const dayChanged = !previousContent || localDayKey(previousContent.ts) !== localDayKey(item.ts);
    if (dayChanged && showDayMarkers) {
      timeline.push({ kind: "day", key: `day:${localDayKey(item.ts)}`, ts: item.ts });
    } else if (previousContent && item.ts - previousContent.endTs >= TIME_MARKER_GAP_MS) {
      timeline.push({ kind: "time", key: `time:${item.key}`, ts: item.ts });
    }
    timeline.push(item);
    previousContent = item;
  }
  return timeline;
}
