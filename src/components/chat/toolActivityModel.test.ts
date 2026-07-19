import { describe, expect, test } from "bun:test";
import type { ChatMessageRow, TelemetryEvent } from "../../api";
import { telemetryEventMatchesThread } from "../ChatStatusDot";
import {
  buildChatTimeline,
	chatConversationThreadId,
	isChatConversationTelemetry,
  isChatConversationThread,
  mergeToolActivityEvents,
  reduceToolActivity,
  shouldHideChatTool,
  type ToolActivity,
} from "./toolActivityModel";

function event(
  type: string,
  time: string,
  data: Record<string, unknown>,
  overrides: Partial<TelemetryEvent> = {},
): TelemetryEvent {
  return {
    id: `${type}:${time}:${String(data.id || "")}`,
    instance_id: 1,
    thread_id: "main",
    type,
    time,
    data,
    ...overrides,
  };
}

function message(id: number, role: ChatMessageRow["role"], createdAt: string): ChatMessageRow {
  return {
    id,
    chat_id: "default-1",
    role,
    content: `${role} ${id}`,
    status: "final",
    created_at: createdAt,
  };
}

describe("tool activity reducer", () => {
	test("renders one completed thread handoff with the model's user-facing reason", () => {
		let calls = reduceToolActivity(new Map(), event("tool.call", "2026-07-19T10:56:11Z", {
			id: "handoff",
			name: "send",
			reason: "Handing off daily schedule",
		}, { thread_id: "chat-conv-a" }));
		calls = reduceToolActivity(calls, event("tool.result", "2026-07-19T10:56:12Z", {
			id: "handoff",
			name: "send",
			success: true,
		}, { thread_id: "chat-conv-a" }));

		expect(calls.size).toBe(1);
		const handoff = [...calls.values()][0];
		expect(handoff?.reason).toBe("Handing off daily schedule");
		expect(handoff?.state).toBe("done");
	});

  test("keeps parallel calls to the same tool separate by call id", () => {
    const calls = mergeToolActivityEvents(new Map(), [
      event("tool.call", "2026-07-14T10:00:00.000Z", { id: "a", name: "crm_search", reason: "Searching Acme" }),
      event("tool.call", "2026-07-14T10:00:00.100Z", { id: "b", name: "crm_search", reason: "Searching Globex" }),
    ]);
    expect(calls.size).toBe(2);
		expect([...calls.values()].find((call) => call.callId === "a")?.reason).toBe("Searching Acme");
		expect([...calls.values()].find((call) => call.callId === "b")?.reason).toBe("Searching Globex");
  });

  test("normalizes core success and legacy is_error result payloads", () => {
    let calls = reduceToolActivity(new Map(), event("tool.call", "2026-07-14T10:00:00Z", { id: "a", name: "crm_search", reason: "Searching" }));
    calls = reduceToolActivity(calls, event("tool.result", "2026-07-14T10:00:01Z", { id: "a", name: "crm_search", success: false, duration_ms: 1000 }));
		expect([...calls.values()].find((call) => call.callId === "a")?.success).toBe(false);
    calls = reduceToolActivity(calls, event("tool.call", "2026-07-14T10:00:02Z", { id: "b", name: "crm_search", reason: "Searching" }));
    calls = reduceToolActivity(calls, event("tool.result", "2026-07-14T10:00:03Z", { id: "b", name: "crm_search", is_error: true }));
		expect([...calls.values()].find((call) => call.callId === "b")?.success).toBe(false);
  });

  test("does not regress a completed call when an older call event arrives late", () => {
    let calls = reduceToolActivity(new Map(), event("tool.result", "2026-07-14T10:00:02Z", { id: "a", name: "crm_search", success: true }));
    calls = reduceToolActivity(calls, event("tool.call", "2026-07-14T10:00:01Z", { id: "a", name: "crm_search", reason: "Searching" }));
		const completed = [...calls.values()].find((call) => call.callId === "a");
		expect(completed?.state).toBe("done");
		expect(completed?.reason).toBe("Searching");
  });

  test("preserves the first-seen UI identity when a provider call id arrives", () => {
    let calls = reduceToolActivity(
      new Map(),
      event("llm.tool_chunk", "2026-07-14T10:00:00Z", { tool: "crm_search" }),
    );
    const provisionalId = [...calls.keys()][0]!;

    calls = reduceToolActivity(
      calls,
      event("tool.call", "2026-07-14T10:00:00.100Z", {
        id: "provider-call-a",
        name: "crm_search",
        reason: "Searching",
      }),
    );
    calls = reduceToolActivity(
      calls,
      event("tool.result", "2026-07-14T10:00:01Z", {
        id: "provider-call-a",
        name: "crm_search",
        success: true,
      }),
    );

    expect([...calls.keys()]).toEqual([provisionalId]);
    expect(calls.get(provisionalId)?.callId).toBe("provider-call-a");
    expect(calls.get(provisionalId)?.state).toBe("done");
  });

	test("never correlates identical provider call ids across agents or threads", () => {
		const calls = mergeToolActivityEvents(new Map(), [
			event("tool.call", "2026-07-14T10:00:00Z", { id: "shared", name: "crm_search", reason: "Agent one" }, { instance_id: 1, thread_id: "chat-conv-a" }),
			event("tool.call", "2026-07-14T10:00:00.100Z", { id: "shared", name: "crm_search", reason: "Agent two" }, { instance_id: 2, thread_id: "chat-conv-a" }),
			event("tool.call", "2026-07-14T10:00:00.200Z", { id: "shared", name: "crm_search", reason: "Other thread" }, { instance_id: 1, thread_id: "worker" }),
			event("tool.result", "2026-07-14T10:00:01Z", { id: "shared", name: "crm_search", success: true }, { instance_id: 2, thread_id: "chat-conv-a" }),
		]);
		expect(calls.size).toBe(3);
		expect([...calls.values()].find((call) => call.agentId === 2 && call.threadId === "chat-conv-a")?.state).toBe("done");
		expect([...calls.values()].find((call) => call.agentId === 1 && call.threadId === "chat-conv-a")?.state).toBe("running");
		expect([...calls.values()].find((call) => call.threadId === "worker")?.reason).toBe("Other thread");
	});
});

