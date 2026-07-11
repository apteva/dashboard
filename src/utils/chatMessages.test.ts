import { describe, expect, test } from "bun:test";
import type { ChatMessageRow } from "../api";
import { mergeChatMessages } from "./chatMessages";

function row(id: number, role: "user" | "agent"): ChatMessageRow {
  return {
    id,
    chat_id: "default-286",
    role,
    content: `${role}-${id}`,
    thread_id: "main",
    status: "final",
    created_at: "2026-07-10T09:36:00Z",
  };
}

describe("mergeChatMessages", () => {
  test("keeps a lower-id POST response that resolves after a later SSE reply", () => {
    const agentReply = row(650, "agent");
    const userPost = row(649, "user");
    const merged = mergeChatMessages([agentReply], [userPost]);
    expect(merged.map((message) => message.id)).toEqual([649, 650]);
  });

  test("deduplicates the same durable row delivered by POST, SSE, and REST", () => {
    const message = row(649, "user");
    const current = [message];
    const merged = mergeChatMessages(current, [message, { ...message }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(649);
    expect(merged).toBe(current);
  });
});
