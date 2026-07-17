import { describe, expect, test } from "bun:test";
import { buildChatComponentModuleURL } from "./chatComponents";

describe("chat component module URLs", () => {
  test("routes sidecar components to the exact project installation", () => {
    expect(
      buildChatComponentModuleURL(
        "social",
        "/ui/SocialCalendarCard.mjs",
        "0.14.76",
        "git",
        { installId: 34, projectId: "project one/primary" },
      ),
    ).toBe(
      "/api/apps/social/ui/SocialCalendarCard.mjs?v=0.14.76&install_id=34&project_id=project+one%2Fprimary",
    );
  });

  test("keeps an install selector when no project context is available", () => {
    expect(
      buildChatComponentModuleURL("storage", "/ui/FileCard.mjs", "", "git", {
        installId: 9,
      }),
    ).toBe("/api/apps/storage/ui/FileCard.mjs?install_id=9");
  });

  test("does not add sidecar scope to embedded integration components", () => {
    expect(
      buildChatComponentModuleURL(
        "github",
        "/ui/IssueCard.mjs",
        "2026.07",
        "integration",
        { installId: 71, projectId: "project-1" },
      ),
    ).toBe("/api/integrations/github/ui/IssueCard.mjs?v=2026.07");
  });
});
