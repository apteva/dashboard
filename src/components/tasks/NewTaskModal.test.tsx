import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  agentTasks,
  type Agent,
  type AgentTask,
} from "../../api";
import { NewTaskModal } from "./NewTaskModal";

const originalCreate = agentTasks.create;

const agent = {
  id: 14,
  name: "Personal Agent",
  status: "running",
  project_id: "project-one",
} as Agent;

const createdTask: AgentTask = {
  id: "task-created",
  agent_id: 14,
  project_id: "project-one",
  title: "Prepare the briefing",
  description: "Include verified campaign results.",
  state: "queued",
  assigned_thread_id: "main",
  handoff_delivery_status: "delivered",
  created_at: "2026-07-30T08:00:00Z",
  updated_at: "2026-07-30T08:00:00Z",
};

afterEach(() => {
  cleanup();
  agentTasks.create = originalCreate;
});

describe("NewTaskModal", () => {
  test("creates durable work for the selected agent main thread", async () => {
    const create = mock(async () => ({
      task: createdTask,
      created: true,
    }));
    const onCreated = mock(() => {});
    agentTasks.create = create;

    render(
      <NewTaskModal
        open
        agents={[agent]}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "  Prepare the briefing  " },
    });
    fireEvent.change(screen.getByLabelText(/Instructions/), {
      target: { value: "  Include verified campaign results.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 14,
      title: "Prepare the briefing",
      description: "Include verified campaign results.",
      idempotency_key: expect.stringMatching(/^task-ui-/),
    })));
    expect(onCreated).toHaveBeenCalledWith(createdTask, undefined);
  });

  test("returns a persisted offline delivery warning without losing the task", async () => {
    const create = mock(async () => ({
      task: { ...createdTask, handoff_delivery_status: "failed" },
      created: true,
      delivery_warning: "task saved and will be delivered when the agent is available",
    }));
    const onCreated = mock(() => {});
    agentTasks.create = create;

    render(
      <NewTaskModal
        open
        agents={[{ ...agent, status: "stopped" } as Agent]}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Queue this work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-created" }),
      "task saved and will be delivered when the agent is available",
    ));
  });

  test("reuses the same idempotency key when a failed request is retried", async () => {
    let attempts = 0;
    const create = mock(async (_input: Parameters<typeof agentTasks.create>[0]) => {
      attempts++;
      if (attempts === 1) throw new Error("Temporary network failure");
      return { task: createdTask, created: true };
    });
    agentTasks.create = create;

    render(
      <NewTaskModal
        open
        agents={[agent]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Retry safely" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByText("Temporary network failure")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const first = create.mock.calls[0][0];
    const second = create.mock.calls[1][0];
    expect(first.idempotency_key).toMatch(/^task-ui-/);
    expect(second.idempotency_key).toBe(first.idempotency_key);
  });

  test("creates a recurring task in the same Tasks flow", async () => {
    const scheduledTask: AgentTask = {
      ...createdTask,
      id: "task-scheduled",
      state: "waiting",
      schedule_kind: "cron",
      schedule_expression: "0 9 * * *",
      schedule_timezone: "UTC",
      schedule_enabled: true,
      next_run_at: "2026-07-31T09:00:00Z",
      handoff_delivery_status: undefined,
    };
    const create = mock(async () => ({ task: scheduledTask, created: true }));
    agentTasks.create = create;

    render(
      <NewTaskModal
        open
        agents={[agent]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Daily Patreon check" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "UTC" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule task" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: 14,
      title: "Daily Patreon check",
      description: undefined,
      idempotency_key: expect.stringMatching(/^task-ui-/),
      schedule: {
        kind: "cron",
        cron: "0 9 * * *",
        timezone: "UTC",
      },
    })));
  });
});