describe("chat tool thread scope", () => {
	test("derives the exact runtime thread used by the status indicator", () => {
		expect(chatConversationThreadId("default-286")).toBe("chat-default-286");
		expect(chatConversationThreadId("conv-room-1")).toBe("chat-conv-room-1");
		expect(chatConversationThreadId(null)).toBeNull();
		expect(telemetryEventMatchesThread("", "main")).toBe(true);
		expect(telemetryEventMatchesThread("", "chat-conv-room-1")).toBe(false);
		expect(telemetryEventMatchesThread("chat-conv-room-1", "chat-conv-room-1")).toBe(true);
	});

  test("accepts only the chat-routed thread and rejects main or unrelated workers", () => {
    expect(isChatConversationThread("main", "default-286")).toBe(false);
    expect(isChatConversationThread("", "default-286")).toBe(false);
		expect(isChatConversationThread("default-286", "default-286")).toBe(false);
		expect(isChatConversationThread("chat-default-286", "default-286")).toBe(true);
    expect(isChatConversationThread("worker-research", "default-286")).toBe(false);
    expect(isChatConversationThread("chat-default-999", "default-286")).toBe(false);
    expect(isChatConversationThread("main", "conv-room-1")).toBe(false);
    expect(isChatConversationThread("chat-conv-room-1", "conv-room-1")).toBe(true);
  });

	test("requires both a participant agent and the selected conversation thread", () => {
		const selected = event("tool.call", "2026-07-14T10:00:00Z", { id: "a", name: "crm" }, { instance_id: 286, thread_id: "chat-conv-room-1" });
		const otherAgent = { ...selected, instance_id: 999 };
		const otherThread = { ...selected, thread_id: "chat-conv-room-2" };
		expect(isChatConversationTelemetry(selected, "conv-room-1", [285, 286])).toBe(true);
		expect(isChatConversationTelemetry(otherAgent, "conv-room-1", [285, 286])).toBe(false);
		expect(isChatConversationTelemetry(otherThread, "conv-room-1", [285, 286])).toBe(false);
	});
});

