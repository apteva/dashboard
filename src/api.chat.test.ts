import { describe, expect, test } from "bun:test";
import { chatConversationListPath } from "./api";

describe("chat conversation API", () => {
  test("lists only the selected project's explicit conversations", () => {
    expect(chatConversationListPath("project-one")).toBe(
      "/apps/channel-chat/conversations?project_id=project-one",
    );
  });

  test("can request archived explicit conversations", () => {
    expect(chatConversationListPath("project one", true)).toBe(
      "/apps/channel-chat/conversations?project_id=project%20one&archived=1",
    );
  });
});
