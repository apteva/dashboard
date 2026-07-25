import { describe, expect, test } from "bun:test";
import type { Agent, CurrentStatusMessageRow } from "../../api";
import { selectAgentOperations } from "./HomePanels";

const NOW = Date.parse("2026-07-25T12:00:00Z");

function agent(id: number, name: string, status = "stopped"): Agent {
  return {
    id,
    name,
    status,
    user_id: 1,
    directive: "",
    mode: "autonomous",
    config: "",
    port: 0,
    pid: 0,
    created_at: "2026-07-01T00:00:00Z",
  };
}

function reported(
  instanceId: number,
  state: CurrentStatusMessageRow["state"],
  ageMs: number,
  stale = false,
): CurrentStatusMessageRow {
  return {
    instance_id: instanceId,
    instance_name: `Agent ${instanceId}`,
    project_id: "default",
    title: `${state} work`,
    state,
    stale,
    message: {
      created_at: new Date(NOW - ageMs).toISOString(),
    },
  } as CurrentStatusMessageRow;
}

describe("selectAgentOperations", () => {
  test("includes running agents and fresh current work", () => {
    const rows = selectAgentOperations(
      [
        agent(1, "Running", "running"),
        agent(2, "Blocked"),
        agent(3, "Idle"),
      ],
      [reported(2, "blocked", 60_000)],
      NOW,
    );

    expect(rows.map((row) => row.agent.id)).toEqual([2, 1]);
    expect(rows[0]?.status?.state).toBe("blocked");
    expect(rows[1]?.status).toBeUndefined();
  });

  test("orders blocked, waiting, working, running, then recent completion", () => {
    const rows = selectAgentOperations(
      [
        agent(1, "Running", "running"),
        agent(2, "Working"),
        agent(3, "Waiting"),
        agent(4, "Blocked"),
        agent(5, "Completed"),
      ],
      [
        reported(2, "working", 60_000),
        reported(3, "waiting", 60_000),
        reported(4, "blocked", 60_000),
        reported(5, "completed", 60_000),
      ],
      NOW,
    );

    expect(rows.map((row) => row.agent.id)).toEqual([4, 3, 2, 1, 5]);
  });

  test("does not present stale work as current but keeps a running agent", () => {
    const rows = selectAgentOperations(
      [agent(1, "Running", "running"), agent(2, "Stopped")],
      [
        reported(1, "waiting", 60 * 60_000, true),
        reported(2, "working", 60 * 60_000, true),
      ],
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent.id).toBe(1);
    expect(rows[0]?.status).toBeUndefined();
  });

  test("keeps only recent completed work and chooses the newest status per agent", () => {
    const rows = selectAgentOperations(
      [agent(1, "Recent"), agent(2, "Old")],
      [
        reported(1, "working", 10 * 60_000),
        reported(1, "completed", 60_000),
        reported(2, "completed", 31 * 60_000),
      ],
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent.id).toBe(1);
    expect(rows[0]?.status?.state).toBe("completed");
  });
});
