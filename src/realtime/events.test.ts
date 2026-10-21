import { describe, expect, test } from "bun:test";
import { emptyVoiceActivity, reduceVoiceActivity, upsertTranscript } from "./events";
import { mergeRuntimeEvent } from "../utils/runtimeActivity";
import { realtimeSelection, realtimeProviders } from "./config";
import type { TelemetryEvent } from "../api";

function event(type: string, data: Record<string, any>, seq: number, thread_id = "voice"): TelemetryEvent {
  return { id: `event-${seq}`, instance_id: 1, thread_id, type, time: new Date(1_000 + seq * 100).toISOString(), seq, data };
}
describe("realtime transcript revisions", () => {
  test("dock and activity replace a stable transcript and reject stale replay", () => {
    const first = event("realtime.assistant", { text: "Hello", transcript: { id: "turn-1", status: "partial" } }, 1);
    const final = event("realtime.assistant", { text: "Hello there", transcript: { id: "turn-1", status: "interrupted", finalization_reason: "application_grouped" } }, 3);
    let lines = upsertTranscript([], first);
    lines = upsertTranscript(lines, final);
    lines = upsertTranscript(lines, first);
    lines = upsertTranscript(lines, final);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Hello there");
    expect(lines[0].transcript?.status).toBe("interrupted");
    let rows = mergeRuntimeEvent([], first);
    rows = mergeRuntimeEvent(rows, final);
    rows = mergeRuntimeEvent(rows, first);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toBe("Hello there");
    expect(rows[0].raw.data?.transcript.finalization_reason).toBe("application_grouped");
    expect(upsertTranscript(lines, { ...first, thread_id: "other" })).toHaveLength(2);
  });
  test("legacy transcripts remain distinct", () => {
    const first = event("realtime.user", {text:"Hi"},1);
    expect(upsertTranscript(upsertTranscript([],first),event("realtime.user",{text:"Hi"},2))).toHaveLength(2);
  });
});
describe("voice execution activity", () => {
  test("child tools retain their thread, parallel calls and usage are independent", () => {
    let state = emptyVoiceActivity();
    const apply = (e: TelemetryEvent) => { state = reduceVoiceActivity(state,"voice",e); };
    apply(event("tool.call",{id:"unrelated"},1,"unrelated"));
    expect(state.activeTools).toEqual({});
    const started = event("realtime.execution_started",{thread_id:"child"},2);
    apply(started);
    const tool = event("tool.call",{id:"a",name:"lookup",reason:"Checking"},3,"child");
    apply(tool); apply(event("tool.call",{id:"b"},4,"child"));
    apply(event("tool.result",{id:"a"},5,"child"));
    apply(tool);
    expect(Object.keys(state.activeTools)).toEqual(["child:b"]);
    apply(event("realtime.execution_completed",{thread_id:"child"},6));
    expect(state.activeTools).toEqual({});
    const usage = event("realtime.usage",{session_seconds:2,cost:0.01,accounting:"delta"},7);
    apply(usage); apply(usage); apply(event("realtime.usage",{session_seconds:3,cost:0.02,accounting:"delta"},8));
    const backend = event("llm.done",{tokens_in:100,tokens_out:20,cost_usd:0.005},9,"child");
    apply(backend); apply(backend);
    expect(state.usage).toEqual({voiceSeconds:5,voiceCost:0.03,backendTokens:120,backendCost:0.005});
    const rows = mergeRuntimeEvent(mergeRuntimeEvent([],started),tool);
    expect(rows.find((row) => row.kind === "tool")?.voiceThreadId).toBe("voice");
    expect(rows.find((row) => row.kind === "tool")?.threadId).toBe("child");
  });
});
describe("voice discovery", () => {
  test("metadata supports a provider without a suffix and separate text models", () => {
    const config = {
      providers:[{name:"openai",default:true,models:{large:"text-model"},realtime_models:{large:"voice-model"},realtime_execution:{mode:"provider" as const}}],
      realtime_providers:[{integration:"openai",provider:"openai",models:{large:"voice-model"},capabilities:{"voice-model":{provider_execution:true}}}],
    };
    const selected = realtimeSelection(config);
    expect(selected.model).toBe("voice-model");
    expect(selected.modelTier).toBe("large");
    expect(selected.provider?.name).toBe("openai");
    expect(selected.execution?.mode).toBe("provider");
    expect(realtimeProviders({...config,realtime_providers:[]})).toEqual([]);
  });
  test("only old Core uses the suffix adapter; shared selection resolves to its adapter", () => {
    const legacy = {providers:[{name:"openai-realtime",models:{large:"old"}}]};
    expect(realtimeSelection(legacy).model).toBe("old");
    const config = {...legacy,realtime_provider:"openai",realtime_model:"live",realtime_providers:[{integration:"openai",provider:"openai-realtime",models:{large:"live"}}]};
    expect(realtimeSelection(config).provider?.name).toBe("openai-realtime");
    expect(realtimeSelection(config).model).toBe("live");
  });
});
