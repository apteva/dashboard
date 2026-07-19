import { describe, expect, test } from "bun:test";
import type { UnreadSummaryRow } from "../../api";
import { chatSidebarPreviewLabel } from "./ChatSidebar";

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
});
