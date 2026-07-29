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

  test("uses the explicit status update time instead of the message creation fallback", () => {
    const row = status("working", 7 * 24 * 60 * 60_000);
    row.updated_at = new Date(NOW - 60_000).toISOString();

    const [aged] = ageCurrentStatusRows([row], NOW);

    expect(aged?.stale).toBe(false);
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

  test("keeps a stale blocked status visually stale", () => {
    const blocked = status("blocked", 10 * 24 * 60 * 60_000);
    blocked.stale = true;
    const html = renderToStaticMarkup(createElement(AgentCurrentStatus, {
      status: blocked,
      compact: true,
      showAge: true,
      showNextFallback: true,
    }));
    expect(html).toContain("bg-text-dim/15 text-text-dim");
    expect(html).toContain("Last reported");
    expect(html).toContain(">blocked<");
  });

  test("shows when the status changed and the next action with its due time", () => {
    const current = status("completed", 7 * 24 * 60 * 60_000);
    current.updated_at = new Date().toISOString();
    current.next = "Run the next inbox check";
    current.next_at = new Date(Date.now() + 60 * 60_000).toISOString();

    const html = renderToStaticMarkup(createElement(AgentCurrentStatus, {
      status: current,
      compact: true,
      showAge: true,
      showNextFallback: true,
      statusLabel: "Latest work",
    }));

    expect(html).toContain("Latest work");
    expect(html).toMatch(/Updated (?:just now|\d+s ago)/);
    expect(html).toContain("Run the next inbox check");
    expect(html).toContain("<time");
    expect(html).toContain("in 1h");
  });
});
