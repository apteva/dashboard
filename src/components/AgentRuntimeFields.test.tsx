import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { core, instances, integrations, type Agent, type ModelInfo, type RuntimeConnection } from "../api";
import { AgentRuntimeFields, useAgentRuntimeChoice, type AgentRuntimePatch } from "./AgentRuntimeFields";

const originalIntegrations = { ...integrations };
const originalCore = { ...core };
const originalInstances = { ...instances };
afterEach(() => {
  cleanup();
  Object.assign(integrations, originalIntegrations);
  Object.assign(core, originalCore);
  Object.assign(instances, originalInstances);
});

function connection(id: number, provider_key: string, app_name: string, extra: Partial<RuntimeConnection> = {}): RuntimeConnection {
  return {
    id,
    name: app_name,
    app_slug: provider_key,
    app_name,
    provider_key,
    role: "llm",
    project_id: "p1",
    scope: "global",
    is_primary: true,
    runtime_config: {},
    ...extra,
  };
}

// Agents as the list returns them: `config` is left out (empty string).
// The saved config is only on GET /agents/:id.
const listRow: Agent = {
  id: 7,
  user_id: 1,
  name: "Personal Agent",
  directive: "You are this agent.",
  mode: "autonomous" as Agent["mode"],
  config: "",
  port: 0,
  pid: 0,
  status: "stopped",
  project_id: "p1",
  created_at: "2026-11-20T00:00:00Z",
};
let savedConfig = "{}";
function agent(config: Record<string, unknown>): Agent {
  savedConfig = JSON.stringify(config);
  return { ...listRow };
}

const anthropic = connection(1, "anthropic", "Anthropic", { runtime_config: { model_large: "claude-opus-5-5" } });
const claude = connection(2, "claude-subscription", "Claude subscription");
const ollama = connection(3, "ollama", "Ollama");
const embeddings = connection(4, "openai-embeddings", "OpenAI embeddings", { role: "embeddings" });

const modelsByConnection: Record<number, ModelInfo[]> = {
  1: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  ],
  2: [
    { id: "opus", name: "Opus" },
    { id: "sonnet", name: "Sonnet" },
  ],
};

function setup(connections: RuntimeConnection[], runtimeProviders?: Array<{ name: string; default?: boolean }>) {
  integrations.runtimeConnections = mock(async () => connections);
  integrations.connectionModels = mock(async (id: number) => {
    if (!modelsByConnection[id]) throw new Error("model discovery unsupported");
    return modelsByConnection[id];
  });
  instances.get = mock(async (id: number) => ({ ...listRow, id, config: savedConfig }));
  core.config = mock(async () => {
    if (!runtimeProviders) throw new Error("agent is not running");
    return { directive: "", mode: "autonomous", providers: runtimeProviders } as any;
  });
}

let lastPatch: AgentRuntimePatch | null = null;

function Harness({ target }: { target: Agent }) {
  const runtime = useAgentRuntimeChoice(target);
  lastPatch = runtime.patch;
  return (
    <MemoryRouter>
      <AgentRuntimeFields runtime={runtime} />
    </MemoryRouter>
  );
}

async function renderFor(target: Agent) {
  lastPatch = null;
  render(<Harness target={target} />);
  return (await screen.findByLabelText("Provider")) as HTMLSelectElement;
}

test("shows the agent's provider and model, and saves nothing until one changes", async () => {
  setup([anthropic, claude, embeddings]);
  const providerSelect = await renderFor(agent({ default_provider: "claude-subscription", model_override: { provider: "claude-subscription", model: "sonnet" } }));

  expect(providerSelect.value).toBe("claude-subscription");
  // Only text providers are offered.
  expect([...providerSelect.options].map((option) => option.textContent)).toEqual(["Anthropic", "Claude subscription"]);
  const modelSelect = (await screen.findByRole("option", { name: "Sonnet (sonnet)" })).closest("select") as HTMLSelectElement;
  expect(modelSelect.value).toBe("sonnet");
  expect(lastPatch).toBeNull();
});

