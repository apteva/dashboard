import { afterEach, describe, expect, test } from "bun:test";
import i18next from "i18next";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { Agent, ChatRow, UnreadSummaryRow } from "../../api";
import { ChatSidebar, chatSidebarPreviewLabel } from "./ChatSidebar";

afterEach(cleanup);

function summary(latestRole: string, latestPreview: string): UnreadSummaryRow {
  return {
    chat_id: "conv-test",
    instance_id: 1,
    instance_name: "Test Agent",
    title: "Test",
    latest_id: 1,
    latest_role: latestRole,
    latest_preview: latestPreview,
    latest_at: "2026-07-19T09:00:00Z",
    last_seen_id: 0,
  };
}

describe("chatSidebarPreviewLabel", () => {
  test("renders agent Markdown as clean one-line text on the Chat page", () => {
    expect(chatSidebarPreviewLabel(
      summary("agent", "**Tasks** has been reinstalled and _started_"),
      () => "You: ",
    )).toBe("Tasks has been reinstalled and started");
  });

  test("keeps the translated user prefix without Markdown markers", () => {
    expect(chatSidebarPreviewLabel(
      summary("user", "Please update **Test Agent**"),
      () => "You: ",
    )).toBe("You: Please update Test Agent");
  });

  test("keeps a long conversation list inside its own scroll region", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: {} } } });
    const agent = {
      id: 1,
      name: "Test Agent",
      status: "running",
    } as Agent;
    const conversations = Array.from({ length: 40 }, (_, index) => ({
      id: `conv-${index}`,
      instance_id: agent.id,
      agent_ids: [agent.id],
      project_id: "default",
      title: `Conversation ${index}`,
      kind: "direct",
      updated_at: `2026-08-07T09:${String(index).padStart(2, "0")}:00Z`,
    })) as ChatRow[];
    const view = render(createElement(
      I18nextProvider,
      { i18n },
      createElement(ChatSidebar, {
        instances: [agent],
        conversations,
        summary: [],
        unreadByChat: new Map(),
        focusedChatId: conversations[0]?.id || null,
        onSelect: () => {},
        onNew: () => {},
      }),
    ));

    expect(view.container.firstElementChild?.className).toContain("min-h-0");
    expect(view.container.firstElementChild?.className).toContain("overflow-hidden");
    expect(view.container.querySelector("ul")?.className).toContain("min-h-0");
    expect(view.container.querySelector("ul")?.className).toContain("overflow-y-auto");
    expect(view.getAllByRole("button")).toHaveLength(41);
  });
});
