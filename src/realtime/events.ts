import type { TelemetryEvent } from "../api";

export interface TranscriptLine {
  id: string;
  role: "user" | "agent";
  text: string;
  time: string;
  seq?: number;
  updatedAt?: string;
  transcript?: Record<string, unknown>;
}
export function transcriptKey(event: TelemetryEvent): string {
  const id = event.data?.transcript?.id;
  return `${event.instance_id}:${event.thread_id}:${event.type}:${id || event.id || `${event.time}:${event.data?.text || ""}`}`;
}
export function newerRealtimeEvent(previous: Pick<TelemetryEvent, "seq" | "time">, incoming: Pick<TelemetryEvent, "seq" | "time">): boolean {
  if (previous.seq && incoming.seq) return incoming.seq > previous.seq;
  return Date.parse(incoming.time) >= Date.parse(previous.time);
}
export function upsertTranscript(lines: TranscriptLine[], event: TelemetryEvent): TranscriptLine[] {
  if (event.type !== "realtime.user" && event.type !== "realtime.assistant") return lines;
  const text = String(event.data?.text || "").trim();
  if (!text) return lines;
  const id = transcriptKey(event);
  const index = lines.findIndex((line) => line.id === id);
  const previous = lines[index];
  if (previous && !newerRealtimeEvent({seq: previous.seq, time: previous.updatedAt || previous.time}, event)) return lines;
  const line: TranscriptLine = { id, role: event.type === "realtime.user" ? "user" : "agent", text,
    time: previous?.time || event.time, updatedAt: event.time, seq: event.seq, transcript: event.data?.transcript };
  if (index < 0) return [...lines, line].slice(-100);
  const next = [...lines]; next[index] = line; return next;
}
export interface VoiceActivity {
  executionThreads: string[];
  activeTools: Record<string, string>;
  toolEvents: Record<string, {seq?: number; time: string; done: boolean}>;
  usage: { voiceSeconds: number; voiceCost: number; backendTokens: number; backendCost: number };
  seenUsage: string[];
}
export function emptyVoiceActivity(): VoiceActivity {
  return { executionThreads: [], activeTools: {}, toolEvents: {}, usage: { voiceSeconds: 0, voiceCost: 0, backendTokens: 0, backendCost: 0 }, seenUsage: [] };
}
const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
export function reduceVoiceActivity(state: VoiceActivity, parentThread: string, event: TelemetryEvent): VoiceActivity {
  const parent = event.thread_id === parentThread;
  if (parent && event.type === "realtime.execution_started") {
    const child = String(event.data?.thread_id || "");
    return !child || state.executionThreads.includes(child) ? state : { ...state, executionThreads: [...state.executionThreads, child].slice(-100) };
  }
  if (!parent && !state.executionThreads.includes(event.thread_id)) return state;
  if (event.type === "tool.call" || event.type === "tool.result") {
    const id = `${event.thread_id}:${event.data?.id || event.data?.call_id || event.data?.tool_call_id || event.data?.name || "tool"}`;
    const previous = state.toolEvents[id];
    if (previous && (!newerRealtimeEvent(previous, event) || previous.done && event.type === "tool.call")) return state;
    const activeTools = { ...state.activeTools };
    if (event.type === "tool.call") activeTools[id] = String(event.data?.reason || "Using a capability…");
    else delete activeTools[id];
    return { ...state, activeTools, toolEvents: { ...state.toolEvents, [id]: {seq: event.seq, time: event.time, done: event.type === "tool.result"} } };
  }
  if (parent && event.type === "realtime.execution_completed") {
    const child = String(event.data?.thread_id || "");
    return { ...state, activeTools: Object.fromEntries(Object.entries(state.activeTools).filter(([id]) => !id.startsWith(`${child}:`))) };
  }
  const voice = parent && event.type === "realtime.usage";
  const backend = !parent && event.type === "llm.done";
  if (!voice && !backend) return state;
  const identity = event.id || `${event.seq || ""}:${event.thread_id}:${event.type}:${event.time}`;
  if (state.seenUsage.includes(identity)) return state;
  const usage = { ...state.usage };
  const data = event.data || {};
  if (voice) {
    const seconds = nonnegative(data.session_seconds);
    const cost = nonnegative(data.cost ?? data.cost_usd);
    // Core emits increments per session interval or completed response.
    if (data.accounting !== "cumulative") { usage.voiceSeconds += seconds; usage.voiceCost += cost; }
    else { usage.voiceSeconds = Math.max(usage.voiceSeconds, seconds); usage.voiceCost = Math.max(usage.voiceCost, cost); }
  } else {
    usage.backendTokens += nonnegative(data.total_tokens ?? (nonnegative(data.tokens_in ?? data.input_tokens) + nonnegative(data.tokens_out ?? data.output_tokens)));
    usage.backendCost += nonnegative(data.cost_usd ?? data.cost);
  }
  return { ...state, usage, seenUsage: [...state.seenUsage, identity].slice(-1024) };
}
