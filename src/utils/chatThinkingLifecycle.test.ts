import { describe, expect, test } from "bun:test";
import {
  clearThinkingForIteration,
  clearThinkingThroughGeneration,
  telemetryIteration,
  toolEventReplacesThinking,
  type ChatThinkingPlaceholder,
} from "./chatThinkingLifecycle";

function placeholder(generation: number, iteration: number): ChatThinkingPlaceholder {
  return {
    since: Date.parse("2026-07-16T10:00:00Z"),
    threadId: "main",
    generation,
    iteration,
  };
}

describe("chat Thinking lifecycle", () => {
  test("a delayed tool paint cannot clear the follow-up reasoning pass", () => {
    const toolSelectingPass = placeholder(1, 20);
    const replacementGeneration = toolSelectingPass.generation;

    // The tool result wakes core and llm.start for the answer pass can reach
    // React before the queued tool-result animation frame is painted.
    const answerPass = placeholder(2, 21);

    expect(clearThinkingThroughGeneration(answerPass, replacementGeneration)).toEqual(answerPass);
  });

  test("tool activity still replaces Thinking for its own reasoning pass", () => {
    expect(clearThinkingThroughGeneration(placeholder(3, 22), 3)).toBeNull();
  });

  test("a late llm.done cannot clear a newer iteration", () => {
    const answerPass = placeholder(4, 24);
    expect(clearThinkingForIteration(answerPass, 23)).toEqual(answerPass);
    expect(clearThinkingForIteration(answerPass, 24)).toBeNull();
  });

  test("reads numeric telemetry iterations without inventing zero", () => {
    expect(telemetryIteration({ iteration: 25 })).toBe(25);
    expect(telemetryIteration({ iteration: "26" })).toBe(26);
    expect(telemetryIteration({})).toBeNull();
  });

  test("tool completion never replaces a newer Thinking pass", () => {
    expect(toolEventReplacesThinking("llm.tool_chunk")).toBe(true);
    expect(toolEventReplacesThinking("tool.call")).toBe(true);
    expect(toolEventReplacesThinking("tool.result")).toBe(false);
  });
});
