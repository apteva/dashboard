import { describe, expect, test } from "bun:test";
import { mergeRuntimeEvent } from "./AgentView";
import type { TelemetryEvent } from "../api";

const event = (type: string, iteration: number, time: string, data: Record<string, unknown> = {}, thread_id = "main"): TelemetryEvent => ({
  id: `${thread_id}:${type}:${time}`, instance_id: 1103, thread_id, type, time,
  data: { iteration, model: "gpt-5.6-terra", ...data },
});
// Actual start/completion timestamps for agent 1103's two idle decisions.
const calls = [
  event("llm.start", 1, "2026-09-10T07:20:51.829044Z"),
  event("llm.done", 1, "2026-09-10T07:20:55.264264Z", { duration_ms: 3392, message: "There are no active requests or due responsibilities, so I’ll wait for an event." }),
  event("llm.start", 2, "2026-09-10T07:52:49.215474Z"),
  event("llm.done", 2, "2026-09-10T07:52:52.244033Z", { duration_ms: 3008, message: "No assigned work or scheduled responsibility is due, so I’ll remain available for requests." }),
];
const merge = (events: TelemetryEvent[]) => events.reduce(mergeRuntimeEvent, [] as ReturnType<typeof mergeRuntimeEvent>);

describe("runtime thought lifecycle", () => {
  test("overlapping initial history and live recovery leave two completed rows", () => {
    const initial = merge(calls);
    const replayed = calls.reduce(mergeRuntimeEvent, initial);
    expect(replayed).toHaveLength(2);
    expect(replayed.map(row => row.status)).toEqual(["success", "success"]);
    expect(replayed.map(row => row.label)).toEqual(["Completed reasoning step", "Completed reasoning step"]);
    expect(replayed.map(row => row.responseDetail)).toEqual([calls[1]!.data.message, calls[3]!.data.message]);
  });

  test("completion received before historical start never reopens the call", () => {
    const rows = merge([calls[1]!, calls[0]!, calls[1]!, calls[0]!]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("success");
  });

  test("delayed chunks cannot turn a completed call into an ongoing response", () => {
    const rows = merge([calls[0]!, calls[1]!,
      event("llm.chunk", 1, "2026-09-10T07:20:53Z", { text: "There are no" }),
      event("llm.thinking", 1, "2026-09-10T07:20:52Z", { text: "Checking work" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("success");
    expect(rows[0]!.responseDetail).toBe(calls[1]!.data.message);
  });

  test("normal streaming retains reasoning and the complete final response", () => {
    const rows = merge([calls[0]!,
      event("llm.thinking", 1, "2026-09-10T07:20:52Z", { text: "Checking work" }),
      event("llm.chunk", 1, "2026-09-10T07:20:53Z", { text: "There are no" }), calls[1]!,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reasoningDetail).toBe("Checking work");
    expect(rows[0]!.responseDetail).toBe(calls[1]!.data.message);
    expect(rows[0]!.status).toBe("success");
  });

  test("an error closes its thinking row and cannot be reopened by history", () => {
    const failed = event("llm.error", 1, "2026-09-10T07:20:55Z", { error: "Provider unavailable" });
    const rows = merge([calls[0]!, failed, calls[0]!, failed]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("error");
    expect(rows[0]!.status).toBe("error");
    expect(rows[0]!.detail).toBe("Provider unavailable");
  });

  test("a real subsequent call stays visibly running, including reused iterations", () => {
    const newStart = event("llm.start", 1, "2026-09-10T07:21:00Z");
    const rows = merge([calls[0]!, calls[1]!, newStart]);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.status)).toEqual(["success", "running"]);
    // An old completion replay must not close the newer request.
    expect(mergeRuntimeEvent(rows, calls[1]!)[1]!.status).toBe("running");
  });

  test("one thread's completion cannot close another thread's thinking", () => {
    const rows = merge([calls[0]!, calls[1]!, event("llm.start", 1, calls[0]!.time, {}, "worker")]);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.threadId === "worker")!.status).toBe("running");
  });

  test("long completed requests do not leave an orphaned thinking row", () => {
    const start = event("llm.start", 8, "2026-09-10T08:00:00Z");
    const done = event("llm.done", 8, "2026-09-10T08:10:00Z", { duration_ms: 600000, message: "Done" });
    const rows = merge([start, done, start, done]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("success");
  });
});
