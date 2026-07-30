import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { agentTasks, type AgentTask, type AgentTaskEvent } from "../../api";
import { TaskDetailDrawer } from "./TaskComponents";

const originalEvents = agentTasks.events;
const originalSteps = agentTasks.steps;
const originalRuns = agentTasks.runs;
const originalCancel = agentTasks.cancel;
const originalPause = agentTasks.pause;
const originalResume = agentTasks.resume;
const originalRunNow = agentTasks.runNow;
const originalBridge = window.__aptevaTelemetryBus;

const row: AgentTask = {
  id: "task-cancel",
  agent_id: 14,
  project_id: "project-one",
  title: "Import customers",
  description: "Import and validate the customer file.",
  state: "running",
  progress: 40,
  current_step: "Validating rows",
  assigned_thread_id: "worker-import",
  origin_conversation_id: "conv-origin",
  created_at: "2026-07-30T10:00:00Z",
  updated_at: "2026-07-30T10:01:00Z",
};

afterEach(() => {
  cleanup();
  agentTasks.events = originalEvents;
  agentTasks.steps = originalSteps;
  agentTasks.runs = originalRuns;
  agentTasks.cancel = originalCancel;
  agentTasks.pause = originalPause;
  agentTasks.resume = originalResume;
  agentTasks.runNow = originalRunNow;
  window.__aptevaTelemetryBus = originalBridge;
});

