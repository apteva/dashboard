import { describe, expect, test } from "bun:test";
import type { ChatMessageRow } from "../../api";
import { chatTimelineMarginClass } from "./chatTimelineSpacing";
import type { ChatTimelineItem, ToolActivity } from "./toolActivityModel";

function message(id: number, role: ChatMessageRow["role"], compactBefore = false): ChatTimelineItem {
  return {
    kind: "message",
    key: `message:${id}`,
    ts: id,
    endTs: id,
    compactBefore,
    message: {
      id,
      chat_id: "test",
      role,
      content: "message",
      status: "final",
      created_at: new Date(id).toISOString(),
    },
  };
}

function toolGroup(): ChatTimelineItem {
  const tool: ToolActivity = {
    id: "tool-1",
    agentId: 1,
    threadId: "chat-test",
    name: "computer_open",
    reason: "Opening website",
    state: "done",
    startedAt: 2,
  };
  return {
    kind: "toolGroup",
    key: "tool-group:tool-1:2",
    ts: 2,
    endTs: 2,
    tools: [tool],
    parallel: false,
  };
}

describe("chatTimelineMarginClass", () => {
  test("balances a tool burst between an agent preamble and its answer", () => {
    const tool = toolGroup();
    expect(chatTimelineMarginClass(tool, message(1, "agent"))).toBe("mt-1");
    expect(chatTimelineMarginClass(message(3, "agent"), tool)).toBe("mt-2");
  });

  test("keeps a stronger turn boundary when a user message directly launches tools", () => {
    expect(chatTimelineMarginClass(toolGroup(), message(1, "user"))).toBe("mt-4");
  });

  test("keeps compact consecutive messages compact", () => {
    expect(chatTimelineMarginClass(message(2, "agent", true), message(1, "agent"))).toBe("mt-1.5");
  });
});
