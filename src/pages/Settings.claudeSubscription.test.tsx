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

test("connecting asks the user to sign in to Claude and never collects credentials", async () => {
  setup([]);
  let current = status();
  claudeSubscription.status = mock(async () => current);
  claudeSubscription.login = mock(async () => {
    current = status({ login: { running: true, started_at: new Date().toISOString() } });
    return { started: true };
  });
  const connect = mock(async () => ({ id: 9 }) as any);
  integrations.connect = connect;

  render(<ProvidersTab />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add provider" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Add provider" })).getByRole("button", { name: /Claude subscription.*Connect/ }));

  const form = screen.getByRole("dialog", { name: "Connect provider" });
  await waitFor(() => expect(within(form).getByText(/installed .* but not signed in/)).toBeTruthy());
  expect(within(form).queryByRole("textbox")).toBeNull();
  expect(within(form).queryByLabelText(/password|token|key/i)).toBeNull();
  expect(within(form).getByText("claude auth login")).toBeTruthy();
  const submit = within(form).getByRole("button", { name: "Connect" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);

  fireEvent.click(within(form).getByRole("button", { name: "Open Claude sign-in" }));
  await waitFor(() => expect(within(form).getByRole("button", { name: "Waiting for sign-in…" })).toBeTruthy());
  expect(claudeSubscription.login).toHaveBeenCalledTimes(1);

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
        rss_kb: 512000,
        processes: [
          { session: "a1", owner: "agent:1", owner_label: "Researcher", model: "opus", pid: 11, state: "waiting_tool", detail: "web_search", since: now, started_at: now, turns: 4, rss_kb: 262144 },
          { session: "b2", owner: "agent:2", owner_label: "Writer", pid: 12, state: "idle", since: now, started_at: now, turns: 1, rss_kb: 249856 },
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
  expect(within(list).getByText(/Waiting for tools: web_search/)).toBeTruthy();
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

  fireEvent.click(within(region).getByRole("button", { name: "Sign out of Claude" }));
  expect(within(region).getByRole("alertdialog", { name: "Sign out of Claude" })).toBeTruthy();
});
