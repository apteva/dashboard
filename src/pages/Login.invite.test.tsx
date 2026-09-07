import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { auth, projectInvites } from "../api";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import { Login } from "./Login";

const originals = { auth: { ...auth }, invites: { ...projectInvites } };
const originalURL = window.location.href;
afterEach(() => {
  cleanup();
  Object.assign(auth, originals.auth);
  Object.assign(projectInvites, originals.invites);
  (window as any).happyDOM.setURL(originalURL);
});
function Home() {
  const { user } = useAuth();
  return <div>{user && user.onboarded ? "Invited workspace ready" : "Incorrect onboarding redirect"}</div>;
}

for (const mode of ["session", "login", "register", "mfa"] as const) {
  test(`accepts invite once and refreshes onboarding before navigation after ${mode}`, async () => {
    (window as any).happyDOM.setURL("http://localhost/login?invite=test-invite");
    let loggedIn = mode === "session";
    let accepted = false;
    let releaseAccept!: () => void;
    const pendingAccept = new Promise<void>((resolve) => { releaseAccept = resolve; });
    auth.status = mock(async () => ({ reg_mode: "locked", needs_setup: false }));
    auth.register = mock(async () => ({ id: 1, email: "invite@test.local" }));
    auth.login = mock(async () => {
      loggedIn = mode !== "mfa";
      return { email: "invite@test.local", mfa_required: mode === "mfa" };
    });
    auth.verifyMFA = mock(async () => {
      loggedIn = true;
      return { user_id: 1, email: "invite@test.local", used_recovery_code: false, recovery_codes_remaining: 10 };
    });
    auth.me = mock(async () => {
      if (!loggedIn) throw new Error("unauthorized");
      return { user_id: 1, email: "invite@test.local", role: "user" as const, created_at: "", onboarded: accepted };
    });
    projectInvites.preview = mock(async () => ({ email: "invite@test.local", project_id: "p", project_name: "Team", inviter_email: "owner@test.local", role: "editor", expires_at: "", accepted_at: null } as any));
    projectInvites.accept = mock(async () => {
      await pendingAccept;
      accepted = true;
      return { status: "accepted", project_id: "p", role: "editor" as const };
    });
    render(<MemoryRouter initialEntries={["/login?invite=test-invite"]}><AuthProvider><Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Home />} />
    </Routes></AuthProvider></MemoryRouter>);
    await screen.findByRole("button", { name: "Sign in" });
    if (mode !== "session") {
      await waitFor(() => expect((screen.getByLabelText("Username or email") as HTMLInputElement).value).toBe("invite@test.local"));
      if (mode === "register") fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: mode === "register" ? "Register" : "Sign in" }));
      if (mode === "mfa") {
        await screen.findByRole("heading", { name: "Verify sign in" });
        fireEvent.change(screen.getByLabelText("Authentication or recovery code"), { target: { value: "123456" } });
        fireEvent.click(screen.getByRole("button", { name: "Verify" }));
      }
    }
    await waitFor(() => expect(projectInvites.accept).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Invited workspace ready")).toBeNull();
    expect(screen.queryByText("Incorrect onboarding redirect")).toBeNull();
    releaseAccept();
    await screen.findByText("Invited workspace ready");
    expect(projectInvites.accept).toHaveBeenCalledTimes(1);
    if (mode === "register") expect(auth.register).toHaveBeenCalled();
  });
}
