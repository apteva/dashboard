import { expect, test } from "bun:test";
import type { TelemetryEvent } from "../api";
import { threadTokenUsage } from "./threadTokenUsage";

function event(id: string, data: Record<string, number>, type = "llm.done"): TelemetryEvent {
  return { id, data, type, instance_id: 1, thread_id: "main", time: "2026-09-14T12:00:00Z" };
}

test("uses canonical cache counters without double counting execution events or duplicates", () => {
  const done = event("1", { tokens_in: 100, tokens_out: 20, tokens_cached: 60, cache_write_tokens: 10 });
  expect(threadTokenUsage([done, done, event("2", done.data, "execution.completed")])).toEqual({
    in: 100, out: 20, cache: 60, cacheWrite: 10, cacheReported: true,
  });
});

test("distinguishes zero cache hits from missing cache reporting", () => {
  expect(threadTokenUsage([event("1", { tokens_cached: 0 })]).cacheReported).toBe(true);
  expect(threadTokenUsage([event("1", { tokens_in: 10 })]).cacheReported).toBe(false);
});
