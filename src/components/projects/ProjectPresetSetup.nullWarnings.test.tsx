import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { projectPresets, projects } from "../../api";
import { ProjectPresetSetup } from "./ProjectPresetSetup";
const originals = { list: projectPresets.list, apply: projectPresets.apply, projects: projects.list };
afterEach(() => { cleanup(); projectPresets.list = originals.list; projectPresets.apply = originals.apply; projects.list = originals.projects; });
test("null warnings still completes project setup and notifies the caller", async () => {
  projects.list = mock(async () => [{ id: "p", name: "Default", description: "Help with work", color: "", user_id: 1, created_at: "" }]);
  projectPresets.list = mock(async () => ({ schema_version: 2, presets: [{ id: "test", name: "Test setup", category: "personal" as const, description: "Test", agents: [], dashboard: [] }] }));
  projectPresets.apply = mock(async () => ({ status: "applied" as const, project_id: "p", preset_id: "test", created_agents: [{ id: 11, name: "Assistant", status: "stopped" }], existing_agents: [], warnings: null }));
  const applied = mock(() => {});
  render(<ProjectPresetSetup onApplied={applied} />);
  fireEvent.click(await screen.findByRole("button", { name: "Create setup" }));
  await screen.findByText(/Setup created. 1 agent created/);
  expect(applied).toHaveBeenCalledWith({ created: 1, existing: 0, createdAgents: [{ id: 11, name: "Assistant", status: "stopped" }] });
});