describe("chat tool visibility", () => {
  test("shows thread handoffs while hiding channel delivery tools", () => {
    expect(shouldHideChatTool("send", "Handing off recurring request")).toBe(false);
    expect(shouldHideChatTool("channels_send", "Replying to user")).toBe(true);
    expect(shouldHideChatTool("crm_search", "Searching CRM")).toBe(false);
  });
});

describe("chat timeline", () => {
  test("keeps one stable burst key as a second parallel tool joins", () => {
    const first: ToolActivity = {
      id: "a",
		agentId: 1,
      threadId: "main",
      name: "crm",
      reason: "Reading CRM",
      state: "running",
      startedAt: 1_000,
    };
    const second: ToolActivity = {
      id: "b",
		agentId: 1,
      threadId: "main",
      name: "sheets",
      reason: "Reading sheets",
      state: "running",
      startedAt: 1_100,
    };
    const single = buildChatTimeline([], [first], 1_000).find((item) => item.kind === "toolGroup");
    const parallel = buildChatTimeline([], [first, second], 1_100).find((item) => item.kind === "toolGroup");

    expect(single?.key).toBe("tool-group:a:1000");
    expect(parallel?.key).toBe(single?.key);
  });

  test("groups overlapping calls as parallel with a stable first-call key", () => {
    const tools: ToolActivity[] = [
      { id: "a", agentId: 1, threadId: "main", name: "crm", reason: "Reading CRM", state: "done", success: true, startedAt: 1_000, finishedAt: 4_000 },
      { id: "b", agentId: 1, threadId: "main", name: "sheets", reason: "Reading sheets", state: "running", startedAt: 2_000 },
    ];
    const timeline = buildChatTimeline([], tools, 2_000);
    const group = timeline.find((item) => item.kind === "toolGroup");
    expect(group?.kind).toBe("toolGroup");
    if (group?.kind !== "toolGroup") throw new Error("tool group missing");
    expect(group.parallel).toBe(true);
    expect(group.key).toBe("tool-group:a:1000");
  });

  test("does not call sequential activity parallel", () => {
    const tools: ToolActivity[] = [
      { id: "a", agentId: 1, threadId: "main", name: "crm", reason: "Reading CRM", state: "done", success: true, startedAt: 1_000, finishedAt: 1_500 },
      { id: "b", agentId: 1, threadId: "main", name: "sheets", reason: "Writing sheets", state: "done", success: true, startedAt: 2_000, finishedAt: 3_000 },
    ];
    const group = buildChatTimeline([], tools, 3_000).find((item) => item.kind === "toolGroup");
    expect(group?.kind === "toolGroup" && group.parallel).toBe(false);
  });

  test("adds day and inactivity markers and compacts consecutive roles", () => {
    const messages = [
      message(1, "agent", "2026-07-13T09:00:00Z"),
      message(2, "agent", "2026-07-13T09:02:00Z"),
      message(3, "user", "2026-07-13T10:00:00Z"),
      message(4, "agent", "2026-07-14T10:00:00Z"),
    ];
    const timeline = buildChatTimeline(messages, [], Date.parse("2026-07-14T12:00:00Z"));
    expect(timeline.filter((item) => item.kind === "day")).toHaveLength(2);
    expect(timeline.filter((item) => item.kind === "time")).toHaveLength(1);
    const second = timeline.find((item) => item.kind === "message" && item.message.id === 2);
    expect(second?.kind === "message" && second.compactBefore).toBe(true);
  });
});
