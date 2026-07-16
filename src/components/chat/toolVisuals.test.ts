import { describe, expect, test } from "bun:test";
import type { ConnectionInfo } from "../../api";
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
      surfaces: { mcp_tool_names: ["contacts_find"] },
    }];
    const visual = resolveToolVisual("contacts_find", buildToolVisualRegistry(apps, []));
    expect(visual.label).toBe("CRM");
    expect(visual.iconUrl).toBe("/api/apps/crm/icon.png");
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
});
