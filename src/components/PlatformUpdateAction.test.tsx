import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as authHook from "../hooks/useAuth";
import { platform, type PlatformStatus, type PlatformUpdateStatus } from "../api";
import { PlatformUpdateAction } from "./PlatformUpdateAction";

const status: PlatformStatus = { polled_at: "", components: [], update_available: true, bundle_version: "1.2.3" };
const restores: (() => void)[] = [];
afterEach(() => { cleanup(); restores.splice(0).forEach(restore => restore()); });
function setup(view: PlatformUpdateStatus, role = "admin") {
  const auth = spyOn(authHook, "useAuth").mockReturnValue({ user: { role } } as ReturnType<typeof authHook.useAuth>);
  const probe = spyOn(platform, "updateStatus").mockResolvedValue(view);
  const update = spyOn(platform, "update").mockResolvedValue({ supported: true, job: { id: "job", state: "queued", message: "Preparing", previous_version: "1.2.2", target_version: "1.2.3", updated_at: new Date().toISOString() } });
  restores.push(() => auth.mockRestore(), () => probe.mockRestore(), () => update.mockRestore());
  return { probe, update };
}

test("admin can select agent handling and submit the reviewed release", async () => {
  const { update } = setup({ supported: true });
  const view = render(<PlatformUpdateAction status={status} />);
  const button = await view.findByRole("button", { name: /Update to v1.2.3/ });
  fireEvent.change(view.getByRole("combobox"), { target: { value: "rolling" } });
  fireEvent.click(button);
  await waitFor(() => expect(update).toHaveBeenCalledWith("1.2.3", "rolling"));
  await view.findByRole("status");
  expect(view.queryByRole("button", { name: /Update to/ })).toBeNull();
});

test("unsupported installations show the server's reason", async () => {
  setup({ supported: false, reason: "This is a source installation" });
  const view = render(<PlatformUpdateAction status={status} />);
  await view.findByText("This is a source installation");
  expect(view.queryByRole("button", { name: /Update to/ })).toBeNull();
});

test("non-admin users cannot start or probe host updates", () => {
  const { probe, update } = setup({ supported: true }, "user");
  const view = render(<PlatformUpdateAction status={status} />);
  expect(view.getByText(/instance administrator/)).toBeTruthy();
  expect(probe).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test("reopening progress shows the persisted job and prevents another start", async () => {
  setup({ supported: true, job: { id: "existing", state: "restarting", message: "Restarting service", target_version: "1.2.3", previous_version: "1.2.2", updated_at: new Date().toISOString() } });
  const view = render(<PlatformUpdateAction status={status} />);
  await view.findByText("Reconnecting");
  expect(view.queryByRole("button", { name: /Update to/ })).toBeNull();
});
