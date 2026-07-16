import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import "../../i18n";
import { ChatToolActivity } from "./ToolActivity";
import type { ToolActivity } from "./toolActivityModel";
import { buildToolVisualRegistry } from "./toolVisuals";

const registry = buildToolVisualRegistry([
  {
    install_id: 1,
    name: "crm",
    display_name: "CRM",
    version: "1.0.0",
    icon: "/api/apps/crm/icon.png",
    surfaces: { mcp_tool_names: ["crm_contacts"] },
  },
], []);

const tools: ToolActivity[] = [
  {
    id: "a",
    threadId: "main",
    name: "crm_contacts",
    reason: "Refreshing pipeline records",
    state: "done",
    success: true,
    durationMs: 120,
    startedAt: 1000,
    finishedAt: 1120,
  },
  {
    id: "b",
    threadId: "main",
    name: "evolve",
    reason: "Updating weekly report scope",
    state: "running",
    startedAt: 1050,
  },
  {
    id: "c",
    threadId: "main",
    name: "reports_publish",
    reason: "Publishing the refreshed report",
    state: "done",
    success: false,
    startedAt: 1060,
    finishedAt: 1200,
  },
];

describe("ChatToolActivity", () => {
  test("uses the same persistent summary structure for a single call", () => {
    const html = renderToStaticMarkup(
      <ChatToolActivity tools={[tools[1]!]} registry={registry} />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Updating weekly report scope");
    expect(html).toContain("chat-tool-icon-running");
    expect(html).not.toContain("+0");
  });

  test("starts grouped calls collapsed with the parallel summary", () => {
    const html = renderToStaticMarkup(
      <ChatToolActivity tools={tools} parallel registry={registry} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("3 parallel tool calls");
    expect(html).toContain("1 running");
    expect(html).toContain("1 failed");
    expect(html).not.toContain("1 completed");
    expect(html).toContain("Updating weekly report scope");
    expect(html).toContain("+2");
    expect(html).not.toContain("Refreshing pipeline records");
    expect(html).not.toContain("Publishing the refreshed report");
  });

  test("summarizes completed groups with the most recently finished reason", () => {
    const html = renderToStaticMarkup(
      <ChatToolActivity tools={[tools[0]!, tools[2]!]} parallel registry={registry} />,
    );
    expect(html).toContain("Publishing the refreshed report");
    expect(html).toContain("+1");
    expect(html).not.toContain("Refreshing pipeline records");
  });

  test("shows one summary icon for multiple calls to the same tool source", () => {
    const sameSourceTools: ToolActivity[] = [
      { ...tools[0]!, id: "crm-a", name: "crm_contacts" },
      {
        ...tools[0]!,
        id: "crm-b",
        name: "crm_companies",
        reason: "Checking associated companies",
        state: "running",
        startedAt: 1300,
        finishedAt: undefined,
      },
    ];
    const html = renderToStaticMarkup(
      <ChatToolActivity tools={sameSourceTools} parallel registry={registry} />,
    );
    expect(html.match(/src="\/api\/apps\/crm\/icon\.png"/g)?.length).toBe(1);
    expect(html).toContain("Checking associated companies");
    expect(html).toContain("+1");
  });

  test("renders one reason per expanded call without raw internal tool names", () => {
    const html = renderToStaticMarkup(
      <ChatToolActivity tools={tools} parallel expanded registry={registry} />,
    );
    expect(html).toContain("Refreshing pipeline records");
    expect(html).toContain("Updating weekly report scope");
    expect(html).toContain("Publishing the refreshed report");
    expect(html).not.toContain(">evolve<");
    expect(html).toContain("chat-tool-icon-running");
    expect(html).not.toContain("chat-tool-icon-failed");
    expect(html).not.toContain("border-y");
  });
});
