import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  claudeSubscription,
  integrations,
  type ClaudeSubscriptionStatus,
  type NewAgentProviderSettings,
  type RuntimeCatalogEntry,
  type RuntimeConnection,
} from "../api";
import { ProvidersTab } from "./Settings";

const originalIntegrations = { ...integrations };
const originalClaude = { ...claudeSubscription };
afterEach(() => {
  cleanup();
  Object.assign(integrations, originalIntegrations);
  Object.assign(claudeSubscription, originalClaude);
});

const entry: RuntimeCatalogEntry = {
  slug: "claude-subscription",
  name: "Claude subscription",
  description: "Runs agents on your own Claude plan",
  logo: null,
  provider_key: "claude-subscription",
  role: "llm",
  auth_types: ["local_cli"],
  capabilities: ["llm", "subscription", "subscription_usage", "local_cli"],
};

const settings: NewAgentProviderSettings = {
  provider: "",
  inherited_provider: "",
  effective_provider: "claude-subscription",
  available_providers: ["claude-subscription"],
};

function status(overrides: Partial<ClaudeSubscriptionStatus> = {}): ClaudeSubscriptionStatus {
  return {
    available: true,
    installed: true,
    version: "2.1.281 (Claude Code)",
    sign_in_command: "claude auth login",
    server_user: "apteva",
    connected: false,
    settings: { pool_size: 4, idle_seconds: 90, queue_seconds: 60 },
    login: { running: false },
    auth: { logged_in: false, subscription: false, checked_at: new Date().toISOString() },
    ...overrides,
  };
}

function setup(connections: RuntimeConnection[]) {
  integrations.runtimeConnections = mock(async () => connections);
  integrations.runtimeCatalog = mock(async () => [entry]);
  integrations.newAgentProvider = mock(async () => settings);
  integrations.connectionUsage = mock(async () => ({ supported: true, provider_id: 1 }) as any);
}

const signInURL = "https://claude.com/cai/oauth/authorize?code=true&state=abc";

async function openConnectForm() {
  render(<ProvidersTab />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add provider" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Add provider" })).getByRole("button", { name: /Claude subscription.*Connect/ }));
  const form = screen.getByRole("dialog", { name: "Connect provider" });
  await waitFor(() => expect(within(form).getByText(/installed .* but not signed in/)).toBeTruthy());
  return form;
}

test("connecting signs in with Anthropic's link and the code it shows", async () => {
  setup([]);
  let current = status();
  claudeSubscription.status = mock(async () => current);
  claudeSubscription.login = mock(async () => {
    current = status({ login: { running: true, started_at: new Date().toISOString() } });
    return { started: true };
  });
  const submitCode = mock(async (_code: string) => {
    current = status({ login: { running: true, url: signInURL, code_submitted: true } });
    return { login: current.login };
  });
  claudeSubscription.submitCode = submitCode;
  const connect = mock(async () => ({ id: 9 }) as any);
  integrations.connect = connect;

  const form = await openConnectForm();
  expect(within(form).queryByRole("textbox")).toBeNull();
  expect(within(form).queryByLabelText(/password|token|key/i)).toBeNull();
  expect(within(form).getByText("claude auth login")).toBeTruthy();
  const submit = within(form).getByRole("button", { name: "Connect" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);

  fireEvent.click(within(form).getByRole("button", { name: "Sign in with Claude" }));
  await waitFor(() => expect(within(form).getByText("Starting sign-in…")).toBeTruthy());
  expect(claudeSubscription.login).toHaveBeenCalledTimes(1);

  current = status({ login: { running: true, url: signInURL, awaiting_code: true } });
  fireEvent.click(within(form).getByRole("button", { name: "Check again" }));
  const link = (await within(form).findByRole("link", { name: "Open sign-in page" })) as HTMLAnchorElement;
  expect(link.getAttribute("href")).toBe(signInURL);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");

  const input = within(form).getByLabelText(/Paste the code/);
  fireEvent.change(input, { target: { value: "  approved-code#abc  " } });
  fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(submitCode).toHaveBeenCalledWith("approved-code#abc"));
  await waitFor(() => expect(within(form).getByText("Checking the code…")).toBeTruthy());
  expect(connect).not.toHaveBeenCalled();

  current = status({ auth: { logged_in: true, subscription: true, subscription_type: "max", auth_method: "claude.ai", checked_at: new Date().toISOString() } });
  fireEvent.click(within(form).getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(within(form).getByText(/Max plan/)).toBeTruthy());
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
  const args = (connect.mock.calls[0] as unknown[]) || [];
  expect(args[0]).toBe("claude-subscription");
  expect(args[2]).toEqual({});
  expect(args[3]).toBe("local_cli");
});

