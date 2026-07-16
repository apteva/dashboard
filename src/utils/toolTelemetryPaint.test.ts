import { describe, expect, test } from "bun:test";
import type { TelemetryEvent } from "../api";
import { splitToolTelemetryPaintFrame } from "./toolTelemetryPaint";

function event(type: string, id: string, tool = "crm_search"): TelemetryEvent {
  return {
    id: `${type}:${id}`,
    instance_id: 1,
    thread_id: "main",
    type,
    time: "2026-07-16T10:00:00Z",
    data: type === "llm.tool_chunk" ? { id, tool, chunk: "{" } : { id, name: tool },
  };
}

describe("tool telemetry paint frames", () => {
  test("gives chunk, call, and result separate paints for one fast call", () => {
    let pending = [
      event("llm.tool_chunk", "a"),
      event("llm.tool_chunk", "a"),
      event("tool.call", "a"),
      event("tool.result", "a"),
    ];

    const first = splitToolTelemetryPaintFrame(pending);
    expect(first.paint.map((item) => item.type)).toEqual(["llm.tool_chunk", "llm.tool_chunk"]);
    expect(first.deferred.map((item) => item.type)).toEqual(["tool.call", "tool.result"]);

    const second = splitToolTelemetryPaintFrame(first.deferred);
    expect(second.paint.map((item) => item.type)).toEqual(["tool.call"]);
    expect(second.deferred.map((item) => item.type)).toEqual(["tool.result"]);

    const third = splitToolTelemetryPaintFrame(second.deferred);
    expect(third.paint.map((item) => item.type)).toEqual(["tool.result"]);
    expect(third.deferred).toEqual([]);
  });

  test("keeps independent parallel calls moving in the same frame", () => {
    const split = splitToolTelemetryPaintFrame([
      event("llm.tool_chunk", "a", "crm_search"),
      event("tool.call", "a", "crm_search"),
      event("tool.call", "b", "sheets_read"),
      event("tool.result", "b", "sheets_read"),
    ]);

    expect(split.paint.map((item) => `${item.data.id}:${item.type}`)).toEqual([
      "a:llm.tool_chunk",
      "b:tool.call",
    ]);
    expect(split.deferred.map((item) => `${item.data.id}:${item.type}`)).toEqual([
      "a:tool.call",
      "b:tool.result",
    ]);
  });

  test("does not delay non-tool telemetry", () => {
    const thought = event("llm.thinking", "thought");
    const split = splitToolTelemetryPaintFrame([thought, event("tool.call", "a"), event("tool.result", "a")]);
    expect(split.paint.map((item) => item.type)).toEqual(["llm.thinking", "tool.call"]);
    expect(split.deferred.map((item) => item.type)).toEqual(["tool.result"]);
  });
});
