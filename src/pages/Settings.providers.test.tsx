import { afterEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  integrations,
  type NewAgentProviderSettings,
  type RuntimeConnection,
  type RuntimeCatalogEntry,
} from "../api";
import { ProvidersTab } from "./Settings";

const originals = { ...integrations };
afterEach(() => {
  cleanup();
  Object.assign(integrations, originals);
});
const settings: NewAgentProviderSettings = {
  provider: "",
  inherited_provider: "",
  effective_provider: "openai",
  available_providers: ["openai", "anthropic"],
};
const catalog: RuntimeCatalogEntry[] = ["OpenAI", "Anthropic", "Ollama"].map(
  (name) => ({
    slug: name.toLowerCase(),
    name,
    description: `Connect ${name} models`,
    logo: null,
    provider_key: name.toLowerCase(),
    role: "llm",
    auth_types: ["api_key"],
    credential_fields: [{ name: "api_key", label: "API key" }],
  }),
);
const connections: RuntimeConnection[] = catalog
  .slice(0, 2)
  .map((entry, index) => ({
    id: index + 1,
    name: entry.name,
    app_name: entry.name,
    app_slug: entry.slug,
    provider_key: entry.provider_key,
    role: "llm",
    project_id: "",
    scope: "global",
    is_primary: true,
    runtime_config: { model_large: "large-model" },
  }));
function setup() {
  integrations.runtimeConnections = mock(async () => connections);
  integrations.runtimeCatalog = mock(async () => catalog);
  integrations.newAgentProvider = mock(async () => settings);
  integrations.setNewAgentProvider = mock(async (provider) => ({
    ...settings,
    provider,
    effective_provider: provider || "openai",
  }));
}
const card = (name: string) =>
  screen.getByRole("region", { name: `${name} global provider` });
const choice = (name: string) =>
  within(card(name)).getByRole("button", {
    name: `Make ${name} the default for new agents`,
  });

test("changes the default directly on connected cards and restores automatic selection", async () => {
  setup();
  render(<ProvidersTab />);
  await waitFor(() =>
    expect(choice("OpenAI").getAttribute("aria-pressed")).toBe("true"),
  );
  fireEvent.click(choice("Anthropic"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Default saved"),
  );
  expect(integrations.setNewAgentProvider).toHaveBeenCalledWith(
    "anthropic",
    undefined,
  );
  expect(choice("Anthropic").textContent).toBe("✓ Default for new agents");
  expect(choice("OpenAI").getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(
    screen.getByRole("button", { name: "Choose default automatically" }),
  );
  await waitFor(() =>
    expect(choice("OpenAI").getAttribute("aria-pressed")).toBe("true"),
  );
});

test("failed saves keep the existing default and display the error", async () => {
  setup();
  integrations.setNewAgentProvider = mock(async () => {
    throw new Error("Could not save");
  });
  render(<ProvidersTab />);
  await waitFor(() => expect(choice("Anthropic")).toBeTruthy());
  fireEvent.click(choice("Anthropic"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Could not save"),
  );
  expect(choice("OpenAI").getAttribute("aria-pressed")).toBe("true");
});

test("catalog is only in Add provider modal, search leads to credential form", async () => {
  setup();
  render(<ProvidersTab />);
  await waitFor(() => expect(card("OpenAI")).toBeTruthy());
  expect(screen.queryByText("Ollama")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  const dialog = screen.getByRole("dialog", { name: "Add provider" });
  expect(within(dialog).getAllByText("Add another").length).toBe(2);
  fireEvent.change(within(dialog).getByRole("searchbox"), {
    target: { value: "ollama" },
  });
  expect(within(dialog).queryByText("Anthropic")).toBeNull();
  fireEvent.click(
    within(dialog).getByRole("button", { name: /Ollama.*Connect/ }),
  );
  expect(screen.queryByRole("dialog", { name: "Add provider" })).toBeNull();
  const form = screen.getByRole("dialog", { name: "Connect provider" });
  expect(within(form).getByText("Ollama")).toBeTruthy();
  expect(within(form).getByText("API key")).toBeTruthy();
  fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("card model controls and credential tests still call the original APIs", async () => {
  setup();
  integrations.updateRuntimeConfig = mock(async () => ({}));
  integrations.testConnection = mock(async () => ({
    ok: true,
    latency_ms: 20,
  }));
  render(<ProvidersTab />);
  await waitFor(() => expect(card("OpenAI")).toBeTruthy());
  const input = within(card("OpenAI")).getByRole("textbox", { name: "large" });
  fireEvent.change(input, { target: { value: "new-large" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(integrations.updateRuntimeConfig).toHaveBeenCalledWith(1, {
      model_large: "new-large",
    }),
  );
  await waitFor(() =>
    expect(
      (
        within(card("OpenAI")).getByRole("button", {
          name: "Test connection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    within(card("OpenAI")).getByRole("button", { name: "Test connection" }),
  );
  await waitFor(() =>
    expect(within(card("OpenAI")).getByText("✓ Connected (20ms)")).toBeTruthy(),
  );
  expect(integrations.testConnection).toHaveBeenCalledWith(1);
});