test("switching provider makes it the default and shows that provider's own model", async () => {
  setup([anthropic, claude]);
  const providerSelect = await renderFor(agent({ default_provider: "claude-subscription", model_override: { provider: "claude-subscription", model: "sonnet" } }));
  await screen.findByRole("option", { name: "Sonnet (sonnet)" });

  fireEvent.change(providerSelect, { target: { value: "anthropic" } });

  const defaultOption = await screen.findByRole("option", { name: "Provider default (claude-opus-5-5)" });
  expect((defaultOption.closest("select") as HTMLSelectElement).value).toBe("");
  // The saved Claude model stays saved: no modelOverride is sent.
  expect(lastPatch).toEqual({
    providers: [
      { name: "anthropic", default: true },
      { name: "claude-subscription", default: false },
    ],
  });

  fireEvent.change(providerSelect, { target: { value: "claude-subscription" } });
  await waitFor(() => expect(lastPatch).toBeNull());
});

test("picking a model pins it, and choosing the provider default clears the pin", async () => {
  setup([anthropic, claude]);
  await renderFor(agent({ default_provider: "anthropic" }));
  const modelSelect = (await screen.findByRole("option", { name: "Claude Sonnet 5.5 (claude-sonnet-5-5)" })).closest("select") as HTMLSelectElement;

  fireEvent.change(modelSelect, { target: { value: "claude-sonnet-5-5" } });
  expect(lastPatch).toEqual({
    providers: [
      { name: "anthropic", default: true },
      { name: "claude-subscription", default: false },
    ],
    modelOverride: "claude-sonnet-5-5",
  });

  fireEvent.change(modelSelect, { target: { value: "" } });
  expect(lastPatch).toBeNull();
});

test("clearing a saved model sends an empty override", async () => {
  setup([anthropic, claude]);
  await renderFor(agent({ default_provider: "anthropic", model_override: { provider: "anthropic", model: "claude-sonnet-5-5" } }));
  const modelSelect = (await screen.findByRole("option", { name: "Claude Sonnet 5.5 (claude-sonnet-5-5)" })).closest("select") as HTMLSelectElement;
  expect(modelSelect.value).toBe("claude-sonnet-5-5");

  fireEvent.change(modelSelect, { target: { value: "" } });
  expect(lastPatch?.modelOverride).toBe("");
});

test("a running agent shows the provider it booted with", async () => {
  setup([anthropic, claude], [{ name: "anthropic", default: false }, { name: "claude-subscription", default: true }]);
  const providerSelect = await renderFor(agent({}));
  expect(providerSelect.value).toBe("claude-subscription");
  expect(lastPatch).toBeNull();
});

test("a pin to a provider that is no longer connected shows the one the server falls back to", async () => {
  setup([anthropic, claude]);
  const providerSelect = await renderFor(agent({ default_provider: "openai" }));
  expect(providerSelect.value).toBe("anthropic");
  expect(lastPatch).toBeNull();
});

test("a provider without model discovery takes a typed model id", async () => {
  setup([anthropic, ollama]);
  const providerSelect = await renderFor(agent({ default_provider: "anthropic" }));
  fireEvent.change(providerSelect, { target: { value: "ollama" } });

  const input = (await screen.findByPlaceholderText("Provider default")) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { value: " llama4 " } });
  expect(lastPatch).toEqual({
    providers: [
      { name: "anthropic", default: false },
      { name: "ollama", default: true },
    ],
    modelOverride: "llama4",
  });
});

test("with no provider connected it points to Providers instead", async () => {
  setup([embeddings]);
  lastPatch = null;
  render(<Harness target={agent({})} />);
  const link = await screen.findByRole("link", { name: "Connect one in Providers" });
  expect(link.getAttribute("href")).toBe("/settings?tab=providers");
  expect(screen.queryByLabelText("Provider")).toBeNull();
  expect(lastPatch).toBeNull();
});

test("if the agent's saved settings can't be read it changes nothing", async () => {
  setup([anthropic, claude]);
  instances.get = mock(async () => { throw new Error("agent not found"); });
  lastPatch = null;
  render(<Harness target={agent({ default_provider: "claude-subscription" })} />);
  expect(await screen.findByText("agent not found")).toBeTruthy();
  expect(screen.queryByLabelText("Provider")).toBeNull();
  expect(lastPatch).toBeNull();
});
