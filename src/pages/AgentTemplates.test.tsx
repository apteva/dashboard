import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { agentTemplates, type AgentTemplateDetail } from "../api";
import { AgentTemplateDetailPage, AgentTemplates, diffLines } from "./AgentTemplates";

const original = { ...agentTemplates };
afterEach(() => {
  cleanup();
  Object.assign(agentTemplates, original);
});

function detail(extra: Partial<AgentTemplateDetail> = {}): AgentTemplateDetail {
  return {
    id: "support", source: "user", name: "Support", description: "Answers tickets.", icon: "headset",
    directive: "Answer tickets.\nEscalate refunds.", mode: "learn", unconscious: true,
    recommended_apps: ["crm"], requirements: [], sort_order: 100, version: 2,
    created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-22T10:00:00Z",
    versions: [{ version: 1, created_at: "2026-11-20T10:00:00Z" }, { version: 2, created_at: "2026-11-22T10:00:00Z" }],
    agents: [
      { agent_id: 4, name: "Front desk", version: 2, follow_latest: true, changed_locally: false },
      { agent_id: 5, name: "Night shift", version: 1, follow_latest: false, changed_locally: true, last_error: "" },
    ],
    ...extra,
  };
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={["/agent-templates/support"]}>
      <Routes>
        <Route path="/agent-templates/:id" element={<AgentTemplateDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("line diff keeps shared lines and marks what changed", () => {
  expect(diffLines("a\nb\nc", "a\nB\nc\nd")).toEqual([
    { kind: "same", text: "a" },
    { kind: "removed", text: "b" },
    { kind: "added", text: "B" },
    { kind: "same", text: "c" },
    { kind: "added", text: "d" },
  ]);
  expect(diffLines("same", "same")).toEqual([{ kind: "same", text: "same" }]);
});

test("the list groups templates by where they come from and hides Start from scratch", async () => {
  agentTemplates.list = mock(async () => [
    { ...detail(), versions: undefined, agents: undefined } as any,
    { ...detail({ id: "research", source: "builtin", name: "Research", version: 4 }) },
    { ...detail({ id: "empty", source: "builtin", name: "Start from scratch" }) },
  ]);
  render(<MemoryRouter><AgentTemplates /></MemoryRouter>);
  const yours = await screen.findByRole("region", { name: "Your templates" });
  expect(within(yours).getByText("Support")).toBeTruthy();
  const builtin = screen.getByRole("region", { name: "Built-in" });
  expect(within(builtin).getByText("Version 4")).toBeTruthy();
  expect(screen.queryByText("Start from scratch")).toBeNull();
});

test("a template shows its agents and each version's changes from the one before", async () => {
  agentTemplates.get = mock(async () => detail());
  const version = mock(async (_id: string, n: number) => ({
    template_id: "support", version: n,
    content: n === 1
      ? { directive: "Answer tickets.", mode: "cautious" as const, unconscious: true, recommended_apps: [], requirements: [] }
      : { directive: "Answer tickets.\nEscalate refunds.", mode: "learn" as const, unconscious: true, recommended_apps: ["crm"], requirements: [] },
  }));
  agentTemplates.version = version;
  renderDetail();

  const agentsList = await screen.findByRole("region", { name: "Agents" });
  expect(within(agentsList).getByText("Front desk")).toBeTruthy();
  expect(within(agentsList).getByText("Follows new versions")).toBeTruthy();
  expect(within(agentsList).getByText("Changed on the agent")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Version 2/ }));
  await screen.findByText("Escalate refunds.");
  expect(version).toHaveBeenCalledWith("support", 2);
  expect(version).toHaveBeenCalledWith("support", 1);
  expect(screen.getByText("Added:")).toBeTruthy();
  expect(screen.getByText("changed from cautious")).toBeTruthy();
  expect(screen.getByText("changed from None")).toBeTruthy();

  // Without the comparison the version's own instructions are shown as is.
  fireEvent.click(screen.getByRole("checkbox", { name: /Show changes/ }));
  expect(screen.queryByText("Added:")).toBeNull();
});

test("editing saves against the loaded version and a newer save asks for a reload", async () => {
  agentTemplates.get = mock(async () => detail());
  const update = mock(async (_id: string, _t: any, _expected?: number) => detail({ version: 3, directive: "New." }));
  agentTemplates.update = update;
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "New." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Saved version 3\. 1 following agent gets it within a minute/);
  const [id, body, expected] = update.mock.calls[0]!;
  expect(id).toBe("support");
  expect(expected).toBe(2);
  expect(body).toMatchObject({ directive: "New.", mode: "learn", unconscious: true, recommended_apps: ["crm"], name: "Support" });
  expect(body).not.toHaveProperty("versions");
  expect(body).not.toHaveProperty("agents");

  agentTemplates.update = mock(async () => { throw Object.assign(new Error("conflict"), { status: 409 }); });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/A newer version was saved/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() => expect(agentTemplates.get).toHaveBeenCalledTimes(2));
});

test("built-in templates are read-only", async () => {
  agentTemplates.get = mock(async () => detail({ source: "builtin", agents: [] }));
  renderDetail();
  expect(await screen.findByText(/Built-in templates change with platform updates/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.getByText("No agents are linked to this template.")).toBeTruthy();
});
