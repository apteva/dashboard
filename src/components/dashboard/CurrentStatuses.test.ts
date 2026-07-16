import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentStatusMessageRow } from "../../api";
import { AgentCurrentStatus, ageCurrentStatusRows } from "./CurrentStatuses";

const NOW = Date.parse("2026-07-11T12:00:00Z");

function status(state: CurrentStatusMessageRow["state"], ageMs: number): CurrentStatusMessageRow {
  return {
    state,
    stale: false,
    title: "Example status",
    instance_id: 1,
    instance_name: "Agent",
    project_id: "default",
    message: { created_at: new Date(NOW - ageMs).toISOString() },
  } as CurrentStatusMessageRow;
}

describe("ageCurrentStatusRows", () => {
  test("keeps completed statuses indefinitely", () => {
    const [row] = ageCurrentStatusRows([status("completed", 7 * 24 * 60 * 60_000)], NOW);
    expect(row?.state).toBe("completed");
    expect(row?.stale).toBe(false);
  });

  test("marks active statuses stale after thirty minutes", () => {
    const [row] = ageCurrentStatusRows([status("working", 30 * 60_000 + 1)], NOW);
    expect(row?.stale).toBe(true);
  });

  test("keeps old active statuses visible but stale", () => {
    const [row] = ageCurrentStatusRows([status("blocked", 7 * 24 * 60 * 60_000)], NOW);
    expect(row?.state).toBe("blocked");
    expect(row?.stale).toBe(true);
  });
});

describe("AgentCurrentStatus", () => {
  test("reserves and labels the next-step row when no next work exists", () => {
    const html = renderToStaticMarkup(createElement(AgentCurrentStatus, {
      status: status("completed", 1_000),
      compact: true,
      showFallback: true,
      showAge: true,
      showNextFallback: true,
    }));
    expect(html).toContain("Next");
    expect(html).toContain("No pending work");
    expect(html).toContain("min-h-[66px]");
  });

  test("shows the same next-step row when no status has been reported", () => {
    const html = renderToStaticMarkup(createElement(AgentCurrentStatus, {
      compact: true,
      showFallback: true,
      showAge: true,
      showNextFallback: true,
    }));
    expect(html).toContain("No current status reported");
    expect(html).toContain("No pending work");
  });
});
