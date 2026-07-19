import { describe, expect, test } from "bun:test";
import type { ChatRow } from "../../api";
import {
  conversationsWithoutHelper,
  helperConversationStorageKey,
  helperDirectConversations,
  selectHelperConversation,
} from "./helperConversationModel";

function conversation(overrides: Partial<ChatRow>): ChatRow {
  return {
    id: "conv-default",
    instance_id: 900,
    agent_ids: [900],
    project_id: "project-a",
    kind: "direct",
    title: "Helper",
    created_at: "2026-07-19T08:00:00Z",
    updated_at: "2026-07-19T08:00:00Z",
    ...overrides,
  };
}

describe("helper conversation model", () => {
  test("uses a different tab-scoped selection key per project", () => {
    expect(helperConversationStorageKey("project-a")).not.toBe(helperConversationStorageKey("project-b"));
  });

  test("includes only one-agent direct conversations owned by the helper", () => {
    const rows = helperDirectConversations([
      conversation({ id: "older" }),
      conversation({ id: "newer", updated_at: "2026-07-19T09:00:00Z" }),
      conversation({ id: "room", kind: "room", agent_ids: [900, 901] }),
      conversation({ id: "other", instance_id: 901, agent_ids: [901] }),
    ], 900);
    expect(rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });

  test("restores a valid stored helper conversation and rejects stale selections", () => {
    const rows = [
      conversation({ id: "older" }),
      conversation({ id: "newer", updated_at: "2026-07-19T09:00:00Z" }),
    ];
    expect(selectHelperConversation(rows, 900, "older")?.id).toBe("older");
    expect(selectHelperConversation(rows, 900, "missing")?.id).toBe("newer");
  });

  test("hides every helper-owned or helper-participating conversation from regular chat", () => {
    const rows = conversationsWithoutHelper([
      conversation({ id: "helper-direct" }),
      conversation({ id: "helper-room", instance_id: 901, agent_ids: [901, 900], kind: "room" }),
      conversation({ id: "legacy-helper", instance_id: 900, agent_ids: [] }),
      conversation({ id: "agent-direct", instance_id: 901, agent_ids: [901] }),
    ], 900);
    expect(rows.map((row) => row.id)).toEqual(["agent-direct"]);
  });
});
