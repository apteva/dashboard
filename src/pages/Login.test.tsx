import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { auth } from "../api";
import { AuthProvider } from "../hooks/useAuth";
import { Login } from "./Login";

const originalStatus = auth.status;
const originalLogin = auth.login;
const originalVerifyMFA = auth.verifyMFA;
const originalMe = auth.me;

afterEach(() => {
  cleanup();
  auth.status = originalStatus;
  auth.login = originalLogin;
  auth.verifyMFA = originalVerifyMFA;
  auth.me = originalMe;
});

describe("Login MFA", () => {
  test("does not authenticate after password alone and completes the second step", async () => {
    let verified = false;
    auth.status = mock(async () => ({ reg_mode: "locked", needs_setup: false }));
    auth.login = mock(async () => ({
      email: "secure@test.local",
      mfa_required: true,
    }));
    auth.verifyMFA = mock(async (code: string) => {
      expect(code).toBe("123456");
      verified = true;
      return {
        user_id: 1,
        email: "secure@test.local",
        used_recovery_code: false,
        recovery_codes_remaining: 10,
      };
    });
    auth.me = mock(async () => {
      if (!verified) throw new Error("unauthorized");
      return {
        user_id: 1,
        email: "secure@test.local",
        role: "admin" as const,
        created_at: "2026-08-11T12:00:00Z",
        onboarded: true,
        mfa_enabled: true,
        mfa_type: "totp",
        mfa_recovery_codes_remaining: 10,
      };
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider><Login /></AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy());
    fireEvent.input(screen.getByLabelText("Username or email"), { target: { value: "secure@test.local" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Verify sign in" })).toBeTruthy());
    expect(verified).toBe(false);
    fireEvent.input(screen.getByLabelText("Authentication or recovery code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(verified).toBe(true));
    expect(auth.verifyMFA).toHaveBeenCalledTimes(1);
  });
});
