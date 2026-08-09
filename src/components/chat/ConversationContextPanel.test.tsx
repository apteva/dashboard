import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
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
  test("keeps chat generic and reserves the side context for app contributions", async () => {
    const fetchMock = mock(
      async () =>
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
    fireEvent.click(screen.getByRole("tab", { name: "Apps" }));
    await waitFor(() =>
      expect(
        screen.getByText("No app components are available for this thread."),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("tab", { name: "Apps" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/apps?project_id=project-one",
      expect.anything(),
    );
  });
});
