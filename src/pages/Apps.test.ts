import { describe, expect, test } from "bun:test";
import type { AppRow } from "../api";
import { filterInstalledApps } from "./Apps";

function app(overrides: Partial<AppRow>): AppRow {
  return {
    install_id: 1,
    app_id: 1,
    name: "tasks",
    display_name: "Tasks",
    version: "1.0.0",
    description: "Project task management",
    icon: "",
    project_id: "project-1",
    status: "running",
    source: "registry",
    upgrade_policy: "manual",
    permissions: ["platform.apps.call"],
    surfaces: {
      kind: "service",
      mcp_tool_count: 0,
      skill_count: 0,
      http_route_count: 0,
      ui_panel_count: 0,
      ui_app: false,
      channel_count: 0,
      worker_count: 0,
      prompt_fragment_count: 0,
    },
    ...overrides,
  };
}

describe("filterInstalledApps", () => {
  const rows = [
    app({ install_id: 1 }),
    app({
      install_id: 2,
      name: "image-studio",
      display_name: "Image Studio",
      description: "Generate and edit images",
      project_id: "",
      status: "disabled",
      source: "git",
      permissions: ["platform.files.read"],
    }),
  ];

  test("matches multiple terms across app fields", () => {
    expect(filterInstalledApps(rows, "image disabled").map((row) => row.install_id)).toEqual([2]);
    expect(filterInstalledApps(rows, "tasks registry").map((row) => row.install_id)).toEqual([1]);
  });

  test("matches scope and permissions", () => {
    expect(filterInstalledApps(rows, "global files.read").map((row) => row.install_id)).toEqual([2]);
  });

  test("returns the original inventory for an empty query", () => {
    expect(filterInstalledApps(rows, "  ")).toBe(rows);
  });
});
