import { describe, expect, test } from "bun:test";
import { mergeRuntimeEvent } from "./AgentView";
import type { TelemetryEvent } from "../api";
import recorded from "./__fixtures__/agent-1103-runtime-order.json";

const merge = (events: TelemetryEvent[]) => events.reduce(mergeRuntimeEvent, [] as ReturnType<typeof mergeRuntimeEvent>);
const event = (type: string, seconds: number, data: Record<string, unknown> = {}, thread = "main"): TelemetryEvent => ({
  id: `${type}:${thread}:${seconds}`, instance_id: 1103, thread_id: thread, type,
  time: new Date(Date.UTC(2026, 8, 10, 8, 0, seconds)).toISOString(), data,
});
const signature = (rows: ReturnType<typeof merge>) => rows.map(({ key, time, status }) => ({ key, time, status }));

describe("runtime timeline ordering", () => {
  test("agent 1103 history and live replay converge regardless of arrival order", () => {
    const chronological = (recorded as TelemetryEvent[]).slice().reverse();
    const expected = signature(merge(chronological));
    for (const seed of [chronological.slice(-8), chronological.filter(e => e.type === "llm.done"), chronological.slice().reverse()]) {
      const rows = chronological.reduce(mergeRuntimeEvent, merge(seed));
      expect(signature(rows)).toEqual(expected);
      expect(rows.at(-1)!.time).toBe("2026-09-10T08:41:58.861774Z");
      expect(rows.filter(r => r.kind === "tool" && r.status === "running")).toHaveLength(0);
    }
  });

  test("completing a row moves it to its displayed completion timestamp", () => {
    const rows = merge([
      event("tool.call", 10, { id: "a", name: "work" }),
      event("thread.message", 11, { message: "Progress" }),
      event("tool.result", 12, { id: "a", name: "work" }),
    ]);
    expect(rows.map(r => r.time)).toEqual([event("", 11).time, event("", 12).time]);
  });

  test("late history cannot evict newer entries at the timeline limit", () => {
    const latest = merge(Array.from({ length: 250 }, (_, i) => event("thread.message", 300 + i, { message: `New ${i}` })));
    const historical = Array.from({ length: 300 }, (_, i) => event("thread.message", i, { message: `Old ${i}` }));
    expect(signature(historical.reduce(mergeRuntimeEvent, latest))).toEqual(signature(latest));
  });

  test("equal timestamps have stable order across reloads", () => {
    const first = event("thread.message", 5, { message: "A" }, "a");
    const second = event("thread.message", 5, { message: "B" }, "b");
    expect(signature(merge([first, second]))).toEqual(signature(merge([second, first])));
  });

  test("separate tool call IDs and threads stay independent", () => {
    const rows = merge([
      event("tool.call", 1, { id: "first", name: "tasks_get" }),
      event("tool.call", 2, { id: "second", name: "tasks_get" }),
      event("tool.result", 3, { id: "second", name: "tasks_get" }),
      event("tool.result", 4, { id: "first", name: "tasks_get" }),
      event("tool.result", 5, { id: "first", name: "tasks_get" }, "worker"),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => [r.threadId, r.raw.data.id])).toEqual([["main", "second"], ["main", "first"], ["worker", "first"]]);
  });

  test("a historical tool start adds arguments without reopening or backdating its result", () => {
    const done = event("tool.result", 4, { tool_call_id: "first", name: "tasks_get", result: "Found", duration_ms: 7 });
    const start = event("tool.call", 2, { call_id: "first", name: "tasks_get", reason: "Retrieving assigned task", args: { task: "assigned" } });
    const rows = merge([done, start]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.time).toBe(done.time);
    expect(rows[0]!.status).toBe("success");
    expect(rows[0]!.label).toContain("Retrieving assigned task");
    expect(rows[0]!.toolArgs).toContain("assigned");
    expect(rows[0]!.toolResult).toBe("Found");
  });

  test("legacy streaming chunks without IDs still join the corresponding call", () => {
    const rows = merge([
      event("llm.tool_chunk", 1, { tool: "tasks_get", chunk: "{" }),
      event("tool.call", 2, { id: "first", name: "tasks_get", args: {} }),
      event("tool.result", 3, { id: "first", name: "tasks_get", result: "Found" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("success");
    expect(rows[0]!.toolResult).toBe("Found");
  });
});
