import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { chat, instances, platformHelper, type Agent, type ChatRow } from "../api";
import { useChatDirectory } from "./useChatDirectory";

const originalInstancesList = instances.list;
const originalConversationList = chat.listConversations;
const originalUnreadSummary = chat.unreadSummary;
const originalHelperGet = platformHelper.get;

afterEach(() => {
  instances.list = originalInstancesList;
  chat.listConversations = originalConversationList;
  chat.unreadSummary = originalUnreadSummary;
  platformHelper.get = originalHelperGet;
});

describe("useChatDirectory", () => {
  test("does not clear or reload the directory when only the selected conversation changes", async () => {
    const agent = agentRow(14, "CRM Agent");
    const helper = { ...agentRow(99, "Helper"), kind: "platform_helper" };
    const rows = [conversationRow("conv-one"), conversationRow("conv-two")];
    let listCalls = 0;

    instances.list = mock(async () => [agent, helper]);
    chat.listConversations = mock(async () => {
      listCalls += 1;
      return rows;
    });
    chat.unreadSummary = mock(async () => []);
    platformHelper.get = mock(async () => helper);

    const hook = renderHook(
      ({ selectedId }) => ({ selectedId, directory: useChatDirectory("project-chat") }),
      { initialProps: { selectedId: rows[0].id } },
    );
    await waitFor(() => expect(hook.result.current.directory.loadedProjectId).toBe("project-chat"));
    const stableRows = hook.result.current.directory.conversations;

    hook.rerender({ selectedId: rows[1].id });

    expect(hook.result.current.selectedId).toBe(rows[1].id);
    expect(hook.result.current.directory.conversations).toBe(stableRows);
    expect(hook.result.current.directory.conversations.map((row) => row.id)).toEqual(["conv-one", "conv-two"]);
    expect(listCalls).toBe(1);
    hook.unmount();
  });
});

function agentRow(id: number, name: string): Agent {
  return {
    id,
    name,
    status: "running",
    user_id: 1,
    directive: "",
    mode: "autonomous",
    config: "",
    port: 0,
    pid: 0,
    project_id: "project-chat",
    created_at: "2026-08-07T09:00:00Z",
  };
}

function conversationRow(id: string): ChatRow {
  return {
    id,
    instance_id: 14,
    agent_ids: [14],
    project_id: "project-chat",
    kind: "direct",
    title: id,
    created_at: "2026-08-07T09:00:00Z",
    updated_at: "2026-08-07T09:00:00Z",
  };
}
