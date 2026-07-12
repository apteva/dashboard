import { describe, expect, test } from "bun:test";
import { appendRuntimeThoughtText, cleanReasoningDisplay } from "./runtimeThought";

describe("runtime thought formatting", () => {
  test("keeps streamed reasoning and response in separate buffers", () => {
    let thought = appendRuntimeThoughtText({}, "reasoning", "**Evaluating response ");
    thought = appendRuntimeThoughtText(thought, "reasoning", "capabilities**");
    thought = appendRuntimeThoughtText(thought, "response", "I’ll outline the tools ");
    thought = appendRuntimeThoughtText(thought, "response", "I can provide.");

    expect(thought.reasoning).toBe("**Evaluating response capabilities**");
    expect(thought.response).toBe("I’ll outline the tools I can provide.");
  });

  test("removes only the decorative bold reasoning heading", () => {
    expect(cleanReasoningDisplay("**Evaluating response capabilities**")).toBe(
      "Evaluating response capabilities",
    );
    expect(cleanReasoningDisplay("**Heading**\n\nSupporting detail.")).toBe(
      "Heading\n\nSupporting detail.",
    );
    expect(cleanReasoningDisplay("ordinary **emphasis** remains")).toBe(
      "ordinary **emphasis** remains",
    );
  });
});
