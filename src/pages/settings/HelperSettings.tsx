import { ServiceTierSelect, agentServiceTiers, serviceTierPatch } from "../../components/ServiceTierSelect";
import { useState, useEffect, useCallback, useRef } from "react";

import { Link } from "react-router-dom";
import { AppIcon } from "@apteva/ui-kit";
import { core, platformHelper, mcpServers, integrations, instances as instancesAPI, type RuntimeConnection, type ModelInfo, type MCPServer, type Agent, type PlatformHelperStatus } from "../../api";

import { resolveEffectiveAgentProvider } from "../../utils/providerSelection";

import { globalHelperCapabilityInventory, helperCapabilityKind, helperCapabilityLabel } from "../../utils/helperCapabilities";

import { primaryRuntimeConnections, normalizeProviderName, EMPTY_HELPER_MODELS, type HelperModelMapping } from "./modelUtils";

export function HelperTab() {
  const [runtimeConns, setRuntimeConns] = useState<RuntimeConnection[]>([]);
  const [serviceTierOverrides, setServiceTierOverrides] = useState<Record<string, string | null>>({});
  // The server returns these in pool order (project scope, then primary,
  // then id), so first-wins dedup here produces exactly the provider the
  // agent will boot with. This used to be reimplemented client-side by
  // runtimeProviderKey()/isTextProvider(), which duplicated the server's
  // legacy type-vs-name normalization.
  const textProviders = primaryRuntimeConnections(runtimeConns);
  const [helper, setHelper] = useState<Agent | null>(null);
  const [helperStatus, setHelperStatus] = useState<PlatformHelperStatus | null>(null);
  const [helperRevision, setHelperRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setHelperRevision(value => value + 1);
    window.addEventListener("apteva:helper-changed", refresh);
    window.addEventListener("apteva:apps-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("apteva:helper-changed", refresh);
      window.removeEventListener("apteva:apps-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const [activationBusy, setActivationBusy] = useState(false);
  const [runtimeProvider, setRuntimeProvider] = useState("");
  const [runtimeModels, setRuntimeModels] = useState<HelperModelMapping>(EMPTY_HELPER_MODELS);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [catalog, setCatalog] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [capabilityInventory, setCapabilityInventory] = useState<MCPServer[]>([]);
  const [selectedCapabilityIDs, setSelectedCapabilityIDs] = useState<number[]>([]);
  const capabilitiesDirty = useRef(false);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesSaving, setCapabilitiesSaving] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState("");
  const [capabilitiesNotice, setCapabilitiesNotice] = useState("");

  const providerSignature = textProviders
    .map((connection) => `${connection.id}:${connection.provider_key}`)
    .join("|");

  useEffect(() => {
    integrations
      .runtimeConnections()
      .then(setRuntimeConns)
      .catch((err: any) => setError(err?.message || "Unable to load text providers."));
  }, []);

  useEffect(() => {
    if (!helperStatus?.activated) {
      setCapabilitiesLoading(false);
      return;
    }
    let cancelled = false;
    setCapabilitiesLoading(true);
    setCapabilitiesError("");
    Promise.all([
      mcpServers.list(undefined, { includeAppOwned: true }),
      platformHelper.capabilities(),
    ])
      .then(([rows, state]) => {
        if (cancelled) return;
        setCapabilityInventory(globalHelperCapabilityInventory(rows || []));
        if (!capabilitiesDirty.current) setSelectedCapabilityIDs(state.selected_mcp_server_ids || []);
        if (!state.applied) {
          setCapabilitiesNotice("Saved, but the running Helper will apply these capabilities on its next restart.");
        }
      })
      .catch((err: any) => {
        if (!cancelled) setCapabilitiesError(err?.message || "Unable to load Helper capabilities.");
      })
      .finally(() => {
        if (!cancelled) setCapabilitiesLoading(false);
      });
    return () => { cancelled = true; };
  }, [helperStatus?.activated, helperRevision]);

  const savedModelOverride = useCallback((agent: Agent, providerName: string) => {
    try {
      const parsed = JSON.parse(agent.config || "{}");
      const override = parsed?.model_override;
      return normalizeProviderName(String(override?.provider || "")) === providerName
        ? String(override?.model || "")
        : "";
    } catch {
      return "";
    }
  }, []);

  const applyRuntimeConfig = useCallback((agent: Agent, config: Awaited<ReturnType<typeof core.config>>) => {
    setServiceTierOverrides(agentServiceTiers(agent.config));
    const effectiveProvider = resolveEffectiveAgentProvider(agent.config || "{}", config.providers);
    const effectiveModels = config.provider?.models || {};
    setRuntimeProvider(config.provider?.name || effectiveProvider);
    setRuntimeModels({
      large: effectiveModels.large || "",
      medium: effectiveModels.medium || "",
      small: effectiveModels.small || "",
    });
    setSelectedProvider((current) => current || effectiveProvider);
    setSelectedModel((current) => current || savedModelOverride(agent, effectiveProvider));
  }, [savedModelOverride]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    platformHelper.status()
      .then(async (status) => {
        if (cancelled) return;
        setHelperStatus(status);
        if (!status.activated) {
          setHelper(null);
          return;
        }
        const agent = await platformHelper.get();
        const config = await core.config(agent.id);
        if (cancelled) return;
        setHelper(agent);
        applyRuntimeConfig(agent, config);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Unable to load Apteva Helper settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [providerSignature, applyRuntimeConfig, helperRevision]);

  const activateHelper = async () => {
    setActivationBusy(true);
    setError("");
    try {
      const status = await platformHelper.activate(false);
      setHelperStatus(status);
      window.dispatchEvent(new Event("apteva:helper-changed"));
      const agent = await platformHelper.get();
      const config = await core.config(agent.id);
      setHelper(agent);
      applyRuntimeConfig(agent, config);
    } catch (err: any) {
      setError(err?.message || "Unable to activate Apteva Helper.");
    } finally {
      setActivationBusy(false);
    }
  };

  const deactivateHelper = async () => {
    setActivationBusy(true);
    setError("");
    try {
      const status = await platformHelper.deactivate();
      setHelperStatus(status);
      window.dispatchEvent(new Event("apteva:helper-changed"));
      setHelper(null);
      setSelectedCapabilityIDs([]);
      capabilitiesDirty.current = false;
    } catch (err: any) {
      setError(err?.message || "Unable to deactivate Apteva Helper.");
    } finally {
      setActivationBusy(false);
    }
  };

  const collaborationCapability = capabilityInventory.find((capability) => capability.source === "app" && capability.name === "a2a");

  const selectedProviderRow = textProviders.find((connection) => connection.provider_key === selectedProvider) || null;

  useEffect(() => {
    let cancelled = false;
    setCatalog([]);
    if (!selectedProviderRow) return () => { cancelled = true; };
    setLoadingModels(true);
    const loadModels = async () => {
      try {
        const nextCatalog = await integrations.connectionModels(selectedProviderRow.id);
        if (!cancelled) setCatalog(nextCatalog);
      } catch {
        // A provider without model discovery can still accept a model ID.
      }
    };
    void loadModels()
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Unable to load provider models.");
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => { cancelled = true; };
  }, [selectedProviderRow?.id]);

  const uniqueCatalog = catalog.filter((model, index, rows) => rows.findIndex((row) => row.id === model.id) === index);
  const runtimeModelSummary = runtimeModels.large || "provider default";

  const save = async () => {
    if (!helper || !selectedProvider || !selectedProviderRow) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await instancesAPI.updateConfig(helper.id, {
        providers: textProviders.map((connection) => ({
          name: connection.provider_key,
          default: connection.provider_key === selectedProvider,
        })),
        modelOverride: selectedModel,
        serviceTierOverrides: serviceTierPatch(helper.config, serviceTierOverrides),
      });
      const refreshedHelper = await platformHelper.get();
      const config = await core.config(refreshedHelper.id);
      setHelper(refreshedHelper);
      applyRuntimeConfig(refreshedHelper, config);
      setNotice("Helper settings updated.");
    } catch (err: any) {
      setError(err?.message || "Unable to update Apteva Helper.");
    } finally {
      setSaving(false);
    }
  };

  const saveCapabilities = async () => {
    setCapabilitiesSaving(true);
    setCapabilitiesError("");
    setCapabilitiesNotice("");
    try {
      const result = await platformHelper.updateCapabilities(selectedCapabilityIDs);
      setSelectedCapabilityIDs(result.selected_mcp_server_ids || []);
      capabilitiesDirty.current = false;
      if (result.applied) {
        setCapabilitiesNotice(
          result.reset_threads
            ? "Global capabilities updated. Active Helper conversations will reconnect with the new tool set on their next message."
            : "Global capabilities updated.",
        );
      } else {
        setCapabilitiesNotice("Saved, but the running Helper will apply these capabilities on its next restart.");
      }
    } catch (err: any) {
      setCapabilitiesError(err?.message || "Unable to update Helper capabilities.");
    } finally {
      setCapabilitiesSaving(false);
    }
  };

  const toggleCapability = (id: number) => {
    capabilitiesDirty.current = true;
    setSelectedCapabilityIDs((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
    setCapabilitiesNotice("");
  };

  if (!loading && helperStatus && !helperStatus.activated) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h2 className="text-base font-bold text-text">Helper</h2>
          <p className="mt-1 text-sm text-text-muted">Apteva Helper is enabled by default when global Conversations and an AI provider are available. Deactivating it here keeps it off until you activate it again.</p>
        </div>
        <section className="rounded-lg border border-border bg-bg-card p-5">
          <h3 className="text-sm font-bold text-text">Activate Apteva Helper</h3>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-text-muted">
            Activation requires an AI provider and a running global Conversations installation.
          </p>
          {!helperStatus.provider_configured && (
            <p className="mt-3 rounded-md border border-dashed border-border p-3 text-xs text-text-muted">Connect a text provider in Providers before activating Helper.</p>
          )}
          {!helperStatus.conversations_installed && <p className="mt-3 text-xs text-text-muted">Install or enable Conversations globally in <Link to="/apps" className="text-accent">Apps</Link> to use Helper.</p>}
          {helperStatus.default_enabled !== false && <button type="button" onClick={() => void deactivateHelper()} disabled={activationBusy} className="mt-3 text-xs text-text-muted underline">Keep Helper disabled</button>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void activateHelper()} disabled={activationBusy || !helperStatus.provider_configured || !helperStatus.conversations_installed} className="h-9 rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-50">
              {activationBusy ? "Activating…" : "Activate Helper"}
            </button>
            {error && <span className="text-xs text-red">{error}</span>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h2 className="text-base font-bold text-text">Helper</h2>
        <p className="mt-1 text-sm text-text-muted">Configure the Apteva Helper used for dashboard assistance.</p>
      </div>

      <section className="rounded-lg border border-border bg-bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-text">Apteva Helper</h3>
              {helper && <span className={`inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide ${helper.status === "running" ? "text-green" : "text-text-dim"}`}><span className={`h-1.5 w-1.5 rounded-full ${helper.status === "running" ? "bg-green" : "bg-text-dim"}`} />{helper.status}</span>}
            </div>
            <p className="mt-1 text-xs text-text-muted">Provider and model choices here apply only to the Helper.</p>
          </div>
          <div className="flex items-center gap-2">
            {!loading && helper && <div className="rounded-md bg-bg-hover px-2.5 py-1.5 text-[10px] text-text-muted">Current: <span className="font-semibold text-text">{runtimeProvider || "unknown"}</span> · {runtimeModelSummary}</div>}
            {helper && <button type="button" onClick={() => void deactivateHelper()} disabled={activationBusy} className="rounded-md border border-border px-2.5 py-1.5 text-[10px] font-semibold text-text-muted hover:text-text disabled:opacity-50">{activationBusy ? "Stopping…" : "Deactivate"}</button>}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {loading ? (
            <div className="text-xs text-text-dim">Loading Helper settings…</div>
          ) : textProviders.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-text-muted">Connect a text provider in Providers before configuring the Helper.</div>
          ) : (
            <div className="grid max-w-2xl gap-5">
              <label className="grid gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Provider</span>
                <select
                  value={selectedProvider}
                  onChange={(event) => {
                    setSelectedProvider(event.target.value);
                    setSelectedModel(helper ? savedModelOverride(helper, event.target.value) : "");
                    setNotice("");
                  }}
                  className="h-10 rounded-md border border-border bg-bg-input px-3 text-sm text-text focus:border-accent focus:outline-none"
                >
                  {textProviders.map((connection) => <option key={connection.id} value={connection.provider_key}>{connection.app_name}{connection.scope === "project" ? " · project" : " · global"}</option>)}
                </select>
              </label>

              <ServiceTierSelect connection={selectedProviderRow} inherit value={serviceTierOverrides[selectedProvider]} disabled={saving} onChange={(value) => setServiceTierOverrides((current) => ({ ...current, [selectedProvider]: value }))} />

              <label className="grid gap-1.5">
                <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-text-dim">Main model {loadingModels && <span className="font-normal normal-case">Loading…</span>}</span>
                {uniqueCatalog.length > 0 ? (
                  <select
                    value={selectedModel}
                    onChange={(event) => { setSelectedModel(event.target.value); setNotice(""); }}
                    className="h-10 rounded-md border border-border bg-bg-input px-3 text-sm text-text focus:border-accent focus:outline-none"
                  >
                    <option value="">Provider default{selectedProvider === runtimeProvider && runtimeModels.large ? ` (${runtimeModels.large})` : ""}</option>
                    {selectedModel && !uniqueCatalog.some((model) => model.id === selectedModel) && <option value={selectedModel}>{selectedModel}</option>}
                    {uniqueCatalog.map((model) => <option key={model.id} value={model.id}>{model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id}</option>)}
                  </select>
                ) : (
                  <input
                    value={selectedModel}
                    onChange={(event) => { setSelectedModel(event.target.value); setNotice(""); }}
                    placeholder="Provider default"
                    className="h-10 rounded-md border border-border bg-bg-input px-3 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
                  />
                )}
                <span className="text-[10px] leading-relaxed text-text-dim">Use the provider default or pin one model for all Helper work. Other agents are unaffected.</span>
              </label>

              <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
                <button type="button" onClick={() => void save()} disabled={saving || loadingModels || !selectedProviderRow} className="h-9 rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-50">{saving ? "Saving…" : "Save Helper settings"}</button>
                <span className="text-[10px] text-text-dim">Credentials and provider-wide defaults remain in Providers.</span>
                {notice && <span className="text-xs text-green">{notice}</span>}
                {error && <span className="text-xs text-red">{error}</span>}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card">
        <div className="border-b border-border-subtle p-4 sm:p-5">
          <h3 className="text-sm font-bold text-text">Global capabilities</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
            Allow Apteva Helper to use selected global apps and integrations. Project-scoped
            capabilities stay unavailable so one project cannot leak tools into another.
          </p>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-hover px-3 py-2">
              <AppIcon src="/apteva-server.svg" iconStyle="monochrome" name="Apteva Server" size="md" className="rounded-lg border border-border text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-text">Apteva Server</span>
                <span className="block text-[10px] text-text-dim">Built-in integration · auto-attached</span>
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wide text-text-dim">required</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-hover px-3 py-2">
              <span className="text-xs font-medium text-text">Environments</span>
              <span className="text-[9px] font-bold uppercase tracking-wide text-text-dim">required</span>
            </div>
          </div>

          {!capabilitiesLoading && (!capabilitiesError || capabilityInventory.length > 0) && (
            <div className="mb-4 rounded-lg border border-border p-4">
              <h4 className="text-xs font-semibold text-text">Let Helper collaborate with your agents</h4>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">Agent to Agent (A2A) lets Helper discover reachable agents, delegate work, and receive replies. Each participating agent needs A2A attached; project access rules still apply.</p>
              {collaborationCapability ? (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-text">
                  <input type="checkbox" checked={selectedCapabilityIDs.includes(collaborationCapability.id)}
                    disabled={capabilitiesSaving} onChange={() => toggleCapability(collaborationCapability.id)} className="h-4 w-4 accent-[var(--accent)]" />
                  Enable Agent to Agent for Helper
                </label>
              ) : (
                <p className="mt-3 text-xs text-text-muted">Install or enable A2A globally in <Link to="/apps" className="text-accent hover:underline">Apps</Link>, then return here to attach it.</p>
              )}
              <p className="mt-2 text-[11px] text-text-dim">Save global capabilities below to apply your selection. Remote peers are configured separately.</p>
            </div>
          )}

          {capabilitiesLoading ? (
            <div className="text-xs text-text-dim">Loading global capabilities…</div>
          ) : capabilityInventory.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-text-muted">
              No global app or integration MCPs are available. Install or connect one globally,
              then return here to enable it for the Helper.
            </div>
          ) : (
            <div className="grid gap-2">
              {capabilityInventory.filter((capability) => capability.id !== collaborationCapability?.id).map((capability) => {
                const checked = selectedCapabilityIDs.includes(capability.id);
                return (
                  <label
                    key={capability.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 transition-colors ${
                      checked ? "border-accent/60 bg-accent/5" : "border-border bg-bg hover:border-accent/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={capabilitiesSaving}
                      checked={checked}
                      onChange={() => toggleCapability(capability.id)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-text">
                        {helperCapabilityLabel(capability)}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-text-dim">
                        {capability.name} · {capability.tool_count || 0} tools
                      </span>
                    </span>
                    <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-text-dim">
                      {helperCapabilityKind(capability)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
            <button
              type="button"
              onClick={() => void saveCapabilities()}
              disabled={capabilitiesLoading || capabilitiesSaving}
              className="h-9 rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-50"
            >
              {capabilitiesSaving ? "Saving…" : "Save global capabilities"}
            </button>
            <span className="text-[10px] text-text-dim">
              Changes affect Helper only; ordinary agents keep their existing capabilities.
            </span>
            {capabilitiesNotice && <span className="text-xs text-green">{capabilitiesNotice}</span>}
            {capabilitiesError && <span className="text-xs text-red">{capabilitiesError}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
