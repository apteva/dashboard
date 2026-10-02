import { ServiceTierSelect } from "../../components/ServiceTierSelect";
import { useState, useEffect, useCallback } from "react";

import { AppIcon } from "@apteva/ui-kit";
import { auth, integrations, runtimeEntryAsAppDetail, type RuntimeCatalogEntry, type RuntimeConnection, type ConnectionInfo, type ConnectCreateResponse, type DeviceAuthStart, type ConnectionTestResult, type ProviderUsageSnapshot } from "../../api";
import { useNewAgentProviderDefault } from "../../hooks/useNewAgentProviderDefault";
import { Modal } from "../../components/Modal";

import { ProviderUsageDetails, ProviderUsageSummary } from "../../components/ProviderUsage";
import { ProviderPicker } from "../../components/integrations/ProviderPicker";
import { CredentialFields } from "../../components/integrations/CredentialFields";
import { ConnectionReauthDialog, DeviceCodeAuthPanel, isConnectionReauthable } from "../../components/integrations/ConnectionReauthDialog";
import { defaultIntegrationAuthType } from "../../utils/integrationAuth";
import { useProjects } from "../../hooks/useProjects";

import { useTranslation } from "react-i18next";

import { primaryRuntimeConnections, groupRuntimeConnectionsByProvider } from "./modelUtils";

