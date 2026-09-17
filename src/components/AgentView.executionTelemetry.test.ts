import { expect, test } from "bun:test";
import { mergeRuntimeEvent } from "./AgentView";
import type { TelemetryEvent } from "../api";

test("detailed execution telemetry leaves the existing work timeline unchanged", () => {
  const event = (type: string, data: Record<string, unknown> = {}): TelemetryEvent => ({
    id: type, instance_id: 1, thread_id: "main", type,
    time: "2026-09-13T12:00:00Z", data,
  });
  const legacy = [event("llm.start", { iteration: 1 }), event("llm.done", { iteration: 1, message: "Ready", tokens_in: 10, tokens_out: 2 }), event("tool.call", { id: "call_0", name: "probe" }), event("tool.result", { id: "call_0", name: "probe", success: true })];
  const expected = legacy.reduce(mergeRuntimeEvent, [] as ReturnType<typeof mergeRuntimeEvent>);
  const detailed = ["llm.request.queued", "llm.request.started", "llm.request.first_output", "llm.request.finished", "llm.http.started", "llm.http.headers", "llm.http.finished", "llm.retry.scheduled", "llm.retry.finished", "tool.execution.queued", "tool.execution.started", "tool.execution.finished", "worker.created", "worker.ready", "worker.first_inference", "worker.first_action", "worker.finished"];
  const actual = detailed.map(type => event(type, { request_id: "request-1", worker_run_id: "run-1", outcome: "failed" })).reduce(mergeRuntimeEvent, expected);
  expect(actual).toEqual(expected);
});
