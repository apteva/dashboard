import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AppRow } from "../api";
import {
  buildWorkspaceItems,
  selectBuildConversationsContribution,
} from "./Build";

function app(over: Partial<AppRow> = {}): AppRow {
  return {
    install_id: 10,
    app_id: 3,
    name: "conversations",
    display_name: "Conversations",
    version: "0.17.0",
    description: "",
    icon: "",
    project_id: "",
    status: "running",
    source: "registry",
    upgrade_policy: "auto-patch",
    default_for_new_agents: false,
    permissions: [],
    surfaces: {
      kind: "source",
      mcp_tool_count: 8,
      skill_count: 1,
      http_route_count: 1,
      ui_panel_count: 1,
      ui_app: false,
      channel_count: 0,
      worker_count: 1,
      prompt_fragment_count: 0,
    },
    ui_components: [{
      name: "agent-conversations",
      label: "Agent conversations",
      description: "Chat with one agent through its durable conversations.",
      entry: "/ui/AgentConversationsWidget.mjs",
      slots: ["dashboard.build"],
      suggested: true,
      visibility: "attached",
      supported_sizes: ["full"],
      default_size: "full",
    }],
    ...over,
  };
}

describe("Build Conversations contribution", () => {
  test("uses the agent-conversations contribution with project install preference", () => {
    const global = app({ install_id: 10 });
    const project = app({ install_id: 11, project_id: "project-a" });
    expect(selectBuildConversationsContribution([global, project], "project-a")?.app.install_id).toBe(11);
    expect(selectBuildConversationsContribution([global], "project-a")?.app.install_id).toBe(10);
  });

  test("rejects stopped installs and unrelated components", () => {
    expect(selectBuildConversationsContribution([app({ status: "disabled" })], "project-a")).toBeNull();
    expect(selectBuildConversationsContribution([app({ ui_components: [] })], "project-a")).toBeNull();
    expect(selectBuildConversationsContribution([app({ ui_components: [{
      name: "inbox-overview",
      entry: "/ui/InboxWidget.mjs",
      slots: ["dashboard.home"],
    }] })], "project-a")).toBeNull();
  });

  test("uses the standard contribution host and no dashboard-owned chat transport", () => {
    const source = readFileSync(new URL("./Build.tsx", import.meta.url), "utf8");
    expect(source).toContain("<ContributionMount");
    expect(source).toContain("fetchEligibleContributionKeys");
    expect(source).toContain("agentId={helper.id}");
    expect(source).not.toContain("ChatPanel");
    expect(source).not.toContain("chatConnections");
    expect(source).not.toContain("channel-chat");
    expect(source).not.toContain("chat.createConversation");
    expect(source).not.toContain("<iframe");
  });

  test("keeps dashboard-owned project context beside the app contribution", () => {
    const source = readFileSync(new URL("./Build.tsx", import.meta.url), "utf8");
    expect(source).toContain("xl:grid-cols-[minmax(0,1fr)_320px]");
    expect(source).toContain("<WorkspacePanel");
    expect(source).toContain('aria-label="Open project workspace"');

    const items = buildWorkspaceItems(
      [{
        id: 12,
        user_id: 1,
        name: "Builder",
        directive: "",
        mode: "autonomous",
        config: "{}",
        port: 0,
        pid: 0,
        status: "running",
        project_id: "project-a",
        kind: "user",
        created_at: "",
      }],
      [app({ install_id: 22 })],
      [{
        id: 7,
        slug: "research",
        name: "Research",
        description: "Find sources",
        body: "Research the topic.",
        source: "user",
        project_id: "project-a",
        enabled: true,
        version: "1",
        created_at: "",
        updated_at: "",
      }],
    );
    expect(items.map((item) => item.kind)).toEqual(["agent", "app", "skill"]);
    expect(items[0]?.href).toBe("/agents/12");
    expect(items[2]?.status).toBe("enabled");
  });
});
