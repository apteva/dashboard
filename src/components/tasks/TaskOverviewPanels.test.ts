import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Agent, AgentTask } from "../../api";
import { HomeTasksPanel, MonitorTasksPanel } from "./TaskOverviewPanels";

const agent: Agent = {
  id: 14,
  name: "Personal Agent",
  status: "running",
  user_id: 1,
  directive: "",
  mode: "autonomous",
  config: "",
  port: 0,
  pid: 0,
  project_id: "default",
  created_at: "2026-07-01T00:00:00Z",
};

const runningTask: AgentTask = {
  id: "task-live-overview",
  agent_id: agent.id,
  project_id: "default",
  title: "Review the CRM pipeline",
  state: "running",
  progress: 45,
  current_step: "Checking active opportunities",
  assigned_thread_id: "main",
  created_at: "2026-07-30T10:00:00Z",
  updated_at: "2026-07-30T10:01:00Z",
};

describe("task overview panels", () => {
  test("Home presents task progress as the primary active-work signal", () => {
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(HomeTasksPanel, {
        agents: [agent],
        tasks: [runningTask],
        enabled: true,
        loading: false,
      }),
    ));
    expect(html).toContain("Active work");
    expect(html).toContain("Review the CRM pipeline");
    expect(html).toContain("Checking active opportunities");
    expect(html).toContain("45%");
  });

  test("Monitor renders the all-project task view", () => {
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      {},
      createElement(MonitorTasksPanel, {
        agents: [agent],
        tasks: [runningTask],
        enabled: true,
        loading: false,
        allProjects: true,
      }),
    ));
    expect(html).toContain("Live work");
    expect(html).toContain("across accessible projects");
    expect(html).toContain("Review the CRM pipeline");
  });
});
