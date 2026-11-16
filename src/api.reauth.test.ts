import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { auth, isReauthRequired, security, setReauthHandler, type ReauthChallenge, type SSHPolicy } from "./api";

type Reply = { status: number; body?: unknown };
type Call = { url: string; method: string; body?: unknown };

const STEP_UP = { error: "reauthentication_required", message: "Confirm your password to continue.", reauth_url: "/api/auth/reauth", window_minutes: 15 };

let calls: Call[] = [];
let replies: Reply[] = [];
const restores: (() => void)[] = [];

function reply(status: number, body?: unknown): Reply {
  return { status, body };
}

beforeEach(() => {
  calls = [];
  replies = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request ${init?.method} ${String(input)}`);
    const text = next.body === undefined ? "" : JSON.stringify(next.body);
    return new Response(next.status === 204 ? null : text, { status: next.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  const debug = spyOn(console, "debug").mockImplementation(() => {});
  restores.push(() => fetchSpy.mockRestore(), () => debug.mockRestore());
});

afterEach(() => {
  setReauthHandler(null);
  restores.splice(0).forEach((restore) => restore());
});

const revokeBody = { user_id: 7, sessions: true, api_keys: false, reason: "lost laptop" };

describe("step-up re-authentication in the request layer", () => {
  test("asks for confirmation once, then retries the refused request with the same body", async () => {
    const challenges: ReauthChallenge[] = [];
    setReauthHandler(async (c) => { challenges.push(c); return true; });
    replies = [reply(403, STEP_UP), reply(200, { complete: true, counts: {}, results: [] })];

    const result = await security.revoke(revokeBody);

    expect(result.complete).toBe(true);
    expect(challenges).toEqual([{ method: "POST", path: "/security/containment/revoke", windowMinutes: 15 }]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/security/containment/revoke",
      "POST /api/security/containment/revoke",
    ]);
    expect(calls[1].body).toEqual(calls[0].body);
  });

  test("a cancelled prompt rejects without retrying", async () => {
    setReauthHandler(async () => false);
    replies = [reply(403, STEP_UP)];

    const err: any = await security.revoke(revokeBody).catch((e) => e);

    expect(err.message).toBe("Confirm your password to continue.");
    expect(err.reauthCancelled).toBe(true);
    expect(isReauthRequired(err)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("without a mounted prompt the refusal is returned as-is", async () => {
    replies = [reply(403, STEP_UP)];
    const err: any = await security.setHostPolicy({} as SSHPolicy).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.reauthCancelled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("a handler that throws counts as cancelled", async () => {
    setReauthHandler(async () => { throw new Error("prompt crashed"); });
    replies = [reply(403, STEP_UP)];
    const err: any = await security.enableUser(3).catch((e) => e);
    expect(err.reauthCancelled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("retries only once when the server still refuses", async () => {
    let prompts = 0;
    setReauthHandler(async () => { prompts++; return true; });
    replies = [reply(403, STEP_UP), reply(403, STEP_UP)];

    const err: any = await security.revoke(revokeBody).catch((e) => e);

    expect(prompts).toBe(1);
    expect(calls).toHaveLength(2);
    expect(err.status).toBe(403);
    expect(err.message).toBe("Confirm your password to continue.");
    expect(err.reauthCancelled).toBeUndefined();
  });

  test("concurrent refusals share one prompt and both requests are retried", async () => {
    let prompts = 0;
    let confirm!: (ok: boolean) => void;
    setReauthHandler(() => { prompts++; return new Promise<boolean>((resolve) => { confirm = resolve; }); });
    replies = [reply(403, STEP_UP), reply(403, STEP_UP), reply(200, { status: "ok" }), reply(200, { status: "ok" })];

    const first = security.enableUser(1);
    const second = security.enableUser(2);
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(prompts).toBe(1);
    confirm(true);

    expect(await first).toEqual({ status: "ok" });
    expect(await second).toEqual({ status: "ok" });
    expect(prompts).toBe(1);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/security/users/1/enable",
      "/api/security/users/2/enable",
      "/api/security/users/1/enable",
      "/api/security/users/2/enable",
    ]);
  });

  test("a later refusal opens a fresh prompt once the previous one settled", async () => {
    let prompts = 0;
    setReauthHandler(async () => { prompts++; return true; });
    replies = [reply(403, STEP_UP), reply(200, { status: "ok" }), reply(403, STEP_UP), reply(200, { status: "ok" })];
    await security.enableUser(1);
    await security.enableUser(2);
    expect(prompts).toBe(2);
  });

  test("API-key callers get the server's interactive-session message and no prompt", async () => {
    let prompts = 0;
    setReauthHandler(async () => { prompts++; return true; });
    replies = [reply(403, {
      error: "interactive_session_required",
      message: "This action requires a signed-in dashboard session; API keys cannot perform it.",
    })];

    const err: any = await security.revoke(revokeBody).catch((e) => e);

    expect(prompts).toBe(0);
    expect(err.message).toBe("This action requires a signed-in dashboard session; API keys cannot perform it.");
    expect(err.body.error).toBe("interactive_session_required");
  });

  test("an ordinary 403 is not treated as a step-up", async () => {
    let prompts = 0;
    setReauthHandler(async () => { prompts++; return true; });
    replies = [reply(403, { error: "admin only" })];
    const err: any = await security.overview().catch((e) => e);
    expect(prompts).toBe(0);
    expect(err.message).toBe("admin only");
  });

  test("GET reads are retried too", async () => {
    setReauthHandler(async () => true);
    replies = [reply(403, STEP_UP), reply(200, { approved_sources: ["10.0.0.0/8"] })];
    expect((await security.hostPolicy()).approved_sources).toEqual(["10.0.0.0/8"]);
    expect(calls).toHaveLength(2);
  });
});

describe("auth session endpoints", () => {
  test("reauth posts the password and an empty code when MFA is off", async () => {
    replies = [reply(200, { status: "ok", valid_for_minutes: 15 })];
    await auth.reauth("hunter2");
    expect(calls).toEqual([{ url: "/api/auth/reauth", method: "POST", body: { password: "hunter2", code: "" } }]);
  });

  test("reauth includes the authentication code", async () => {
    replies = [reply(200, { status: "ok", valid_for_minutes: 15 })];
    await auth.reauth("hunter2", "123456");
    expect(calls[0].body).toEqual({ password: "hunter2", code: "123456" });
  });

  test("a wrong password does not sign the dashboard out", async () => {
    replies = [reply(401, { error: "invalid credentials" })];
    const err: any = await auth.reauth("wrong").catch((e) => e);
    expect(err.message).toBe("unauthorized");
  });

  test("revokeSession escapes the session reference", async () => {
    replies = [reply(204)];
    await auth.revokeSession("ab/cd");
    expect(calls[0]).toEqual({ url: "/api/auth/sessions/ab%2Fcd", method: "DELETE", body: undefined });
  });
});
