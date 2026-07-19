import { describe, expect, test } from "bun:test";
import {
  clearThinkingForIteration,
  clearThinkingThroughGeneration,
  isChatUserTurnEvent,
  isTerminalChatTurnTool,
  nextChatTurnStartKind,
  shouldBeginChatTurn,
  shouldShowChatThinking,
  terminalToolEndsChatTurn,
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
  test("recognizes the core terminal tools", () => {
    expect(isTerminalChatTurnTool("pace")).toBe(true);
    expect(isTerminalChatTurnTool("done")).toBe(true);
    expect(isTerminalChatTurnTool("channels_send")).toBe(false);
    expect(isTerminalChatTurnTool("apps_list")).toBe(false);
  });

  test("does not let a new worker's bootstrap pace end the queued user turn", () => {
    expect(terminalToolEndsChatTurn("pace", false)).toBe(false);
    expect(terminalToolEndsChatTurn("pace", true)).toBe(true);
    expect(terminalToolEndsChatTurn("done", true)).toBe(true);
  });

  test("distinguishes a delivered dashboard turn from presence and shutdown events", () => {
    expect(isChatUserTurnEvent({ source: "bus", message: "[chat]\nA user is talking to you in dashboard chat..." })).toBe(true);
    expect(isChatUserTurnEvent({ source: "bus", message: "[chat] user connected to chat" })).toBe(false);
    expect(isChatUserTurnEvent({ source: "bus", message: "[chat] user disconnected from chat" })).toBe(false);
    expect(isChatUserTurnEvent({ source: "bus", message: "[chat.session_closing] deleted" })).toBe(false);
  });

  test("hides housekeeping after a visible reply but allows Thinking after tool work", () => {
    expect(shouldShowChatThinking(true, true, true)).toBe(false);
    // A visible tool clears the after-reply gate; its follow-up LLM pass is
    // the real answer-preparation state the operator should see.
    expect(shouldShowChatThinking(true, true, false)).toBe(true);
    expect(shouldShowChatThinking(true, false, false)).toBe(false);
  });

  test("a distinct user message starts a new turn before prior housekeeping ends", () => {
    expect(shouldBeginChatTurn("client:first", "client:second")).toBe(true);
    expect(shouldBeginChatTurn("client:second", "client:second")).toBe(false);
    expect(shouldBeginChatTurn("client:second", "")).toBe(false);
  });

  test("keeps the agent main-thread lifecycle idempotent across its durable echo", () => {
    let activeTurnKey = "";
    const firstMainMessage = "client:main-first";
    expect(shouldBeginChatTurn(activeTurnKey, firstMainMessage)).toBe(true);
    activeTurnKey = firstMainMessage;

    // Agent Detail sees the POST response and may then receive the same row
    // over SSE. That echo must not reset an already accepted main-thread turn.
    expect(shouldBeginChatTurn(activeTurnKey, firstMainMessage)).toBe(false);

    // The next composer send is still a new turn even when Core is finishing
    // hidden housekeeping for the preceding main-thread response.
    expect(shouldBeginChatTurn(activeTurnKey, "client:main-second")).toBe(true);
  });

  test("uses the conversation label only for the newly queued first turn", () => {
    const firstTurn = "client:queued-first";
    expect(nextChatTurnStartKind("", firstTurn, "conversation")).toBe("conversation");
    // The POST response and SSE echo carry the same client id. They must not
    // relabel or restart the already-active first turn.
    expect(nextChatTurnStartKind(firstTurn, firstTurn, "response")).toBeNull();
    // Once the conversation exists, every later composer send is an ordinary
    // response turn even though the durable chat id still begins with conv-.
    expect(nextChatTurnStartKind(firstTurn, "client:follow-up", "response")).toBe("response");
  });

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
