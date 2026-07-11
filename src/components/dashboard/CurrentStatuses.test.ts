import { describe, expect, test } from "bun:test";
import type { CurrentStatusMessageRow } from "../../api";
import { ageCurrentStatusRows } from "./CurrentStatuses";

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