describe("TaskDetailDrawer", () => {
  test("cancels with an optional reason through the in-app confirmation UI", async () => {
    agentTasks.events = mock(async () => ({ events: [] }));
    agentTasks.steps = mock(async () => ({ steps: [] }));
    agentTasks.runs = mock(async () => ({ runs: [] }));
    const cancel = mock(async (_id: string, reason?: string) => ({
      task: { ...row, state: "cancelled" as const, error: reason },
      changed: true,
    }));
    agentTasks.cancel = cancel;
    const changed = mock(() => {});

    render(
      <MemoryRouter>
        <TaskDetailDrawer task={row} onClose={() => {}} onChanged={changed} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    fireEvent.change(screen.getByPlaceholderText("Tell the agent why this work is being stopped."), {
      target: { value: "Operator changed priorities" },
    });
    const buttons = screen.getAllByRole("button", { name: "Cancel task" });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(cancel).toHaveBeenCalledWith("task-cancel", "Operator changed priorities"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Keep task")).toBeNull();
  });

  test("shows durable progress, completion results, and errors in the color-coded timeline", async () => {
    const events: AgentTaskEvent[] = [
      {
        id: "event-running",
        task_id: row.id,
        agent_id: row.agent_id,
        event_type: "state_changed",
        thread_id: "main",
        from_state: "queued",
        to_state: "running",
        data: {
          state: "running",
          progress: 20,
          current_step: "Reviewing conversations, recent contact activity, and active opportunity inventory.",
        },
        created_at: "2026-07-30T10:01:00Z",
      },
      {
        id: "event-blocked",
        task_id: row.id,
        agent_id: row.agent_id,
        event_type: "state_changed",
        thread_id: "worker-checkup",
        from_state: "running",
        to_state: "blocked",
        data: {
          state: "blocked",
          progress: 80,
          error: "CRM access temporarily failed.",
        },
        created_at: "2026-07-30T10:02:00Z",
      },
      {
        id: "event-completed",
        task_id: row.id,
        agent_id: row.agent_id,
        event_type: "state_changed",
        thread_id: "main",
        from_state: "running",
        to_state: "completed",
        data: {
          state: "completed",
          progress: 100,
          result: "CRM checkup completed. No conversations require attention.",
        },
        created_at: "2026-07-30T10:03:00Z",
      },
    ];
    agentTasks.events = mock(async () => ({ events }));
    agentTasks.steps = mock(async () => ({ steps: [] }));
    agentTasks.runs = mock(async () => ({ runs: [] }));

    render(
      <MemoryRouter>
        <TaskDetailDrawer task={row} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Work started")).toBeTruthy();
    expect(screen.getByText("Reviewing conversations, recent contact activity, and active opportunity inventory.")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("Task blocked")).toBeTruthy();
    expect(screen.getByText("CRM access temporarily failed.")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("Task completed")).toBeTruthy();
    expect(screen.getByText("CRM checkup completed. No conversations require attention.")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getAllByText("Main thread")).toHaveLength(2);
    expect(screen.getAllByText("Worker").length).toBeGreaterThan(0);
    expect(screen.getByTestId("task-event-event-running").dataset.eventTone).toBe("active");
    expect(screen.getByTestId("task-event-event-blocked").dataset.eventTone).toBe("danger");
    expect(screen.getByTestId("task-event-event-completed").dataset.eventTone).toBe("success");
  });

  test("renders successive committed progress events immediately from SSE", async () => {
    let liveListener: ((event: any) => void) | null = null;
    window.__aptevaTelemetryBus = {
      setProjectId() {},
      currentProjectId: () => "project-one",
      connectionState: () => "open",
      subscribeState: () => () => {},
      subscribe(_instanceId, listener) {
        liveListener = listener;
        return () => {
          if (liveListener === listener) liveListener = null;
        };
      },
    };
    agentTasks.events = mock(async () => ({ events: [] }));
    agentTasks.steps = mock(async () => ({ steps: [] }));
    agentTasks.runs = mock(async () => ({ runs: [] }));

    render(
      <MemoryRouter>
        <TaskDetailDrawer task={row} onClose={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(agentTasks.events).toHaveBeenCalledTimes(1));

    const emitTaskEvent = (taskEvent: AgentTaskEvent) => {
      liveListener?.({
        id: taskEvent.id,
        instance_id: row.agent_id,
        thread_id: taskEvent.thread_id || "main",
        type: taskEvent.to_state === "completed" ? "task.completed" : "task.updated",
        time: taskEvent.created_at,
        data: { task: { ...row, progress: taskEvent.data?.progress }, task_event: taskEvent },
      });
    };

    act(() => emitTaskEvent({
      id: "event-live-started",
      task_id: row.id,
      agent_id: row.agent_id,
      event_type: "state_changed",
      thread_id: "main",
      from_state: "queued",
      to_state: "running",
      data: { state: "running", progress: 20, current_step: "Reviewing CRM inventory." },
      created_at: "2026-07-30T10:01:00Z",
    }));
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText("Reviewing CRM inventory.")).toBeTruthy();

    act(() => emitTaskEvent({
      id: "event-live-progress",
      task_id: row.id,
      agent_id: row.agent_id,
      event_type: "updated",
      thread_id: "main",
      data: { progress: 65, current_step: "Comparing CRM activity with open opportunities." },
      created_at: "2026-07-30T10:02:00Z",
    }));
    expect(screen.getByText("65%")).toBeTruthy();
    expect(screen.getByText("Comparing CRM activity with open opportunities.")).toBeTruthy();

    act(() => emitTaskEvent({
      id: "event-live-completed",
      task_id: row.id,
      agent_id: row.agent_id,
      event_type: "state_changed",
      thread_id: "main",
      from_state: "running",
      to_state: "completed",
      data: { state: "completed", progress: 100, result: "CRM review complete." },
      created_at: "2026-07-30T10:03:00Z",
    }));
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("CRM review complete.")).toBeTruthy();
    expect(screen.getByTestId("task-event-event-live-started").dataset.eventTone).toBe("active");
    expect(screen.getByTestId("task-event-event-live-completed").dataset.eventTone).toBe("success");
  });

  test("shows a scheduled parent with run history and pause controls", async () => {
    const schedule: AgentTask = {
      ...row,
      id: "task-schedule",
      title: "Daily Patreon check",
      state: "waiting",
      progress: undefined,
      current_step: undefined,
      schedule_kind: "cron",
      schedule_expression: "0 9 * * *",
      schedule_timezone: "UTC",
      schedule_enabled: true,
      next_run_at: "2026-08-01T09:00:00Z",
      assigned_thread_id: "main",
    };
    const run: AgentTask = {
      ...row,
      id: "task-run",
      title: schedule.title,
      state: "completed",
      progress: 100,
      current_step: undefined,
      result: "Patreon posting is healthy.",
      parent_task_id: schedule.id,
      scheduled_for: "2026-07-31T09:00:00Z",
    };
    agentTasks.events = mock(async () => ({ events: [] }));
    agentTasks.steps = mock(async () => ({ steps: [] }));
    agentTasks.runs = mock(async () => ({ runs: [run] }));
    const pause = mock(async () => ({
      task: { ...schedule, schedule_enabled: false },
      changed: true,
    }));
    agentTasks.pause = pause;
    const changed = mock(() => {});

    render(
      <MemoryRouter>
        <TaskDetailDrawer task={schedule} onClose={() => {}} onChanged={changed} />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText("0 9 * * * · UTC")).length).toBeGreaterThan(0);
    expect(screen.getByText("Patreon posting is healthy.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith(schedule.id));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ schedule_enabled: false }));
  });

  test("retries Run now with one stable idempotency key", async () => {
    const schedule: AgentTask = {
      ...row,
      id: "task-run-now-schedule",
      state: "waiting",
      progress: undefined,
      schedule_kind: "interval",
      schedule_expression: "1h0m0s",
      schedule_timezone: "UTC",
      schedule_enabled: true,
      next_run_at: "2026-08-01T09:00:00Z",
      assigned_thread_id: "main",
    };
    const run: AgentTask = {
      ...row,
      id: "task-manual-run",
      parent_task_id: schedule.id,
      state: "queued",
      scheduled_for: "2026-07-30T10:00:00Z",
      assigned_thread_id: "main",
    };
    agentTasks.events = mock(async () => ({ events: [] }));
    agentTasks.steps = mock(async () => ({ steps: [] }));
    agentTasks.runs = mock(async () => ({ runs: [] }));
    let attempts = 0;
    const runNow = mock(async (_taskId: string, _idempotencyKey: string) => {
      attempts++;
      if (attempts === 1) throw new Error("Temporary delivery failure");
      return { task: run, created: false };
    });
    agentTasks.runNow = runNow;

    render(
      <MemoryRouter>
        <TaskDetailDrawer task={schedule} onClose={() => {}} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByText("Temporary delivery failure")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(runNow).toHaveBeenCalledTimes(2));
    const firstKey = runNow.mock.calls[0][1];
    const secondKey = runNow.mock.calls[1][1];
    expect(firstKey).toMatch(/^task-ui-/);
    expect(secondKey).toBe(firstKey);
  });

  test("retains a stored schedule but hides execution controls when scheduling is disabled", async () => {
    const schedule: AgentTask = {
      ...row,
      id: "task-disabled-schedule",
      state: "waiting",
      progress: undefined,
      schedule_kind: "interval",
      schedule_expression: "1h0m0s",
      schedule_timezone: "UTC",
      schedule_enabled: true,
      next_run_at: "2026-08-01T09:00:00Z",
      assigned_thread_id: "main",
    };
    agentTasks.events = mock(async () => ({ events: [] }));
    agentTasks.steps = mock(async () => ({ steps: [] }));
    agentTasks.runs = mock(async () => ({ runs: [] }));

    render(
      <MemoryRouter>
        <TaskDetailDrawer task={schedule} schedulingEnabled={false} onClose={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Scheduling is disabled on this server/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel schedule" })).toBeTruthy();
  });
});
