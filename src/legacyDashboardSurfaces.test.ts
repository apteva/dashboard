import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("legacy dashboard surfaces stay hidden", () => {
  test("chat URLs are redirects and the global legacy drivers do not boot", () => {
    const app = source("./App.tsx");
    const layout = source("./components/Layout.tsx");

    expect(app).toContain('<Route path="/chat" element={<Navigate to="/" replace />} />');
    expect(app).toContain('<Route path="/chat/:chatId" element={<Navigate to="/" replace />} />');
    expect(app).not.toContain('import("./pages/Chat")');
    expect(layout).not.toContain('{ to: "/chat"');
    expect(layout).not.toContain("startChatNotifications");
    expect(layout).not.toContain("chatConnections");
    expect(layout).not.toContain("ContextAgentChatWidget");
    expect(layout).not.toContain('searchParams.get("helper")');
  });

  test("native inbox, status, and agent-chat mounts remain absent", () => {
    const dashboard = source("./pages/Dashboard.tsx");
    const monitor = source("./pages/Monitor.tsx");
    const agents = source("./pages/Agents.tsx");
    const agentView = source("./components/AgentView.tsx");

    expect(dashboard).not.toContain("native:inbox");
    expect(dashboard).not.toContain("AptevaInbox");
    expect(monitor).not.toContain("AptevaInbox");
    expect(monitor).not.toContain("MonitorStatuses");
    expect(monitor).not.toContain("useCurrentStatuses");
    expect(agents).not.toContain("openAgentConversation");
    expect(agents).not.toContain("onChat");
    expect(agentView).not.toContain("AgentConversationPanel");
    expect(agentView).not.toContain("channelsAttached");
  });

  test("legacy settings and app channel metadata are not mounted", () => {
    const settings = source("./pages/Settings.tsx");
    const appDetail = source("./components/apps/AppDetailPanel.tsx");
    const surfaceBadges = source("./components/apps/AppSurfaceBadges.tsx");

    expect(settings).not.toContain('{ id: "channels"');
    expect(settings).not.toContain('tab === "channels"');
    expect(appDetail).not.toContain("s?.channel_names");
    expect(surfaceBadges).not.toContain("surfaces.channel_count");
    expect(surfaceBadges).not.toContain("surfaces.channel_names");
  });

  test("generic app contribution surfaces remain available", () => {
    const app = source("./App.tsx");
    const dashboard = source("./pages/Dashboard.tsx");
    const layout = source("./components/Layout.tsx");

    expect(app).toContain('<Route path="/apps/:name/page" element={<AppProjectPage />} />');
    expect(dashboard).toContain('contributionsFor(installedApps, "dashboard.home")');
    expect(layout).toContain("useProjectUILayout");
  });

  test("Build navigation follows explicit Helper activation", () => {
    const layout = source("./components/Layout.tsx");

  expect(layout).toContain("platformHelper");
  expect(layout).toContain(".status()");
    expect(layout).toContain("helperActivated ?");
    expect(layout).toContain('window.addEventListener("apteva:helper-changed"');
  });
});
