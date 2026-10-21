import { afterEach, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RealtimeVoiceProvider, RealtimeVoiceDock, useRealtimeVoice } from "./RealtimeVoiceContext";
import { RealtimeAudioClient } from "../realtime/audio";
import type { TelemetryEvent } from "../api";

const originalFetch = globalThis.fetch;
const originalBus = window.__aptevaTelemetryBus;
const originalURL = window.location.href;
const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup(); (window as any).happyDOM.setURL(originalURL); globalThis.fetch = originalFetch; window.__aptevaTelemetryBus = originalBus;
  for (const restore of restorers.splice(0)) restore();
});
function Harness() {
  const voice = useRealtimeVoice();
  return <><button onClick={() => void voice.start({agentId:7,agentName:"Voice test",availability:{
    enabled:true,available:true,provider:"openai",model:"gpt-live-1",modelTier:"large",voice:"sillage",mcp:["bookings"],
    execution:{mode:"provider",provider:"openai",model:"medium"},
  }})}>Start test session</button><RealtimeVoiceDock /></>;
}

test("voice UI uses the existing API and telemetry bus for revisions, child tools and usage", async () => {
  (window as any).happyDOM.setURL("http://localhost:5280");
  const prepare = spyOn(RealtimeAudioClient.prototype,"prepare").mockResolvedValue();
  const connect = spyOn(RealtimeAudioClient.prototype,"connect").mockResolvedValue();
  const close = spyOn(RealtimeAudioClient.prototype,"close").mockImplementation(() => {});
  restorers.push(() => prepare.mockRestore(), () => connect.mockRestore(), () => close.mockRestore());
  let receive: ((event: TelemetryEvent) => void) | undefined;
  window.__aptevaTelemetryBus = { ...originalBus!, subscribe: (_id, callback) => {receive = callback; return () => {receive = undefined;};} };
  let spawn: any;
  let threadId = "";
  globalThis.fetch = (async (_input: any, options: any) => {
    if (String(_input).endsWith("/config")) return Response.json({
      providers:[{name:"openai",default:true,models:{large:"text-model"},realtime_models:{large:"gpt-live-1"},realtime_execution:{mode:"provider",provider:"openai",model:"medium"}}],
      realtime_providers:[{integration:"openai",provider:"openai",models:{large:"gpt-live-1"},capabilities:{"gpt-live-1":{core_execution:true,provider_execution:true}}}],
      realtime_enabled:true,realtime_voice:"sillage",realtime_voice_mcp:["bookings"],mcp_servers:[{name:"bookings"}],
    });
    if (options.method === "DELETE" || String(_input).endsWith("/event")) return Response.json({status:"ok"});
    spawn = JSON.parse(options.body);
    threadId = String(_input).split("/").pop()!;
    return Response.json({status:"created",id:threadId,audio_token:"one-use"});
  }) as typeof fetch;
  render(<RealtimeVoiceProvider><Harness /></RealtimeVoiceProvider>);
  fireEvent.click(screen.getByRole("button", {name:"Start test session"}));
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  expect(spawn.model).toBe("large");
  expect(spawn.provider).toBe("openai");
  expect(spawn.voice).toBe("sillage");
  expect(spawn.initial_message).toBeUndefined();
  expect(spawn.realtime_execution).toEqual({mode:"provider",provider:"openai",model:"medium"});
  expect(spawn.mcp).toEqual(["bookings"]);
  expect(String(connect.mock.calls[0][0])).toContain("/api/realtime/audio?");
  await waitFor(() => expect(receive).toBeDefined());
  let seq = 0;
  const emit = (type: string, data: Record<string,any>, thread = threadId) => {
    const event = {id:`ui-${++seq}`,instance_id:7,thread_id:thread,type,data,seq,time:new Date(1_000+seq*100).toISOString()};
    act(() => receive!(event)); return event;
  };
  emit("realtime.assistant",{text:"Bonjour",transcript:{id:"greeting",status:"partial"}});
  const revision = emit("realtime.assistant",{text:"Bonjour, comment puis-je aider ?",transcript:{id:"greeting",status:"application_grouped"}});
  act(() => receive!(revision));
  expect(screen.getAllByText("Bonjour, comment puis-je aider ?")).toHaveLength(1);
  expect(screen.queryByText("Bonjour")).toBeNull();
  emit("realtime.execution_started",{thread_id:"child"});
  emit("tool.call",{id:"lookup",reason:"Checking availability"},"child");
  expect(screen.getByText(/Checking availability/)).toBeTruthy();
  emit("tool.result",{id:"lookup"},"child");
  expect(screen.queryByText(/Checking availability/)).toBeNull();
  emit("realtime.usage",{session_seconds:4,cost:0.01,accounting:"delta"});
  emit("llm.done",{tokens_in:90,tokens_out:10,cost_usd:0.002},"child");
  fireEvent.click(screen.getByText("Voice test"));
  expect(screen.getByText(/Voice · 4.0s/)).toBeTruthy();
  expect(screen.getByText(/Backend · 100 tokens/)).toBeTruthy();
  expect(prepare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("End"));
  await waitFor(() => expect(screen.queryByText("Voice test")).toBeNull());
  await new Promise((resolve) => setTimeout(resolve,4100));
});
