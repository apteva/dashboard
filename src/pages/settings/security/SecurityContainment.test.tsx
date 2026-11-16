import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as authHook from "../../../hooks/useAuth";
import { adminUsers, security, type AdminUser, type ContainmentReport } from "../../../api";
import { SecurityContainmentPanel } from "./SecurityContainment";

const restores: (() => void)[] = [];
afterEach(() => { cleanup(); restores.splice(0).forEach((restore) => restore()); });

function report(sessions: number): ContainmentReport {
  return {
    user: { id: 2, email: "operator@example.test", role: "user" },
    generated_at: "2026-11-16T11:43:36Z",
    sessions: Array.from({ length: sessions }, (_, i) => ({ ref: `session:${i}`, user_id: 2, created_at: "2026-11-16T11:43:20Z", created_ip: "192.0.2.10" })),
    api_keys: [],
    fleet_tenants: [],
    coverage_gaps: [],
  } as unknown as ContainmentReport;
}

test("revoking shows the outcome and keeps it visible after the report refreshes", async () => {
  let users: AdminUser[] = [
    { id: 1, email: "admin@example.test", role: "admin" } as AdminUser,
    { id: 2, email: "operator@example.test", role: "user" } as AdminUser,
  ];
  let current = report(1);
  const spies = [
    spyOn(authHook, "useAuth").mockReturnValue({ user: { id: 1 } } as ReturnType<typeof authHook.useAuth>),
    spyOn(adminUsers, "list").mockImplementation(async () => users),
    spyOn(security, "containment").mockImplementation(async () => current),
    spyOn(security, "revoke").mockImplementation(async (req) => {
      expect(req).toMatchObject({ user_id: 2, sessions: true, api_keys: true, disable_user: true, reason: "lost laptop" });
      users = users.map((u) => (u.id === 2 ? { ...u, disabled_at: "2026-11-16T11:43:55Z" } : u));
      current = report(0);
      return { complete: true, counts: {}, results: [{ scope: "session", target: "session:0", status: "revoked" }, { scope: "user", target: "2", status: "disabled_locally" }] } as any;
    }),
  ];
  restores.push(...spies.map((s) => () => s.mockRestore()));

  render(<SecurityContainmentPanel />);
  const picker = await screen.findByRole("combobox", { name: "Account" });
  await waitFor(() => expect(screen.getByRole("option", { name: /operator@example.test/ })).toBeTruthy());
  fireEvent.change(picker, { target: { value: "2" } });

  expect(await screen.findByText("Signed-in sessions (1)")).toBeTruthy();
  fireEvent.input(screen.getByPlaceholderText(/suspicious sign-in/), { target: { value: "lost laptop" } });
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));

  expect(await screen.findByText("Containment complete.")).toBeTruthy();
  await waitFor(() => expect(screen.getByText("Signed-in sessions (0)")).toBeTruthy());
  expect(screen.getByText("Containment complete.")).toBeTruthy();
  expect(screen.getByText("Revoked")).toBeTruthy();
  expect(screen.getByText("Disabled")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Re-enable account" })).toBeTruthy();
});

test("the signed-in admin cannot disable their own account from here", async () => {
  const me = { id: 1, email: "admin@example.test", role: "admin" } as AdminUser;
  const spies = [
    spyOn(authHook, "useAuth").mockReturnValue({ user: { id: 1 } } as ReturnType<typeof authHook.useAuth>),
    spyOn(adminUsers, "list").mockResolvedValue([me]),
    spyOn(security, "containment").mockResolvedValue({ ...report(2), user: me } as unknown as ContainmentReport),
  ];
  restores.push(...spies.map((s) => () => s.mockRestore()));

  render(<SecurityContainmentPanel />);
  const picker = await screen.findByRole("combobox", { name: "Account" });
  await waitFor(() => expect(screen.getByRole("option", { name: /admin@example.test/ })).toBeTruthy());
  fireEvent.change(picker, { target: { value: "1" } });

  expect(await screen.findByText("Sign out all my other sessions (this one stays)")).toBeTruthy();
  expect(screen.queryByText(/Disable the account/)).toBeNull();
});