test("a code Claude rejects shows its message and lets the user try again", async () => {
  setup([]);
  let current = status({ login: { running: true, url: signInURL, awaiting_code: true } });
  claudeSubscription.status = mock(async () => current);
  claudeSubscription.submitCode = mock(async () => {
    current = status({ login: { running: false, last_error: "That code wasn't accepted. Sign in again to get a new code." } });
    return { login: current.login };
  });
  const login = mock(async () => {
    current = status({ login: { running: true, url: signInURL, awaiting_code: true } });
    return { started: true };
  });
  claudeSubscription.login = login;

  render(<ProvidersTab />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add provider" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Add provider" })).getByRole("button", { name: /Claude subscription.*Connect/ }));
  const form = screen.getByRole("dialog", { name: "Connect provider" });
  const input = await within(form).findByLabelText(/Paste the code/);
  fireEvent.change(input, { target: { value: "wrong#abc" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(within(form).getByText(/wasn't accepted/)).toBeTruthy());
  fireEvent.click(within(form).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  await within(form).findByRole("link", { name: "Open sign-in page" });
});

test("a malformed code is explained and cancel ends the sign-in", async () => {
  setup([]);
  let current = status({ login: { running: true, url: signInURL, awaiting_code: true } });
  claudeSubscription.status = mock(async () => current);
  claudeSubscription.submitCode = mock(async () => {
    throw new Error("invalid_code");
  });
  const cancelLogin = mock(async () => {
    current = status();
    return { canceled: true, login: current.login };
  });
  claudeSubscription.cancelLogin = cancelLogin;

  render(<ProvidersTab />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add provider" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Add provider" })).getByRole("button", { name: /Claude subscription.*Connect/ }));
  const form = screen.getByRole("dialog", { name: "Connect provider" });
  fireEvent.change(await within(form).findByLabelText(/Paste the code/), { target: { value: "half-a-code" } });
  fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(within(form).getByText(/Copy the whole code/)).toBeTruthy());
  expect(within(form).getByRole("link", { name: "Open sign-in page" })).toBeTruthy();

  fireEvent.click(within(form).getByRole("button", { name: "Cancel sign-in" }));
  await waitFor(() => expect(cancelLogin).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(within(form).getByRole("button", { name: "Sign in with Claude" })).toBeTruthy());
  expect(within(form).queryByRole("textbox")).toBeNull();
});

