import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { users, type UserRow } from "../../api";
import { ResetLinkModal } from "./UserSettings";

const originalCreate = users.createResetLink;
const target = { id: 7, email: "user@example.test" } as UserRow;

afterEach(() => {
  cleanup();
  users.createResetLink = originalCreate;
});

describe("Reset link dialog", () => {
  test("creates a link on this dashboard and copies it", async () => {
    users.createResetLink = mock(async () => ({ token: "tok_xyz", url: "http://localhost:5280/reset-password#tok_xyz", expires_at: "2026-11-28T10:00:00Z" })) as typeof users.createResetLink;
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ResetLinkModal target={target} onClose={() => {}} />);

    expect(users.createResetLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create reset link" }));
    await waitFor(() => expect(screen.getByLabelText("Reset link")).toBeTruthy());
    expect(users.createResetLink).toHaveBeenCalledWith(7);
    const link = `${window.location.origin}/reset-password#tok_xyz`;
    expect((screen.getByLabelText("Reset link") as HTMLInputElement).value).toBe(link);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(link);
  });

  test("shows why a link could not be created", async () => {
    users.createResetLink = mock(async () => {
      throw new Error("account is disabled; enable it before creating a reset link");
    }) as typeof users.createResetLink;
    render(<ResetLinkModal target={target} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Create reset link" }));
    await waitFor(() => expect(screen.getByText(/account is disabled/)).toBeTruthy());
    expect(screen.queryByLabelText("Reset link")).toBeNull();
  });
});
