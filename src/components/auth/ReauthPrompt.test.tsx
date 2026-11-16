import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as authHook from "../../hooks/useAuth";
import { security } from "../../api";
import { ReauthPrompt, describeReauthAction, reauthErrorMessage } from "./ReauthPrompt";

const STEP_UP = { error: "reauthentication_required", message: "Confirm your password to continue.", window_minutes: 15 };

type Call = { url: string; method: string; body?: any };
let calls: Call[] = [];
let replies: Array<{ status: number; body?: unknown }> = [];
const restores: (() => void)[] = [];

function setup(mfaEnabled = false) {
  const auth = spyOn(authHook, "useAuth").mockReturnValue({ user: { id: 1, mfaEnabled } } as ReturnType<typeof authHook.useAuth>);
  restores.push(() => auth.mockRestore());
  return render(<ReauthPrompt />);
}

beforeEach(() => {
  calls = [];
  replies = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request ${init?.method} ${String(input)}`);
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  const debug = spyOn(console, "debug").mockImplementation(() => {});
  restores.push(() => fetchSpy.mockRestore(), () => debug.mockRestore());
});

afterEach(() => {
  cleanup();
  restores.splice(0).forEach((restore) => restore());
});

describe("ReauthPrompt", () => {
  test("confirms the password, then the refused request completes", async () => {
    setup();
    replies = [{ status: 403, body: STEP_UP }, { status: 200, body: { status: "ok", valid_for_minutes: 15 } }, { status: 200, body: { status: "ok" } }];

    const pending = security.enableUser(4);
    const dialog = await screen.findByRole("dialog", { name: "Confirm your password" });
    expect(dialog.textContent).toContain("To disable or enable an account, confirm it is you.");
    expect(dialog.textContent).toContain("15 minutes");
    expect(screen.queryByLabelText(/Authentication or recovery code/)).toBeNull();

    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await pending).toEqual({ status: "ok" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/security/users/4/enable",
      "POST /api/auth/reauth",
      "POST /api/security/users/4/enable",
    ]);
    expect(calls[1].body).toEqual({ password: "correct horse", code: "" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("asks for the authentication code when two-factor is on", async () => {
    setup(true);
    replies = [{ status: 403, body: STEP_UP }, { status: 200, body: { status: "ok" } }, { status: 200, body: { status: "ok" } }];

    const pending = security.enableUser(4);
    await screen.findByRole("dialog", { name: "Confirm your password" });
    const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "pw" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Authentication or recovery code"), { target: { value: " 123456 " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await pending;
    expect(calls[1].body).toEqual({ password: "pw", code: "123456" });
  });

  test("a wrong password keeps the prompt open with an error", async () => {
    setup();
    replies = [{ status: 403, body: STEP_UP }, { status: 401, body: { error: "invalid credentials" } }];

    const pending = security.enableUser(4).catch((e) => e);
    await screen.findByRole("dialog", { name: "Confirm your password" });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The password or authentication code is incorrect.");
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const err: any = await pending;
    expect(err.reauthCancelled).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("unmounting refuses an open prompt", async () => {
    const view = setup();
    replies = [{ status: 403, body: STEP_UP }];
    const pending = security.enableUser(4).catch((e) => e);
    await screen.findByRole("dialog");
    view.unmount();
    expect((await pending).reauthCancelled).toBe(true);
  });
});

describe("prompt wording", () => {
  test("names the guarded action", () => {
    expect(describeReauthAction({ method: "GET", path: "/connections/12/credentials" })).toBe("reveal stored credentials");
    expect(describeReauthAction({ method: "PATCH", path: "/admin/users/3" })).toBe("change an administrator role");
    expect(describeReauthAction({ method: "POST", path: "/security/containment/revoke" })).toBe("revoke access");
    expect(describeReauthAction({ method: "POST", path: "/security/users/9/disable" })).toBe("disable or enable an account");
    expect(describeReauthAction({ method: "PUT", path: "/security/host/policy" })).toBe("change SSH monitoring");
    expect(describeReauthAction({ method: "DELETE", path: "/projects/1" })).toBe("continue");
  });

  test("explains failures without echoing server internals", () => {
    expect(reauthErrorMessage(new Error("unauthorized"))).toBe("The password or authentication code is incorrect.");
    expect(reauthErrorMessage(Object.assign(new Error("slow down"), { status: 429 }))).toBe("Too many attempts. Wait a few minutes and try again.");
    expect(reauthErrorMessage(new Error("server unavailable"))).toBe("server unavailable");
  });
});
