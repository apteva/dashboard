import { describe, expect, test } from "bun:test";
import { chatPreviewText } from "./chatPreview";

describe("chatPreviewText", () => {
  test("removes emphasis markers from conversation previews", () => {
    expect(chatPreviewText("**Test Agent Directive** is now active")).toBe(
      "Test Agent Directive is now active",
    );
    expect(chatPreviewText("**Tasks** has been reinstalled and _started_"))
      .toBe("Tasks has been reinstalled and started");
  });

  test("keeps readable labels while removing structural markdown", () => {
    expect(chatPreviewText("### Result\n- **Five agents**\n- [Open details](/agents)\n`done`"))
      .toBe("Result Five agents Open details done");
  });

  test("does not damage ordinary underscores", () => {
    expect(chatPreviewText("Updated agent_status and project_id"))
      .toBe("Updated agent_status and project_id");
  });
});
