import { describe, expect, test } from "bun:test";
import {
  contributionKey,
  contributionsFor,
  defaultWidgetSettings,
  enabledContributionKeys,
  preferredSidebarAppNames,
  reorderWidgetInstances,
  serializeWidgetInstances,
  supportedWidgetSizes,
  widgetInstancesFor,
  type ProjectUILayout,
} from "./contributions";
import type { InstalledAppRow } from "./chatComponents";

const installed: InstalledAppRow[] = [
  {
    install_id: 7,
    name: "work-ledger",
    display_name: "Work Ledger",
    version: "1.0.0",
    status: "running",
    ui_components: [
      {
        name: "overview",
        entry: "/ui/Overview.mjs",
        slots: ["dashboard.home"],
        suggested: true,
        supported_sizes: ["half", "full"],
        default_size: "half",
        settings_schema: {
          type: "object",
          properties: {
            show_recent: { type: "boolean", default: true },
          },
        },
      },
      {
        name: "agent-summary",
        entry: "/ui/Agent.mjs",
        slots: ["dashboard.agent_card"],
        suggested: true,
      },
    ],
  },
  {
    install_id: 8,
    name: "disabled-app",
    version: "1.0.0",
    status: "disabled",
    ui_components: [
      {
        name: "overview",
        entry: "/ui/Overview.mjs",
        slots: ["dashboard.home"],
        suggested: true,
      },
    ],
  },
];

describe("generic app contributions", () => {
  test("discovers running app components by slot without app-name special cases", () => {
    const found = contributionsFor(installed, "dashboard.home");
    expect(found.map((item) => item.key)).toEqual([
      contributionKey("work-ledger", "overview"),
    ]);
  });

  test("keeps user-managed Home widgets opt-in even when an app suggests them", () => {
    const found = contributionsFor(installed, "dashboard.home");
    expect(enabledContributionKeys(found, "dashboard.home", {})).toEqual([]);
    const selected: ProjectUILayout = {
      slots: { "dashboard.home": ["work-ledger:overview"] },
    };
    expect(enabledContributionKeys(found, "dashboard.home", selected)).toEqual([
      "work-ledger:overview",
    ]);
  });

  test("creates explicit widget instances with manifest size and setting defaults", () => {
    const found = contributionsFor(installed, "dashboard.home");
    const widgets = widgetInstancesFor(found, "dashboard.home", {
      slots: { "dashboard.home": ["work-ledger:overview"] },
    });
    expect(widgets).toHaveLength(1);
    expect(widgets[0].component).toBe("work-ledger:overview");
    expect(widgets[0].size).toBe("half");
    expect(widgets[0].settings).toEqual({ show_recent: true });
    expect(supportedWidgetSizes(found[0].spec)).toEqual(["half", "full"]);
    expect(defaultWidgetSettings(found[0].spec)).toEqual({ show_recent: true });
  });

  test("retains suggested defaults for embedded slots without a layout editor", () => {
    const found = contributionsFor(installed, "dashboard.agent_card");
    expect(enabledContributionKeys(found, "dashboard.agent_card", {})).toEqual([
      "work-ledger:agent-summary",
    ]);
  });

  test("preserves explicit order, duplicate instances, sizes, and settings", () => {
    const found = contributionsFor(installed, "dashboard.home");
    const widgets = widgetInstancesFor(found, "dashboard.home", {
      slots: {
        "dashboard.home": [
          {
            id: "second",
            component: "work-ledger:overview",
            size: "full",
            settings: { show_recent: false },
          },
          {
            id: "first",
            component: "work-ledger:overview",
            size: "half",
          },
        ],
      },
    });
    expect(widgets.map((widget) => widget.id)).toEqual(["second", "first"]);
    expect(widgets.map((widget) => widget.size)).toEqual(["full", "half"]);
    expect(widgets[0].settings).toEqual({ show_recent: false });
    expect(widgets[1].settings).toEqual({ show_recent: true });
  });

  test("reads legacy string layouts without changing their order", () => {
    const found = contributionsFor(installed, "dashboard.home");
    const widgets = widgetInstancesFor(found, "dashboard.home", {
      slots: { "dashboard.home": ["work-ledger:overview"] },
    });
    expect(widgets.map((widget) => widget.component)).toEqual([
      "work-ledger:overview",
    ]);
    expect(widgets[0].id).toStartWith("legacy:");
  });

  test("reorders instances and strips runtime contribution metadata before persistence", () => {
    const found = contributionsFor(installed, "dashboard.home");
    const resolved = widgetInstancesFor(found, "dashboard.home", {
      slots: {
        "dashboard.home": [
          { id: "a", component: "work-ledger:overview", size: "half" },
          { id: "b", component: "work-ledger:overview", size: "full" },
        ],
      },
    });
    expect(reorderWidgetInstances(resolved, "b", "a").map((item) => item.id)).toEqual([
      "b",
      "a",
    ]);
    expect(serializeWidgetInstances(resolved)).toEqual([
      {
        id: "a",
        component: "work-ledger:overview",
        size: "half",
        settings: { show_recent: true },
      },
      {
        id: "b",
        component: "work-ledger:overview",
        size: "full",
        settings: { show_recent: true },
      },
    ]);
  });

  test("uses generic panel metadata for preferred sidebar apps", () => {
    const apps = [
      { name: "work-ledger", suggested: true },
      { name: "billing", suggested: false },
    ];
    expect(preferredSidebarAppNames(apps, {})).toEqual(["work-ledger"]);
    expect(preferredSidebarAppNames(apps, { sidebar: ["billing"] })).toEqual([
      "billing",
    ]);
  });
});
