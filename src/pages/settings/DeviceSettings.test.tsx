import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { devices, instances, projects, type AccountDevice, type Agent, type Project } from "../../api";
import { DeviceSettings } from "./DeviceSettings";
import { SETTINGS_SCREENS, canOpenSettingsScreen } from "./registry";

const originals = { devices: { ...devices }, instances: { ...instances }, projects: { ...projects } };
afterEach(() => {
  cleanup();
  Object.assign(devices, originals.devices);
  Object.assign(instances, originals.instances);
  Object.assign(projects, originals.projects);
});

const row: AccountDevice = {
  id: "node_desk", name: "Desk CM5", version: "0.1.0", hardware: [{ id: "lamp", kind: "relay" }],
  tools: [], events: [], project_id: "project-b", agent_id: "2", created_at: 100, last_seen: 200,
  revoked_at: 0, connected: true, current: false,
};
function fixture(rows: AccountDevice[] = []) {
  devices.list = mock(async () => ({ devices: rows }));
  projects.list = mock(async () => [{ id: "project-a", name: "Home" }, { id: "project-b", name: "Work" }] as Project[]);
  instances.list = mock(async () => [{ id: 1, name: "Home agent", project_id: "project-a" }, { id: 2, name: "Work agent", project_id: "project-b" }] as Agent[]);
}
function show(path = "/settings?tab=devices") {
  return render(<MemoryRouter initialEntries={[path]}><DeviceSettings /></MemoryRouter>);
}

test("devices is an account setting available without API-key management permission", () => {
  const entry = SETTINGS_SCREENS.find(item => item.id === "devices")!;
  expect(entry.scope).toBe("account");
  expect(entry.permission).toBeUndefined();
  expect(canOpenSettingsScreen(entry, { role: "user", capabilities: {} } as any)).toBe(true);
});

test("pairing link previews the device and approves account-wide access with optional defaults", async () => {
  fixture();
  devices.pairing = mock(async () => ({ name: "Kitchen CM5", version: "0.1.0", hardware: [], expires_at: 2000000000, status: "pending" }));
  devices.approve = mock(async () => ({ status: "approved", device_id: "node_new" }));
  show("/settings?tab=devices&code=ABCD-EFGH");
  await screen.findByText("Connect Kitchen CM5?");
  expect(devices.pairing).toHaveBeenCalledWith("ABCD-EFGH");
  fireEvent.change(screen.getByLabelText("Default project"), { target: { value: "project-b" } });
  fireEvent.change(screen.getByLabelText("Default agent"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Approve device" }));
  await waitFor(() => expect(devices.approve).toHaveBeenCalledWith("ABCD-EFGH", "project-b", "2"));
  await screen.findByText("Device approved. It can now connect to your account.");
});

test("device list spans projects and removal needs a deliberate confirmation", async () => {
  fixture([row]);
  devices.revoke = mock(async () => ({ revoked: true }));
  show();
  await screen.findByText("Desk CM5");
  await screen.findByText("Work · Work agent");
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(devices.revoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(devices.revoke).toHaveBeenCalledWith("node_desk"));
});

test("editing defaults clears an agent from the previous project", async () => {
  fixture([row]);
  devices.update = mock(async () => row);
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Default project"), { target: { value: "project-a" } });
  expect((screen.getByLabelText("Default agent") as HTMLSelectElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Save device" }));
  await waitFor(() => expect(devices.update).toHaveBeenCalledWith("node_desk", { name: "Desk CM5", project_id: "project-a", agent_id: "" }));
});

test("pairing lookup failures remain visible and do not offer approval", async () => {
  fixture();
  devices.pairing = mock(async () => { throw new Error("Pairing code expired"); });
  show();
  fireEvent.change(screen.getByRole("textbox", { name: "Pairing code" }), { target: { value: "EXPIRED" } });
  fireEvent.click(screen.getByRole("button", { name: "Find device" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Pairing code expired");
  expect(screen.queryByRole("button", { name: "Approve device" })).toBeNull();
});
