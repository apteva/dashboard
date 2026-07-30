import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { CurrentStatusMessageRow } from "../../api";
import {
  MonitorSchedules,
  MonitorStatuses,
  selectUpcomingAgentSchedules,
} from "./MonitorStatuses";

function completedStatus(next?: string, nextAt?: string): CurrentStatusMessageRow {
  return {
    instance_id: 14,
    instance_name: "Personal Agent",
    project_id: "default",
    updated_at: new Date().toISOString(),
    title: "Hourly inbox check completed",
    state: "completed",
    next,
    next_at: nextAt,
    stale: false,
    message: {
      created_at: "2026-07-01T00:00:00Z",
    },
  } as CurrentStatusMessageRow;
}

describe("MonitorStatuses", () => {
  test("keeps completed recurring status visibly upcoming even when its next run is far away", () => {
    const nextAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(MonitorStatuses, {
        agents: [],
        statuses: [completedStatus("Run the next weekly inbox review", nextAt)],
        projectNames: new Map([["default", "Default"]]),
        showProjects: false,
      }),
    ));

    expect(html).toContain("Upcoming");
    expect(html).toContain("Run the next weekly inbox review");
    expect(html).toContain("Updated ");
    expect(html).not.toContain("Latest completed");
  });

  test("keeps terminal work without a next action under latest completed", () => {
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(MonitorStatuses, {
        agents: [],
        statuses: [completedStatus()],
        projectNames: new Map(),
        showProjects: false,
      }),
    ));

    expect(html).toContain("Latest completed");
    expect(html).not.toContain(">Upcoming<");
  });
});

describe("MonitorSchedules", () => {
  test("uses only schedule metadata and ignores legacy status progress", () => {
    const scheduled = completedStatus(
      "Run the next weekly inbox review",
      new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    );
    scheduled.progress = 100;
    const unscheduled = completedStatus();
    unscheduled.instance_id = 15;
    unscheduled.instance_name = "Unscheduled";
    expect(selectUpcomingAgentSchedules([scheduled, unscheduled]).map((row) => row.instance_id)).toEqual([14]);

    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(MonitorSchedules, {
        agents: [],
        statuses: [scheduled, unscheduled],
        projectNames: new Map([["default", "Default"]]),
        showProjects: false,
      }),
    ));
    expect(html).toContain("Agent schedules");
    expect(html).toContain("Run the next weekly inbox review");
    expect(html).not.toContain("100%");
    expect(html).not.toContain("Hourly inbox check completed");
  });
});
