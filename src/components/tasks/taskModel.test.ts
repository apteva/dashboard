import { describe, expect, test } from "bun:test";
import type { AgentTask } from "../../api";
import {
  countAgentTasks,
  mergeAgentTaskSnapshot,
  operationalTaskRows,
  sortAgentTasks,
  taskIsActive,
  taskIsTopLevel,
  taskNeedsAttention,
  taskOwnerLabel,
} from "./taskModel";

function task(id: string, state: AgentTask["state"], patch: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    agent_id: 1,
    project_id: "project-one",
    title: id,
    state,
    assigned_thread_id: "main",
    created_at: "2026-07-30T10:00:00Z",
    updated_at: "2026-07-30T10:00:00Z",
    ...patch,
  };
}

describe("task model", () => {
  test("puts attention and active work before terminal history", () => {
    expect(sortAgentTasks([
      task("done", "completed"),
      task("running", "running"),
      task("blocked", "blocked"),
      task("failed", "failed"),
    ]).map((row) => row.id)).toEqual(["blocked", "failed", "running", "done"]);
  });

  test("merges live snapshots without duplicating task cards", () => {
    const before = [task("one", "queued"), task("two", "running")];
    const after = mergeAgentTaskSnapshot(
      before,
      task("one", "running", { progress: 40, updated_at: "2026-07-30T10:01:00Z" }),
      () => true,
    );
    expect(after).toHaveLength(2);
    expect(after.filter((row) => row.id === "one")).toHaveLength(1);
    expect(after.find((row) => row.id === "one")?.progress).toBe(40);
  });

  test("removes a task when a live state no longer matches the current view", () => {
    const after = mergeAgentTaskSnapshot(
      [task("one", "running")],
      task("one", "completed"),
      taskIsActive,
    );
    expect(after).toEqual([]);
  });

  test("distinguishes task ownership and delivery failures", () => {
    expect(taskOwnerLabel(task("main", "queued"))).toBe("Main");
    expect(taskOwnerLabel(task("chat", "running", { assigned_thread_id: "chat-conv-1" }))).toBe("Conversation");
    expect(taskOwnerLabel(task("worker", "running", { assigned_thread_id: "worker-a" }))).toBe("Worker");
    expect(taskNeedsAttention(task("delivery", "completed", { completion_delivery_status: "failed" }))).toBe(true);
  });

  test("derives live tab totals from the same task snapshots as the cards", () => {
    expect(countAgentTasks([
      task("queued", "queued"),
      task("running", "running"),
      task("waiting", "waiting"),
      task("blocked", "blocked"),
      task("complete", "completed"),
      task("failed", "failed"),
      task("cancelled", "cancelled"),
    ])).toEqual({
      active: 4,
      queued: 1,
      running: 1,
      waiting: 1,
      blocked: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
      scheduled: 0,
      paused: 0,
    });
  });

  test("keeps schedule parents out of active work and counts paused separately", () => {
    const scheduled = task("schedule", "waiting", {
      schedule_kind: "cron",
      schedule_expression: "0 9 * * *",
      schedule_timezone: "UTC",
      schedule_enabled: true,
    });
    const paused = task("paused", "waiting", {
      schedule_kind: "interval",
      schedule_expression: "1h",
      schedule_timezone: "UTC",
      schedule_enabled: false,
    });
    expect(taskIsActive(scheduled)).toBe(false);
    expect(countAgentTasks([scheduled, paused])).toMatchObject({
      active: 0,
      waiting: 0,
      scheduled: 1,
      paused: 1,
    });
  });

  test("keeps scheduled executions nested under their single visible schedule", () => {
    const schedule = task("schedule", "waiting", {
      schedule_kind: "once",
      schedule_expression: "2026-07-30T10:10:00Z",
      schedule_enabled: true,
    });
    const occurrence = task("occurrence", "running", {
      parent_task_id: schedule.id,
      schedule_occurrence_key: "scheduled:2026-07-30T10:10:00Z",
    });
    expect(taskIsTopLevel(schedule)).toBe(true);
    expect(taskIsTopLevel(occurrence)).toBe(false);
    expect([schedule, occurrence].filter(taskIsTopLevel).map((row) => row.id)).toEqual(["schedule"]);
  });

  test("shows one operational failure for a completed one-time schedule", () => {
    const schedule = task("schedule", "failed", {
      schedule_kind: "once",
      schedule_expression: "2026-07-30T10:10:00Z",
      schedule_enabled: false,
    });
    const occurrence = task("occurrence", "failed", {
      parent_task_id: schedule.id,
      schedule_occurrence_key: "scheduled:2026-07-30T10:10:00Z",
    });
    const operational = operationalTaskRows([schedule, occurrence]);
    expect(operational.map((row) => row.id)).toEqual(["schedule"]);
    expect(countAgentTasks(operational).failed).toBe(1);
  });

  test("keeps a failed recurring run visible beside its waiting schedule", () => {
    const schedule = task("schedule", "waiting", {
      schedule_kind: "cron",
      schedule_expression: "0 9 * * *",
      schedule_enabled: true,
    });
    const occurrence = task("occurrence", "failed", {
      parent_task_id: schedule.id,
      schedule_occurrence_key: "scheduled:2026-07-30T09:00:00Z",
    });
    expect(operationalTaskRows([schedule, occurrence]).map((row) => row.id)).toEqual([
      "schedule",
      "occurrence",
    ]);
  });
});
