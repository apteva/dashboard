import { describe, expect, test } from "bun:test";
import type { ConnectionInfo, MCPServer } from "../../api";
import type { InstalledAppRow } from "../apps/chatComponents";
import { buildToolVisualRegistry, resolveToolVisual } from "./toolVisuals";

describe("tool visual registry", () => {
  test("prefers exact app MCP tool metadata", () => {
    const apps: InstalledAppRow[] = [{
      install_id: 1,
      name: "crm",
      display_name: "CRM",
      version: "1.0.0",
      icon: "/api/apps/crm/icon.png",
      icon_style: "monochrome",
      surfaces: { mcp_tool_names: ["contacts_find"] },
    }];
    const visual = resolveToolVisual("contacts_find", buildToolVisualRegistry(apps, []));
    expect(visual.label).toBe("CRM");
    expect(visual.iconUrl).toBe("/api/apps/crm/icon.png");
    expect(visual.iconStyle).toBe("monochrome");
  });

  test("uses longest integration namespace and its server-provided logo", () => {
    const connections = [{
      id: 1,
      app_slug: "omnikit-storage",
      app_name: "OmniKit Storage",
      name: "Production storage",
      logo: "https://example.com/storage.png",
      auth_type: "api_key",
      status: "connected",
      source: "local",
      tool_count: 4,
      created_at: "2026-07-14T10:00:00Z",
    }] satisfies ConnectionInfo[];
    const visual = resolveToolVisual(
      "omnikit-storage-real-estate_list",
      buildToolVisualRegistry([], connections),
    );
    expect(visual.label).toBe("OmniKit Storage");
    expect(visual.iconUrl).toBe("https://example.com/storage.png");
  });

  test("falls back to a native glyph without exposing the tool name as a label", () => {
    const visual = resolveToolVisual("memory_search", buildToolVisualRegistry([], []));
    expect(visual.label).toBe("Apteva tool");
    expect(visual.glyph).toBe("memory");
  });

  test("groups built-in platform tools under one MCP source", () => {
    const registry = buildToolVisualRegistry([], []);
    const list = resolveToolVisual("apteva-server_apps_list", registry);
    const remove = resolveToolVisual("apteva-server_apps_uninstall", registry);
    expect(list.key).toBe("mcp:apteva-server");
    expect(remove.key).toBe(list.key);
    expect(remove.label).toBe("Apteva");
  });

  test("uses an installed app's identity for its namespaced tools", () => {
    const tasksApp: InstalledAppRow = {
      install_id: 7,
      name: "tasks",
      display_name: "Tasks",
      version: "1.0.0",
      icon: "/api/apps/tasks/icon.svg",
      icon_style: "monochrome",
      surfaces: { mcp_tool_names: ["create", "complete"] },
    };
    const registry = buildToolVisualRegistry([tasksApp], []);
    const complete = resolveToolVisual("tasks_complete", registry);

    expect(complete.key).toBe("app:7");
    expect(complete.label).toBe("Tasks");
    expect(complete.iconStyle).toBe("monochrome");
    expect(complete.iconUrl).toBe(tasksApp.icon);
  });

  test("groups project MCP tools by their server namespace", () => {
    const servers = [{
      id: 42,
      name: "warehouse",
      description: "Warehouse",
      allowed_tools: null,
    }] as MCPServer[];
    const registry = buildToolVisualRegistry([], [], servers);
    const inventory = resolveToolVisual("warehouse_inventory", registry);
    const orders = resolveToolVisual("warehouse_orders", registry);
    expect(inventory.key).toBe("mcp:42");
    expect(orders.key).toBe(inventory.key);
  });
});
