import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  agentTasks,
  type AgentTask,
  type AgentTaskListResponse,
  type TelemetryEvent,
} from "../api";
import { useTasks } from "./useTasks";

const originalList = agentTasks.list;
const originalBridge = window.__aptevaTelemetryBus;
let liveListener: ((event: TelemetryEvent) => void) | null = null;

function task(patch: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-live",
    agent_id: 14,
    project_id: "project-live-test",
    title: "Live audit",
    state: "queued",
    assigned_thread_id: "main",
    created_at: "2026-07-30T10:00:00Z",
    updated_at: "2026-07-30T10:00:00Z",
    ...patch,
  };
}

beforeEach(() => {
  liveListener = null;
  window.__aptevaTelemetryBus = {
    setProjectId() {},
    currentProjectId: () => "project-live-test",
    connectionState: () => "open",
    subscribeState: () => () => {},
    subscribe(_instanceId, listener) {
      liveListener = listener;
      return () => {
        if (liveListener === listener) liveListener = null;
      };
    },
  };
});

afterEach(() => {
  agentTasks.list = originalList;
  window.__aptevaTelemetryBus = originalBridge;
});

describe("useTasks", () => {
  test("inserts a task immediately from the create response", async () => {
    agentTasks.list = mock(async () => ({
      enabled: true,
      tasks: [],
      counts: { active: 0, queued: 0, running: 0, waiting: 0, blocked: 0, completed: 0, failed: 0, cancelled: 0 },
    } satisfies AgentTaskListResponse));
    const { result, unmount } = renderHook(() => useTasks({
      projectId: "project-live-test",
      limit: 20,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const created = task({ id: "task-created-from-response" });
    act(() => result.current.upsert(created));

    expect(result.current.tasks.map((row) => row.id)).toEqual(["task-created-from-response"]);

    // A matching SSE snapshot updates the existing card rather than adding a
    // second copy after the API response was rendered.
    act(() => liveListener?.({
      id: "task-created-live-event",
      instance_id: 14,
      thread_id: "main",
      type: "task.created",
      time: created.updated_at,
      data: { task: created },
    }));
    expect(result.current.tasks).toHaveLength(1);
    unmount();
  });

  test("applies live SSE snapshots immediately without duplicate rows", async () => {
    agentTasks.list = mock(async () => ({
      enabled: true,
      tasks: [task()],
      counts: { active: 1, queued: 1, running: 0, waiting: 0, blocked: 0, completed: 0, failed: 0, cancelled: 0 },
    } satisfies AgentTaskListResponse));
    const { result, unmount } = renderHook(() => useTasks({
      projectId: "project-live-test",
      limit: 20,
    }));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    const updated = task({
      state: "running",
      progress: 45,
      current_step: "Checking inventory",
      updated_at: "2026-07-30T10:01:00Z",
    });
    act(() => liveListener?.({
      id: "task-event-live",
      instance_id: 14,
      thread_id: "main",
      type: "task.updated",
      time: updated.updated_at,
      data: { task: updated },
    }));

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].state).toBe("running");
    expect(result.current.tasks[0].progress).toBe(45);
    unmount();
  });

  test("treats a feature-gated 404 as disabled rather than an error", async () => {
    agentTasks.list = mock(async () => {
      const error: any = new Error("not found");
      error.status = 404;
      throw error;
    });
    const { result, unmount } = renderHook(() => useTasks({
      projectId: "project-disabled-test",
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBe("");
    unmount();
  });

  test("ignores another project's live task and reloads after an SSE gap", async () => {
    let calls = 0;
    agentTasks.list = mock(async () => {
      calls += 1;
      return {
        enabled: true,
        tasks: [task(calls > 1 ? { state: "running", progress: 25 } : {})],
      } satisfies AgentTaskListResponse;
    });
    const { result, unmount } = renderHook(() => useTasks({
      projectId: "project-live-test",
    }));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    act(() => liveListener?.({
      id: "other-project-event",
      instance_id: 99,
      thread_id: "main",
      type: "task.created",
      time: "2026-07-30T10:02:00Z",
      data: { task: task({ id: "other", agent_id: 99, project_id: "other-project" }) },
    }));
    expect(result.current.tasks.map((row) => row.id)).toEqual(["task-live"]);

    act(() => window.dispatchEvent(new Event("apteva.telemetry.gap")));
    await waitFor(() => expect(result.current.tasks[0]?.progress).toBe(25));
    expect(calls).toBeGreaterThanOrEqual(2);
    unmount();
  });

  test("supports an all-project Monitor scope and accepts each visible project event", async () => {
    let requestedAllProjects = false;
    agentTasks.list = mock(async (options) => {
      requestedAllProjects = options.allProjects === true;
      return {
        enabled: true,
        tasks: [],
        counts: { active: 0, queued: 0, running: 0, waiting: 0, blocked: 0, completed: 0, failed: 0, cancelled: 0 },
      } satisfies AgentTaskListResponse;
    });
    const { result, unmount } = renderHook(() => useTasks({
      allProjects: true,
      limit: 500,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(requestedAllProjects).toBe(true);

    const visible = task({ id: "all-project-task", project_id: "project-two" });
    act(() => liveListener?.({
      id: "all-project-task-event",
      instance_id: visible.agent_id,
      thread_id: "main",
      type: "task.created",
      time: visible.updated_at,
      data: { task: visible },
    }));
    expect(result.current.tasks.map((row) => row.id)).toEqual(["all-project-task"]);
    unmount();
  });
});
