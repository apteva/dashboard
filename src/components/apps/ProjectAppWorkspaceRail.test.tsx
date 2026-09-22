import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../i18n";
import { ProjectAppWorkspaceRail } from "./ProjectAppWorkspaceRail";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("ProjectAppWorkspaceRail", () => {
  test("keeps app-owned details and restores eligible contextual widgets", async () => {
    await i18n.changeLanguage("en");
    const requested: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const path = String(input);
      requested.push(path);
      if (path.startsWith("/api/ui/contributions")) {
        return Response.json({
          contributions: [{ app: "tasks", component: "agent-tasks", eligible: true }],
        });
      }
      return Response.json([{
        install_id: 41,
        name: "tasks",
        display_name: "Tasks",
        version: "3.5.3",
        status: "running",
        ui_components: [{
          name: "agent-tasks",
          entry: "/ui/AgentTasksWidget.mjs",
          label: "Tasks",
          suggested: true,
          slots: ["dashboard.thread_sidebar"],
        }],
      }]);
    }) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <ProjectAppWorkspaceRail
          projectId="workspace-rail-project"
          agentId={286}
          threadId="opaque-thread-7f2"
          context={{ app: "conversations", kind: "conversation", id: "conv-7" }}
        >
          <div>Conversation facts</div>
        </ProjectAppWorkspaceRail>
      </MemoryRouter>,
    );

    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Conversation facts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add or manage widgets" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Tasks" })).toBeTruthy());
    expect(requested.some((path) =>
      path.includes("/api/ui/contributions") &&
      path.includes("agent_id=286") &&
      path.includes("thread_id=opaque-thread-7f2")
    )).toBe(true);
  });

  test("does not expose an ineligible widget", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/ui/contributions")) {
        return Response.json({
          contributions: [{ app: "tasks", component: "agent-tasks", eligible: false }],
        });
      }
      return Response.json([{
        install_id: 42,
        name: "tasks",
        display_name: "Tasks",
        version: "3.5.3",
        status: "running",
        ui_components: [{
          name: "agent-tasks",
          entry: "/ui/AgentTasksWidget.mjs",
          label: "Tasks",
          suggested: true,
          slots: ["dashboard.thread_sidebar"],
        }],
      }]);
    }) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <ProjectAppWorkspaceRail projectId="workspace-rail-ineligible" agentId={901}>
          <div>Details only</div>
        </ProjectAppWorkspaceRail>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Details only")).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Tasks" })).toBeNull());
  });
});