export function ProvidersTab() {
  const { currentProject } = useProjects();
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<RuntimeCatalogEntry[]>([]);
  const [connected, setConnected] = useState<RuntimeConnection[]>([]);
  const defaults = useNewAgentProviderDefault(currentProject?.id, connected);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState<RuntimeCatalogEntry | null>(
    null,
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busyID, setBusyID] = useState<number | null>(null);
  // makeGlobal — when true the connection is created with project_id=""
  // and is visible from every project. Project-scoped credentials still
  // win over globals when both exist, so this is a sharing choice rather
  // than a precedence one.
  const [makeGlobal, setMakeGlobal] = useState(false);
  const [testResultByID, setTestResultByID] = useState<
    Record<number, ConnectionTestResult>
  >({});
  const [usageByID, setUsageByID] = useState<
    Record<number, ProviderUsageSnapshot>
  >({});
  const [usageLoadingByID, setUsageLoadingByID] = useState<
    Record<number, boolean>
  >({});
  const [usageErrorByID, setUsageErrorByID] = useState<Record<number, string>>(
    {},
  );
  const [usageDetails, setUsageDetails] = useState<{
    connection: RuntimeConnection;
    usage: ProviderUsageSnapshot;
  } | null>(null);
  const [reauthFor, setReauthFor] = useState<RuntimeConnection | null>(null);
  const [pendingDeviceAuth, setPendingDeviceAuth] = useState<{
    connection: ConnectionInfo;
    auth: DeviceAuthStart;
  } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    integrations
      .runtimeConnections(currentProject?.id)
      .then(setConnected)
      .catch(() => setError("Could not load connected providers."))
      .finally(() => setLoading(false));
    integrations
      .runtimeCatalog("llm")
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [currentProject?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadUsage = useCallback(
    async (connectionID: number, refresh = false) => {
      setUsageLoadingByID((current) => ({ ...current, [connectionID]: true }));
      try {
        const usage = await integrations.connectionUsage(connectionID, refresh);
        setUsageByID((current) => ({ ...current, [connectionID]: usage }));
        setUsageErrorByID((current) => {
          if (!current[connectionID]) return current;
          const next = { ...current };
          delete next[connectionID];
          return next;
        });
      } catch (err: any) {
        setUsageErrorByID((current) => ({
          ...current,
          [connectionID]: err?.message || "Usage unavailable",
        }));
      } finally {
        setUsageLoadingByID((current) => ({
          ...current,
          [connectionID]: false,
        }));
      }
    },
    [],
  );

  // Poll quota for subscription-backed connections only. Capability now
  // comes from the catalog's runtime block instead of provider_types.
  const usageEligibleIDs = connected
    .filter((connection) =>
      connection.capabilities?.includes("subscription_usage"),
    )
    .map((connection) => connection.id)
    .join(",");

  useEffect(() => {
    const ids = usageEligibleIDs ? usageEligibleIDs.split(",").map(Number) : [];
    if (ids.length === 0) return;
    const refreshEligible = () => {
      if (document.visibilityState !== "visible") return;
      ids.forEach((id) => void loadUsage(id));
    };
    refreshEligible();
    const interval = window.setInterval(refreshEligible, 5 * 60 * 1000);
    window.addEventListener("focus", refreshEligible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshEligible);
    };
  }, [usageEligibleIDs, loadUsage]);

  // Group connections by provider_key. A group with more than one member
  // is where the operator has to choose which credential agents use —
  // the providers table used to decide this silently by lowest id.
  const providerGroups = groupRuntimeConnectionsByProvider(connected);

  const targetProjectID = (): string =>
    makeGlobal || !currentProject ? "" : currentProject.id;

  const openConnect = (entry: RuntimeCatalogEntry) => {
    setShowAddProvider(false);
    setConfiguring(entry);
    setCredentials({});
    setMakeGlobal(false);
    setError("");
  };

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configuring) return;
    const trimmed: Record<string, string> = {};
    for (const field of configuring.credential_fields || []) {
      const value = (credentials[field.name] || "").trim();
      if (value) trimmed[field.name] = value;
    }
    const authType =
      defaultIntegrationAuthType(runtimeEntryAsAppDetail(configuring)) ||
      "api_key";
    const managedAuth =
      authType === "oauth1" ||
      authType === "oauth2" ||
      authType === "oauth_device_code";
    if (Object.keys(trimmed).length === 0 && !managedAuth) {
      setError("At least one field is required");
      return;
    }
    setError("");
    try {
      // auto_mcp off: this credential backs the agent runtime. Exposing
      // the provider's REST tools to every agent is a separate choice,
      // made in Integrations.
      const response = await integrations.connect(
        configuring.slug,
        configuring.name,
        trimmed,
        authType,
        targetProjectID(),
        undefined,
        "integration",
        false,
      );
      const flow = response as ConnectCreateResponse;
      if (flow.device_auth && flow.connection) {
        setPendingDeviceAuth({
          connection: flow.connection,
          auth: flow.device_auth,
        });
        setConfiguring(null);
        return;
      }
      if (flow.redirect_url && flow.connection) {
        const popup = window.open(
          flow.redirect_url,
          "apteva-oauth",
          "width=540,height=680,menubar=no,toolbar=no,location=no",
        );
        if (!popup)
          throw new Error(
            "The sign-in popup was blocked. Allow popups and try again.",
          );
        let attempts = 0;
        const poll = async () => {
          attempts += 1;
          try {
            const connection = await integrations.get(flow.connection.id);
            if (
              connection.status === "active" ||
              connection.status === "failed"
            ) {
              load();
              return;
            }
          } catch {
            // A transient read should not abandon an in-progress OAuth flow.
          }
          if (attempts < 120) window.setTimeout(poll, 1500);
        };
        window.setTimeout(poll, 1500);
      }
      setConfiguring(null);
      setCredentials({});
      setMakeGlobal(false);
      load();
    } catch (err: any) {
      const body = err?.body;
      setError(
        body?.status_code
          ? `${body.status_code} — ${err.message || "Failed"}`
          : err?.message || "Failed",
      );
    }
  };

  const handleTest = async (connection: RuntimeConnection) => {
    setBusyID(connection.id);
    try {
      const result = await integrations.testConnection(connection.id);
      setTestResultByID((current) => ({ ...current, [connection.id]: result }));
    } catch (err: any) {
      setTestResultByID((current) => ({
        ...current,
        [connection.id]: {
          ok: false,
          latency_ms: 0,
          error: String(err?.message || "test failed"),
        },
      }));
    } finally {
      setBusyID(null);
    }
  };

  const handleMakePrimary = async (connection: RuntimeConnection) => {
    if (connection.is_primary) return;
    setBusyID(connection.id);
    try {
      await integrations.setPrimary(connection.id);
      load();
    } catch (err: any) {
      setError(err?.message || "Could not set primary");
    } finally {
      setBusyID(null);
    }
  };

  const handleDisconnect = async (connection: RuntimeConnection) => {
    setBusyID(connection.id);
    try {
      await integrations.disconnect(connection.id);
      load();
    } catch (err: any) {
      setError(err?.message || "Could not disconnect");
    } finally {
      setBusyID(null);
    }
  };

  const handleServiceTier = async (connection: RuntimeConnection, value: string | null) => {
    setBusyID(connection.id); setError("");
    try {
      await integrations.updateRuntimeConfig(connection.id, { service_tier: value || null });
      load();
    } catch (err: any) { setError(err?.message || "Could not save service tier"); }
    finally { setBusyID(null); }
  };

  const handlePinModel = async (
    connection: RuntimeConnection,
    tier: string,
    model: string,
  ) => {
    setBusyID(connection.id);
    try {
      // Empty string means "provider default" — send null so the key is
      // removed rather than stored as a model ID of "".
      await integrations.updateRuntimeConfig(connection.id, {
        [`model_${tier}`]: model.trim() || null,
      });
      load();
    } catch (err: any) {
      setError(err?.message || "Could not save model");
    } finally {
      setBusyID(null);
    }
  };

  const effectiveConnections = primaryRuntimeConnections(connected);
  const providerName = (key: string) =>
    catalog.find((entry) => entry.provider_key === key)?.name || key;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-text text-lg font-bold">Providers</h2>
          <p className="text-text-muted text-sm mt-1">
            {currentProject
              ? `Model providers for ${currentProject.name}, including shared global connections.`
              : "Your model providers, across all projects."}
          </p>
          <p className="text-text-dim text-xs mt-1">
            Set the default on a card to use it for new agents. Existing agents
            keep their provider.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setProviderSearch("");
            setShowAddProvider(true);
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-bg hover:bg-accent-hover"
        >
          <span aria-hidden="true">+</span> Add provider
        </button>
      </div>

      {error && (
        <div role="alert" className="text-red text-sm">
          {error}
        </div>
      )}
      {defaults.error && (
        <div role="alert" className="text-red text-sm">
          {defaults.error}{" "}
          <button onClick={defaults.retry} className="underline">
            Retry
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>
          {loading
            ? "Loading connections…"
            : `${providerGroups.length} connected provider${providerGroups.length === 1 ? "" : "s"}`}
        </span>
        {defaults.settings?.provider && (
          <button
            type="button"
            disabled={defaults.busy}
            onClick={() => void defaults.save("")}
            className="underline underline-offset-4 hover:text-text disabled:opacity-50"
          >
            {currentProject
              ? "Use account default"
              : "Choose default automatically"}
          </button>
        )}
        <span role="status" className="text-accent">
          {defaults.busy
            ? "Saving default…"
            : defaults.saved
              ? "Default saved"
              : ""}
        </span>
        {defaults.settings?.provider &&
          !defaults.settings.available_providers.includes(
            defaults.settings.provider,
          ) && (
            <span>
              Saved default unavailable. Using{" "}
              {providerName(defaults.settings.effective_provider)}.
            </span>
          )}
      </div>

      {!loading && connected.length === 0 && (
        <div className="py-16 text-center">
          <h3 className="text-text font-semibold">
            Connect your first provider
          </h3>
          <p className="mt-2 text-sm text-text-muted">
            Add a model provider to get your agents thinking.
          </p>
          <button
            type="button"
            onClick={() => {
              setProviderSearch("");
              setShowAddProvider(true);
            }}
            className="mt-4 text-sm text-accent hover:underline"
          >
            Choose a provider
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {providerGroups.map(([groupKey, group]) => {
          const first = group[0]!;
          const entry = catalog.find(
            (entry) => entry.provider_key === first.provider_key,
          );
          const effective = effectiveConnections.find(
            (connection) => connection.provider_key === first.provider_key,
          );
          const activeScope = effective?.id === first.id;
          const isDefault =
            activeScope &&
            defaults.settings?.effective_provider === first.provider_key;
          const canSelectDefault =
            activeScope &&
            defaults.settings?.available_providers.includes(first.provider_key);
          return (
            <section
              key={groupKey}
              aria-label={`${first.app_name || first.provider_key} ${first.scope} provider`}
              className={`min-w-0 rounded-xl border p-4 ${isDefault ? "border-accent/60" : "border-border"}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <AppIcon
                  src={entry?.logo || undefined}
                  name={first.app_name || first.provider_key}
                  size="md"
                  framed={false}
                />
                <div className="min-w-0 flex-1">
                  <h3 className="text-text text-sm font-bold truncate">
                    {first.app_name || first.provider_key}
                  </h3>
                  <span className="text-xs text-text-muted">
                    {first.scope === "global"
                      ? "Shared across projects"
                      : currentProject?.name || "Project connection"}
                    {group.length > 1 ? ` · ${group.length} credentials` : ""}
                  </span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {group.map((connection, index) => {
                  const busy = busyID === connection.id;
                  const result = testResultByID[connection.id];
                  const content = (
                    <div className="space-y-3 pb-3">
                      {group.length > 1 && (
                        <label className="flex items-center gap-2 text-xs text-text-muted">
                          <input
                            type="radio"
                            name={`primary-${groupKey}`}
                            checked={connection.is_primary}
                            onChange={() => void handleMakePrimary(connection)}
                            disabled={busy}
                            className="accent-accent"
                            aria-label={`Use ${connection.name} as the primary credential`}
                          />
                          Use this credential for{" "}
                          {first.app_name || first.provider_key}
                        </label>
                      )}
                      {!!connection.capabilities?.includes(
                        "subscription_usage",
                      ) && (
                        <ProviderUsageSummary
                          usage={usageByID[connection.id]}
                          loading={usageLoadingByID[connection.id]}
                          refreshing={
                            usageLoadingByID[connection.id] &&
                            !!usageByID[connection.id]
                          }
                          error={usageErrorByID[connection.id]}
                          onRefresh={() => void loadUsage(connection.id, true)}
                          onOpenDetails={() => {
                            const usage = usageByID[connection.id];
                            if (usage) setUsageDetails({ connection, usage });
                          }}
                        />
                      )}
                      {connection.runtime_config?.model_selection_errors && (
                        <div role="alert" className="text-xs text-red-400 space-y-1">
                          {Object.entries(connection.runtime_config.model_selection_errors).map(([tier, message]) => (
                            <p key={tier}>{String(message)}</p>
                          ))}
                        </div>
                      )}
                      <ServiceTierSelect connection={connection} value={connection.runtime_config?.service_tier || ""} disabled={busy} onChange={(value) => void handleServiceTier(connection, value)} />
                      <div className="space-y-1.5">
                        {(["large", "medium", "small"] as const).map((tier) => (
                          <label
                            key={tier}
                            className="flex items-center gap-3 min-w-0"
                          >
                            <span className="w-12 shrink-0 text-xs capitalize text-text-muted">
                              {tier}
                            </span>
                            <input
                              type="text"
                              key={`${connection.id}-${tier}-${connection.runtime_config?.[`model_${tier}`] || ""}`}
                              defaultValue={
                                connection.runtime_config?.[`model_${tier}`] ||
                                ""
                              }
                              placeholder="Provider default"
                              onBlur={(event) => {
                                const next = event.target.value;
                                const current =
                                  connection.runtime_config?.[
                                    `model_${tier}`
                                  ] || "";
                                if (next.trim() !== String(current).trim())
                                  void handlePinModel(connection, tier, next);
                              }}
                              disabled={busy}
                              spellCheck={false}
                              className="min-w-0 w-full rounded border border-border bg-transparent px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
                            />
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <button
                          onClick={() => void handleTest(connection)}
                          disabled={busy}
                          className="text-xs text-text-muted hover:text-accent disabled:opacity-50"
                        >
                          {busy ? "Working…" : "Test connection"}
                        </button>
                        {isConnectionReauthable(connection.auth_type || "") && (
                          <button
                            onClick={() => setReauthFor(connection)}
                            disabled={busy}
                            className="text-xs text-text-muted hover:text-accent disabled:opacity-50"
                          >
                            Re-auth
                          </button>
                        )}
                        <button
                          onClick={() => void handleDisconnect(connection)}
                          disabled={busy}
                          className="ml-auto text-xs text-text-dim hover:text-red disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      </div>
                      {result && (
                        <p
                          className={`text-xs break-words ${result.ok ? "text-green" : "text-red"}`}
                        >
                          {result.ok
                            ? `✓ Connected (${result.latency_ms}ms)`
                            : result.error || "Connection failed"}
                        </p>
                      )}
                    </div>
                  );
                  return group.length > 1 ? (
                    <details
                      key={connection.id}
                      open={index === 0}
                      className="pt-2 first:pt-0"
                    >
                      <summary className="cursor-pointer text-xs text-text mb-3">
                        {connection.name}
                        {connection.is_primary && (
                          <span className="ml-2 text-text-muted">
                            Primary credential
                          </span>
                        )}
                      </summary>
                      {content}
                    </details>
                  ) : (
                    <div key={connection.id}>
                      {connection.name !== first.app_name && (
                        <p className="text-xs text-text-muted mb-3 truncate">
                          {connection.name}
                        </p>
                      )}
                      {content}
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-border pt-3">
                {canSelectDefault ? (
                  <button
                    type="button"
                    aria-label={`Make ${first.app_name || first.provider_key} the default for new agents`}
                    aria-pressed={!!isDefault}
                    disabled={
                      defaults.busy ||
                      (isDefault &&
                        defaults.settings?.provider === first.provider_key)
                    }
                    onClick={() => void defaults.save(first.provider_key)}
                    className={`text-xs font-semibold disabled:cursor-default ${isDefault ? "text-accent" : "text-text-muted hover:text-accent"} ${defaults.busy ? "opacity-50" : ""}`}
                  >
                    {isDefault
                      ? "✓ Default for new agents"
                      : "Make default for new agents"}
                  </button>
                ) : (
                  <span className="text-xs text-text-dim">
                    {!defaults.settings
                      ? "Loading default…"
                      : !activeScope
                        ? "Project credentials take priority"
                        : "Unavailable for new agents"}
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Modal
        open={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        ariaLabel="Add provider"
        width="max-w-2xl"
      >
        <div className="flex items-start justify-between gap-4 p-5 pb-4">
          <div>
            <h3 className="text-base text-text font-bold">Add provider</h3>
            <p className="text-sm text-text-muted mt-1">
              Connect a new provider or add another credential.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddProvider(false)}
            aria-label="Close add provider"
            className="text-text-muted hover:text-text text-xl"
          >
            ×
          </button>
        </div>
        <div className="px-5 pb-5 min-h-0">
          <ProviderPicker entries={catalog} query={providerSearch} onQueryChange={setProviderSearch} onSelect={openConnect} connectedSlugs={connected.map((connection) => connection.app_slug)} />
        </div>
      </Modal>

      {/* Credential form. Same renderer as every other integration, so
          inputs carry the catalog's labels rather than env var names. */}
      <Modal
        open={!!configuring}
        onClose={() => setConfiguring(null)}
        ariaLabel="Connect provider"
      >
        {configuring && (
          <form
            onSubmit={handleConnect}
            className="p-6 space-y-4 overflow-y-auto"
          >
            <h3 className="text-text text-base font-bold">
              {configuring.name}
            </h3>
            <p className="text-text-muted text-sm">{configuring.description}</p>

            <CredentialFields
              detail={runtimeEntryAsAppDetail(configuring)}
              credentials={credentials}
              setCredentials={setCredentials}
            />

            {currentProject && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={makeGlobal}
                  onChange={(e) => setMakeGlobal(e.target.checked)}
                  className="mt-1 accent-accent"
                />
                <span className="text-sm text-text-muted leading-snug">
                  <span className="text-text">Make global</span> — share these
                  credentials with every project, not just{" "}
                  <b>{currentProject.name}</b>.
                  <br />
                  <span className="text-[11px] text-text-dim">
                    Project-scoped credentials override globals when both exist.
                  </span>
                </span>
              </label>
            )}

            {error && <div className="text-red text-sm">{error}</div>}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfiguring(null)}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
              >
                Connect
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!usageDetails}
        onClose={() => setUsageDetails(null)}
        ariaLabel={t("settings.providers.usageDetails")}
      >
        {usageDetails ? (
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h3 className="text-text text-base font-bold">
                  {t("settings.providers.usageDetails")}
                </h3>
                <p className="text-xs text-text-muted mt-1">
                  {usageDetails.connection.name}
                  {usageDetails.usage.plan
                    ? ` · ${usageDetails.usage.plan}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUsageDetails(null)}
                className="w-8 h-8 inline-flex items-center justify-center border border-border rounded text-text-muted hover:text-text"
                aria-label={t("settings.providers.close")}
                title={t("settings.providers.close")}
              >
                ×
              </button>
            </div>
            <ProviderUsageDetails usage={usageDetails.usage} />
          </div>
        ) : null}
      </Modal>

      <ConnectionReauthDialog
        connection={reauthFor}
        onClose={() => setReauthFor(null)}
        onComplete={() => {
          setReauthFor(null);
          load();
        }}
      />
      <Modal
        open={!!pendingDeviceAuth}
        onClose={() => setPendingDeviceAuth(null)}
        width="max-w-md"
        ariaLabel="Complete provider sign-in"
      >
        <div className="w-full space-y-4 p-5">
          <div>
            <h2 className="text-base font-bold text-text">
              Connect {pendingDeviceAuth?.connection.name}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Authorize this provider without changing its project scope or
              model configuration.
            </p>
          </div>
          {pendingDeviceAuth && (
            <DeviceCodeAuthPanel
              auth={pendingDeviceAuth.auth}
              onConnected={() => {
                setPendingDeviceAuth(null);
                load();
              }}
              onError={setError}
            />
          )}
          {error && <div className="text-sm text-red">{error}</div>}
          <div className="flex justify-end border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setPendingDeviceAuth(null)}
              className="text-sm text-text-muted hover:text-text"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
