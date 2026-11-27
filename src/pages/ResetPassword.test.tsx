import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { auth } from "../api";
import { ResetPassword } from "./ResetPassword";

const originalCheck = auth.checkPasswordReset;
const originalReset = auth.resetPassword;

afterEach(() => {
  cleanup();
  auth.checkPasswordReset = originalCheck;
  auth.resetPassword = originalReset;
});

function CurrentHash() {
  return <output data-testid="hash">{useLocation().hash}</output>;
}

function open(hash: string) {
  return render(<MemoryRouter initialEntries={["/reset-password" + hash]}><ResetPassword /><CurrentHash /></MemoryRouter>);
}

function fill(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: confirm } });
  // Submit the form directly: the inputs' native minLength would otherwise
  // stop the submit before the page's own checks run.
  fireEvent.submit(screen.getByRole("button", { name: "Set new password" }).closest("form")!);
}

describe("Reset password page", () => {
  test("sets the password with the token from the link's fragment", async () => {
    auth.checkPasswordReset = mock(async () => ({ email: "user@example.test", expires_at: "2026-11-28T10:00:00Z" })) as typeof auth.checkPasswordReset;
    auth.resetPassword = mock(async () => ({ status: "ok", email: "user@example.test" })) as typeof auth.resetPassword;
    open("#tok_abc123");

    await waitFor(() => expect(screen.getByText("user@example.test")).toBeTruthy());
    expect(auth.checkPasswordReset).toHaveBeenCalledWith("tok_abc123");
    fill("a new password");
    await waitFor(() => expect(screen.getByText(/Your password is changed/)).toBeTruthy());
    expect(auth.resetPassword).toHaveBeenCalledWith("tok_abc123", "a new password");
    expect(screen.getByTestId("hash").textContent).toBe("");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });

  test("checks the two passwords before sending anything", async () => {
    auth.checkPasswordReset = mock(async () => ({ email: "user@example.test", expires_at: "2026-11-28T10:00:00Z" })) as typeof auth.checkPasswordReset;
    auth.resetPassword = mock(async () => ({ status: "ok", email: "user@example.test" })) as typeof auth.resetPassword;
    open("#tok_abc123");
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());

    fill("a new password", "another password");
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    fill("short");
    expect(screen.getByText("Password must be at least 8 characters.")).toBeTruthy();
    expect(auth.resetPassword).not.toHaveBeenCalled();
  });

  test("explains a used or expired link", async () => {
    auth.checkPasswordReset = mock(async () => {
      throw new Error("This reset link is invalid, already used, or expired. Ask an admin for a new one.");
    }) as typeof auth.checkPasswordReset;
    open("#tok_old");
    await waitFor(() => expect(screen.getByText(/already used, or expired/)).toBeTruthy());
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  test("does not call the server without a token", () => {
    auth.checkPasswordReset = mock(async () => ({ email: "", expires_at: "" })) as typeof auth.checkPasswordReset;
    open("");
    expect(screen.getByText(/link is incomplete/)).toBeTruthy();
    expect(auth.checkPasswordReset).not.toHaveBeenCalled();
  });
});
