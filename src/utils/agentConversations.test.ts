import { afterEach, describe, expect, test } from "bun:test";
import { chat, type ChatRow } from "../api";
import { latestDirectConversationForAgent, openAgentConversation } from "./agentConversations";

const originalList = chat.listConversations;
const originalCreate = chat.createConversation;

const row = (id: string, agentIds: number[], kind: "direct" | "room" = "direct"): ChatRow => ({
  id,
  instance_id: agentIds[0] || 0,
  agent_ids: agentIds,
  project_id: "project-a",
  kind,
  title: id,
  created_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:00:00Z",
});

afterEach(() => {
  chat.listConversations = originalList;
  chat.createConversation = originalCreate;
});

describe("agent conversations", () => {
  test("never treats an internal default row as a visible direct conversation", () => {
    expect(latestDirectConversationForAgent([
      row("default-361", [361]),
      row("conv-room", [361, 362], "room"),
      row("conv-direct", [361]),
    ], 361)?.id).toBe("conv-direct");
  });

  test("reuses an explicit conversation and only creates when none exists", async () => {
    const existing = row("conv-existing", [361]);
    let creates = 0;
    chat.listConversations = (async () => [existing]) as typeof chat.listConversations;
    chat.createConversation = (async () => {
      creates += 1;
      return row("conv-new", [361]);
    }) as typeof chat.createConversation;

    expect((await openAgentConversation("project-a", { id: 361, name: "Agent" })).id).toBe(existing.id);
    expect(creates).toBe(0);

    chat.listConversations = (async () => []) as typeof chat.listConversations;
    expect((await openAgentConversation("project-a", { id: 361, name: "Agent" })).id).toBe("conv-new");
    expect(creates).toBe(1);
  });
});
