import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { core, instances, integrations, type Agent, type ModelInfo, type RuntimeConnection } from "../api";
import { useAudience } from "../hooks/useAudience";
import { primaryRuntimeConnections } from "../pages/settings/modelUtils";
import { resolveEffectiveAgentProvider, savedAgentModelOverride } from "../utils/providerSelection";

/** What `instances.updateConfig` needs to change an agent's provider and
 *  model; null while nothing differs from what is saved. */
export interface AgentRuntimePatch {
  providers: Array<{ name: string; default: boolean }>;
  modelOverride?: string;
}

export interface AgentRuntimeChoice {
  visible: boolean;
  loading: boolean;
  error: string;
  connections: RuntimeConnection[];
  provider: string;
  model: string;
  catalog: ModelInfo[];
  loadingModels: boolean;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  patch: AgentRuntimePatch | null;
}

/**
 * The agent's provider and its own model, for quick edits.
 *
 * Only per-agent settings live here. The provider's Large/Medium/Small
 * models are saved on the provider connection and shared by every agent
 * on it, so they stay in the agent's detail page and Providers settings.
 * A model picked here is the agent's `model_override`: the server uses it
 * for all of this agent's work while that provider is its default.
 */
export function useAgentRuntimeChoice(agent: Agent | null): AgentRuntimeChoice {
  const { shows } = useAudience();
  const visible = !!agent && shows("agent.provider");
  const [connections, setConnections] = useState<RuntimeConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [initialProvider, setInitialProvider] = useState("");
  const [provider, setProviderState] = useState("");
  const [model, setModel] = useState("");
  // The agents list leaves `config` out, so the saved choice comes from the
  // agent itself.
  const [savedConfig, setSavedConfig] = useState("");
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setConnections([]);
    setInitialProvider("");
    setProviderState("");
    setModel("");
    setSavedConfig("");
    setError("");
    if (!agent || !visible) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([
      integrations.runtimeConnections(agent.project_id),
      instances.get(agent.id).then((saved) => saved.config || "{}"),
      // The running agent knows which provider it actually booted with; a
      // stopped one falls back to its saved choice.
      core.config(agent.id).then((config) => config.providers).catch(() => undefined),
    ])
      .then(([rows, config, runtimeProviders]) => {
        if (!active) return;
        const text = primaryRuntimeConnections((rows || []).filter((row) => row.role === "llm"));
        const resolved = resolveEffectiveAgentProvider(config, runtimeProviders);
        // The server falls back to the first provider in pool order when a
        // pin is missing or no longer connected; show the same one.
        const initial = text.some((row) => row.provider_key === resolved)
          ? resolved
          : text[0]?.provider_key || "";
        setSavedConfig(config);
        setConnections(text);
        setInitialProvider(initial);
        setProviderState(initial);
        setModel(savedAgentModelOverride(config, initial));
      })
      .catch((err: any) => {
        if (active) setError(err?.message || "Unable to load providers.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [agent?.id, visible]);

  const selected = connections.find((row) => row.provider_key === provider) || null;

  useEffect(() => {
    let cancelled = false;
    setCatalog([]);
    if (!selected) {
      setLoadingModels(false);
      return;
    }
    setLoadingModels(true);
    integrations
      .connectionModels(selected.id)
      .then((models) => { if (!cancelled) setCatalog(models || []); })
      // A provider without model discovery still accepts a typed model id.
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const setProvider = (next: string) => {
    setProviderState(next);
    setModel(savedAgentModelOverride(savedConfig, next));
  };

  let patch: AgentRuntimePatch | null = null;
  if (visible && agent && provider && connections.length > 0) {
    const providerChanged = provider !== initialProvider;
    const modelChanged = model.trim() !== savedAgentModelOverride(savedConfig, provider);
    if (providerChanged || modelChanged) {
      patch = {
        providers: connections.map((row) => ({ name: row.provider_key, default: row.provider_key === provider })),
        ...(modelChanged ? { modelOverride: model.trim() } : {}),
      };
    }
  }

  return {
    visible,
    loading,
    error,
    connections,
    provider,
    model,
    catalog,
    loadingModels,
    setProvider,
    setModel,
    patch,
  };
}

const selectClass = "w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent disabled:opacity-50";

export function AgentRuntimeFields({ runtime, disabled }: { runtime: AgentRuntimeChoice; disabled?: boolean }) {
  if (!runtime.visible) return null;
  if (runtime.loading) {
    return <p className="text-text-dim text-xs">Loading providers…</p>;
  }
  if (runtime.error) {
    return <p className="text-red text-xs">{runtime.error}</p>;
  }
  if (runtime.connections.length === 0) {
    return (
      <p className="text-text-muted text-xs">
        No AI provider is connected.{" "}
        <Link to="/settings?tab=providers" className="text-accent hover:underline">Connect one in Providers</Link>
        {" "}to choose this agent's provider and model.
      </p>
    );
  }

  const selected = runtime.connections.find((row) => row.provider_key === runtime.provider) || null;
  const models = runtime.catalog.filter((row, index, rows) => rows.findIndex((other) => other.id === row.id) === index);
  const sharedLarge = String(selected?.runtime_config?.model_large || "").trim();
  const defaultLabel = sharedLarge ? `Provider default (${sharedLarge})` : "Provider default";

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="agent-quick-provider" className="block text-text-muted text-sm mb-2">Provider</label>
          <select
            id="agent-quick-provider"
            value={runtime.provider}
            onChange={(event) => runtime.setProvider(event.target.value)}
            disabled={disabled}
            className={selectClass}
          >
            {runtime.connections.map((row) => (
              <option key={row.id} value={row.provider_key}>{row.app_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="agent-quick-model" className="block text-text-muted text-sm mb-2">
            Model{runtime.loadingModels && <span className="text-text-dim text-xs"> · loading…</span>}
          </label>
          {models.length > 0 ? (
            <select
              id="agent-quick-model"
              value={runtime.model}
              onChange={(event) => runtime.setModel(event.target.value)}
              disabled={disabled}
              className={selectClass}
            >
              <option value="">{defaultLabel}</option>
              {runtime.model && !models.some((row) => row.id === runtime.model) && (
                <option value={runtime.model}>{runtime.model}</option>
              )}
              {models.map((row) => (
                <option key={row.id} value={row.id}>{row.name && row.name !== row.id ? `${row.name} (${row.id})` : row.id}</option>
              ))}
            </select>
          ) : (
            <input
              id="agent-quick-model"
              value={runtime.model}
              onChange={(event) => runtime.setModel(event.target.value)}
              disabled={disabled || runtime.loadingModels}
              placeholder={defaultLabel}
              className={`${selectClass} font-mono placeholder:font-sans placeholder:text-text-dim`}
            />
          )}
        </div>
      </div>
      <p className="text-text-dim text-xs leading-relaxed">
        With the provider default, the agent moves between the provider's Large, Medium and Small models as the work needs. A model you pick is used for all of this agent's work. Other agents are unaffected.
      </p>
    </div>
  );
}
