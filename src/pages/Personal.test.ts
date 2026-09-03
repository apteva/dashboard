import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AppRow } from "../api";
import { selectPersonalConversationsContribution } from "./Personal";

function conversationsApp(over: Partial<AppRow> = {}): AppRow {
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
      entry: "/ui/AgentConversationsWidget.mjs",
      slots: ["dashboard.build"],
      visibility: "attached",
      supported_sizes: ["full"],
      default_size: "full",
    }],
    ...over,
  };
}

describe("Personal Conversations workspace", () => {
  test("prefers the project-scoped Conversations contribution", () => {
    const global = conversationsApp();
    const project = conversationsApp({ install_id: 11, project_id: "project-a" });
    expect(selectPersonalConversationsContribution([global, project], "project-a")?.app.install_id).toBe(11);
    expect(selectPersonalConversationsContribution([global], "project-a")?.app.install_id).toBe(10);
  });

  test("rejects stopped installs and unrelated components", () => {
    expect(selectPersonalConversationsContribution([conversationsApp({ status: "disabled" })], "project-a")).toBeNull();
    expect(selectPersonalConversationsContribution([conversationsApp({ ui_components: [] })], "project-a")).toBeNull();
  });

  test("uses the app contribution and never the deprecated channel chat", () => {
    const source = readFileSync(new URL("./Personal.tsx", import.meta.url), "utf8");
    expect(source).toContain("<ContributionMount");
    expect(source).toContain("fetchEligibleContributionKeys");
    expect(source).toContain('display_mode: "single"');
    expect(source).toContain("show_new_conversation: true");
    expect(source).toContain("loadedProjectId !== projectId");
    expect(source).toContain("includeChannels: false");
    expect(source).not.toContain("ChatPanel");
    expect(source).not.toContain("channel-chat");
    expect(source).not.toContain("chat.createConversation");
  });

  test("uses one theme-aware Apteva mark instead of social-style avatars", () => {
    const personal = readFileSync(new URL("./Personal.tsx", import.meta.url), "utf8");
    const mark = readFileSync(new URL("../components/AgentMark.tsx", import.meta.url), "utf8");
    expect(personal).toContain('import { AgentMark } from "../components/AgentMark"');
    expect(mark).toContain("function AgentMark");
    expect(mark).toContain('stroke="currentColor"');
    expect(mark).toContain("border-accent/25 bg-accent/10 text-accent");
    expect(mark).not.toContain("agentColor");
    expect(mark).not.toContain("backgroundColor");
  });

  test("keeps navigation out of the Personal page", () => {
    const source = readFileSync(new URL("./Personal.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("<aside");
    expect(source).not.toContain("useAuth");
    expect(source).not.toContain("setCurrentProject");
  });
});
