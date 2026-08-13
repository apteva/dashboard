import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "../../i18n";
import type { Agent, ChatRow } from "../../api";
import { ConversationContextPanel } from "./ConversationContextPanel";

const originalFetch = globalThis.fetch;
const agent = {
  id: 286,
  name: "Skilled Agent",
  status: "stopped",
  project_id: "project-one",
} as Agent;
const conversation: ChatRow = {
  id: "conv-related-work",
  instance_id: agent.id,
  agent_ids: [agent.id],
  project_id: "project-one",
  kind: "direct",
  title: "CRM planning",
  created_at: "2026-08-07T10:00:00Z",
  updated_at: "2026-08-07T10:00:00Z",
  thread_id: "opaque-thread-7f2",
};

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("ConversationContextPanel", () => {
  test("keeps chat generic and exposes contextual widgets without a dead Apps tab", async () => {
    const fetchMock = mock(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(
      <MemoryRouter>
        <ConversationContextPanel
          conversation={conversation}
          agents={[agent]}
          instance={agent}
          onChanged={() => {}}
          onRemoved={() => {}}
        />
      </MemoryRouter>,
    );
    expect(
      screen
        .getByRole("tab", { name: "Details" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByRole("tab", { name: "Apps" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add or manage widgets" })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]).startsWith("/api/apps?project_id=project-one"),
    )).toBe(true);
  });

  test("renders each eligible thread contribution as its own named tab", async () => {
    const contextualConversation = {
      ...conversation,
      id: "conv-contextual",
      project_id: "project-two",
      thread_id: "opaque-thread-two",
    };
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/ui/contributions")) {
        return new Response(JSON.stringify({
          contributions: [{ app: "tasks", component: "agent-tasks", eligible: true }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([{
        install_id: 41,
        name: "tasks",
        display_name: "Tasks",
        version: "3.2.6",
        status: "running",
        ui_components: [{
          name: "agent-tasks",
          entry: "/ui/AgentTasksWidget.mjs",
          label: "Tasks",
          suggested: true,
          slots: ["dashboard.thread_sidebar"],
        }],
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <ConversationContextPanel
          conversation={contextualConversation}
          agents={[agent]}
          instance={{ ...agent, project_id: "project-two" }}
          onChanged={() => {}}
          onRemoved={() => {}}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "Tasks" })).toBeTruthy());
    expect(screen.queryByRole("tab", { name: "Apps" })).toBeNull();
  });
});