test("the provider card shows the process pool and saves its settings", async () => {
  setup([
    {
      id: 1,
      name: "Claude subscription",
      app_name: "Claude subscription",
      app_slug: "claude-subscription",
      provider_key: "claude-subscription",
      role: "llm",
      auth_type: "local_cli",
      project_id: "",
      scope: "global",
      is_primary: true,
      capabilities: entry.capabilities,
      runtime_config: { model_large: "opus", model_medium: "sonnet", model_small: "haiku" },
    },
  ]);
  const now = new Date().toISOString();
  claudeSubscription.status = mock(async () =>
    status({
      connected: true,
      connection_id: 1,
      auth: { logged_in: true, subscription: true, subscription_type: "max", auth_method: "claude.ai", checked_at: now },
      pool: {
        max_processes: 4,
        running: 2,
        busy: 1,
        waiting: 0,
        sessions: 3,
        idle_seconds: 90,
        queue_seconds: 60,
        memory_kb: 512000,
        processes: [
          { session: "a1", owner: "agent:1", owner_label: "Researcher", model: "opus", pid: 11, state: "waiting_tool", detail: "web_search", since: now, started_at: now, turns: 4, memory_kb: 262144 },
          { session: "b2", owner: "agent:2", owner_label: "Writer", pid: 12, state: "idle", since: now, started_at: now, turns: 1, memory_kb: 249856 },
        ],
      },
    }),
  );
  const update = mock(async (next: any) => ({ settings: { pool_size: 6, idle_seconds: 90, queue_seconds: 60, ...next } }));
  claudeSubscription.updateSettings = update;
  integrations.connectionModels = mock(async () => [
    { id: "opus", name: "Claude Opus (latest)" },
    { id: "claude-fable-5-1[1m]", name: "Fable", description: "Most capable" },
    { id: "sonnet", name: "Sonnet" },
    { id: "haiku", name: "Haiku" },
  ]);
  const pin = mock(async () => ({}));
  integrations.updateRuntimeConfig = pin;

  render(<ProvidersTab />);
  const region = await waitFor(() => screen.getByRole("region", { name: "Claude subscription global provider" }));
  fireEvent.click(within(region).getByRole("button", { name: "Claude subscription global provider details" }));
  await waitFor(() => expect(within(region).getByText("2 of 4")).toBeTruthy());
  expect(within(region).getByText("500 MB")).toBeTruthy();
  const list = within(region).getByRole("list", { name: "Claude processes" });
  expect(within(list).getByText("Researcher")).toBeTruthy();
  expect(within(list).getByText(/· opus/)).toBeTruthy();
  expect(within(list).getByText("Waiting on web_search")).toBeTruthy();
  expect(within(region).queryByRole("button", { name: "Test connection" })).toBeNull();

  // Tiers are picked from the models Claude Code offers.
  const large = within(region).getByRole("combobox", { name: "large model" }) as HTMLSelectElement;
  await waitFor(() => expect(large.disabled).toBe(false));
  expect(large.value).toBe("opus");
  expect(within(large).getByRole("option", { name: "Fable · claude-fable-5-1[1m]" })).toBeTruthy();
  expect(within(region).queryByPlaceholderText("Provider default")).toBeNull();
  fireEvent.change(large, { target: { value: "claude-fable-5-1[1m]" } });
  await waitFor(() => expect(pin).toHaveBeenCalledWith(1, { model_large: "claude-fable-5-1[1m]" }));

  const size = within(region).getByRole("spinbutton", { name: /Pool size/ });
  fireEvent.change(size, { target: { value: "6" } });
  fireEvent.click(within(region).getByRole("button", { name: "Save pool settings" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith({ pool_size: 6, idle_seconds: 90, queue_seconds: 60 }));

  // Sleeping agents give up their process unless this is ticked.
  const hold = within(region).getByRole("checkbox", { name: /Keep processes for sleeping agents/ }) as HTMLInputElement;
  expect(hold.checked).toBe(false);
  fireEvent.click(hold);
  fireEvent.click(within(region).getByRole("button", { name: "Save pool settings" }));
  await waitFor(() => expect(update).toHaveBeenLastCalledWith({ pool_size: 6, idle_seconds: 90, queue_seconds: 60, hold_sleeping: true }));
  expect((within(region).getByRole("checkbox", { name: /Keep processes for sleeping agents/ }) as HTMLInputElement).checked).toBe(true);

  fireEvent.click(within(region).getByRole("button", { name: "Sign out of Claude" }));
  expect(within(region).getByRole("alertdialog", { name: "Sign out of Claude" })).toBeTruthy();
});

test("an open Claude card shows every usage window and keeps it current", async () => {
  setup([
    {
      id: 1,
      name: "Claude subscription",
      runtime_config: {},
      app_name: "Claude subscription",
      app_slug: "claude-subscription",
      provider_key: "claude-subscription",
      role: "llm",
      auth_type: "local_cli",
      project_id: "",
      scope: "global",
      is_primary: true,
      capabilities: entry.capabilities,
    },
  ]);
  const usage = mock(async () => ({
    supported: true,
    provider_id: 1,
    kind: "subscription_quota",
    plan: "max",
    limits: [
      { id: "claude", label: "Claude plan", windows: [{ id: "seven_day", used_percent: 47, duration_minutes: 10080 }] },
      { id: "model:fable", label: "Fable (weekly)", windows: [{ id: "model:fable", used_percent: 56, duration_minutes: 10080 }] },
    ],
  }) as any);
  integrations.connectionUsage = usage;
  claudeSubscription.status = mock(async () => status({ connected: true, connection_id: 1 }));

  // Catch the open card's refresh timer instead of waiting a minute.
  const timers: Array<{ run: () => void; ms: number }> = [];
  const realSetInterval = window.setInterval;
  window.setInterval = ((run: () => void, ms: number) => {
    timers.push({ run, ms });
    return realSetInterval(() => {}, 1e9);
  }) as typeof window.setInterval;
  try {
    render(<ProvidersTab />);
    const region = await waitFor(() => screen.getByRole("region", { name: "Claude subscription global provider" }));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
    expect(timers.some((timer) => timer.ms === 60_000)).toBe(false);

    fireEvent.click(within(region).getByRole("button", { name: "Claude subscription global provider details" }));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
    expect(within(region).getByText("Claude plan")).toBeTruthy();
    expect(within(region).getByText("Fable (weekly)")).toBeTruthy();
    expect(within(region).queryByText(/additional limit/)).toBeNull();
    // A plain read: the server's cache decides when to ask claude again.
    expect(usage).toHaveBeenLastCalledWith(1, false);

    const open = timers.filter((timer) => timer.ms === 60_000);
    expect(open.length).toBe(1);
    open[0].run();
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(3));
  } finally {
    window.setInterval = realSetInterval;
  }
});
