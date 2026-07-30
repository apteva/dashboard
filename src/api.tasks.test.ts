import { describe, expect, test } from "bun:test";
import { agentTaskListPath } from "./api";

describe("task API paths", () => {
  test("builds a project-scoped active task query", () => {
    expect(agentTaskListPath({
      projectId: "project one",
      states: ["queued", "running", "waiting", "blocked"],
      limit: 200,
    })).toBe("/tasks?project_id=project+one&states=queued%2Crunning%2Cwaiting%2Cblocked&limit=200");
  });

  test("can scope live conversation task cards to one agent and conversation", () => {
    expect(agentTaskListPath({
      projectId: "project-one",
      agentId: 14,
      originConversationId: "conv-example",
      limit: 20,
    })).toBe("/tasks?project_id=project-one&agent_id=14&origin_conversation_id=conv-example&limit=20");
  });

  test("can request the caller's accessible projects for Monitor", () => {
    expect(agentTaskListPath({
      allProjects: true,
      limit: 500,
    })).toBe("/tasks?all=1&limit=500");
  });
});
