import { describe, expect, test } from "bun:test";
import type { AppRow } from "../api";
import {
  appHasUpdate,
  filterInstalledApps,
  marketplaceCategoryNames,
  projectAppsWithUpdates,
  resolveMarketplaceCategory,
  upgradeAppsSequentially,
} from "./Apps";

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
    default_for_new_agents: false,
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

  test("returns all real installs for an empty query", () => {
    expect(filterInstalledApps(rows, "  ")).toEqual(rows);
  });

  test("excludes integration discovery rows with and without a search", () => {
    const github = app({ install_id: 0, name: "github", display_name: "GitHub", source: "integration" });
    const mixed = [...rows, github, app({ install_id: 0 }), app({ install_id: -1 }), app({ install_id: 99, source: "integration" })];
    expect(filterInstalledApps(mixed, "")).toEqual(rows);
    expect(filterInstalledApps(mixed, "github")).toEqual([]);
    expect(filterInstalledApps([github], "")).toEqual([]);
    expect(mixed).toHaveLength(6);
    expect(mixed[2]).toBe(github);
  });
});

describe("marketplace category selection", () => {
  const categories = { media: 12, productivity: 20, business: 20 };

  test("keeps an available selected category", () => {
    expect(resolveMarketplaceCategory("media", categories)).toBe("media");
  });

  test("uses all apps for an empty, all, or missing category", () => {
    expect(resolveMarketplaceCategory("all", categories)).toBe("");
    expect(resolveMarketplaceCategory("missing", categories)).toBe("");
    expect(resolveMarketplaceCategory("", categories)).toBe("");
  });

  test("orders categories by count and then by name", () => {
    expect(marketplaceCategoryNames(categories)).toEqual([
      "business",
      "productivity",
      "media",
    ]);
  });
});

describe("project app updates", () => {
  test("never queues lifecycle actions for discovery rows", async () => {
    const github = app({ install_id: 0, name: "github", source: "integration", available_version: "2.0.0" });
    const code = app({ install_id: 7, name: "code", available_version: "2.0.0" });
    const invalid = app({ install_id: 0, available_version: "2.0.0" });
    expect(appHasUpdate(github)).toBe(false);
    expect(appHasUpdate(invalid)).toBe(false);
    expect(projectAppsWithUpdates([github, code, invalid], "project-1")).toEqual([code]);
    const calls: number[] = [];
    const result = await upgradeAppsSequentially([github, code, invalid], async (id) => { calls.push(id); });
    expect(calls).toEqual([7]);
    expect(result.updated).toEqual([code]);
  });

  test("selects only ready updates owned by the current project", () => {
    const rows = [
      app({ install_id: 1, available_version: "1.1.0" }),
      app({ install_id: 2, project_id: "project-2", available_version: "1.1.0" }),
      app({ install_id: 3, project_id: "", available_version: "1.1.0" }),
      app({ install_id: 4, available_version: "1.0.0" }),
      app({ install_id: 5, available_version: "1.1.0", status: "pending" }),
      app({ install_id: 6, available_version: "1.1.0", deprecated: true }),
    ];

    expect(projectAppsWithUpdates(rows, "project-1").map((row) => row.install_id)).toEqual([1]);
    expect(projectAppsWithUpdates(rows, undefined)).toEqual([]);
  });

  test("does not offer another update while an app is already pending", () => {
    expect(appHasUpdate(app({ available_version: "1.1.0", status: "running" }))).toBe(true);
    expect(appHasUpdate(app({ available_version: "1.1.0", status: "pending" }))).toBe(false);
  });

  test("runs upgrades sequentially and separates permission review from failures", async () => {
    const targets = [
      app({ install_id: 1, display_name: "One", available_version: "1.1.0" }),
      app({ install_id: 2, display_name: "Two", available_version: "1.1.0" }),
      app({ install_id: 3, display_name: "Three", available_version: "1.1.0" }),
    ];
    const order: string[] = [];
    const permissionError: any = new Error("new permissions required");
    permissionError.status = 409;
    permissionError.body = {
      version: "1.1.0",
      missing_permissions: ["platform.files.write"],
    };

    const result = await upgradeAppsSequentially(
      targets,
      async (installId) => {
        order.push(`start:${installId}`);
        await Promise.resolve();
        order.push(`end:${installId}`);
        if (installId === 2) throw permissionError;
        if (installId === 3) throw new Error("registry unavailable");
      },
    );

    expect(order).toEqual([
      "start:1", "end:1",
      "start:2", "end:2",
      "start:3", "end:3",
    ]);
    expect(result.updated.map(({ install_id }) => install_id)).toEqual([1]);
    expect(result.permissions[0]?.app.install_id).toBe(2);
    expect(result.permissions[0]?.prompt.missingPermissions).toEqual(["platform.files.write"]);
    expect(result.failed).toEqual([
      { app: targets[2], message: "registry unavailable" },
    ]);
  });
});
