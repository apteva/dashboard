import { useState, useEffect } from "react";

import { integrations, serverSettings, type RuntimeConnection, type ServerSettings as ServerSettingsType, type AccessPolicy } from "../../api";

import { DomainHTTPSSettings } from "../../components/DomainHTTPSSettings";

import { useAuth } from "../../hooks/useAuth";

export function ServerTab({ section = "public" }: { section?: "public" | "access" | "lifecycle" | "geoip" }) {
  const { user } = useAuth();
  const isAdmin = !!user && user.role === "admin";
  const [data, setData] = useState<ServerSettingsType | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [lifecyclePolicy, setLifecyclePolicy] = useState<"restart" | "rolling" | "preserve">("restart");
  const [bootResume, setBootResume] = useState<"auto" | "staggered" | "manual">("staggered");
  const [bootDelay, setBootDelay] = useState("5s");
  const [rolloutDelay, setRolloutDelay] = useState("15s");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [geoIPEnabled, setGeoIPEnabled] = useState(false);
  const [geoIPSource, setGeoIPSource] = useState<"dbip" | "maxmind" | "test">("dbip");
  const [geoIPAccountID, setGeoIPAccountID] = useState("");
  const [geoIPLicenseKey, setGeoIPLicenseKey] = useState("");
  const [geoIPSaving, setGeoIPSaving] = useState(false);
  const [accessPolicy, setAccessPolicy] = useState<AccessPolicy | null>(null);
  const [accessSaving, setAccessSaving] = useState(false);
  const [llmConnections, setLLMConnections] = useState<RuntimeConnection[]>([]);

  const load = () => {
    serverSettings
      .get()
      .then((d) => {
        setData(d);
        setDraft(d.public_url.value);
        setLifecyclePolicy(d.agent_lifecycle.update_policy);
        setBootResume(d.agent_lifecycle.boot_resume);
        setBootDelay(d.agent_lifecycle.boot_resume_delay);
        setRolloutDelay(d.agent_lifecycle.rollout_delay);
        setGeoIPEnabled(d.geoip.enabled);
        if (d.geoip.source === "dbip" || d.geoip.source === "maxmind" || d.geoip.source === "test") setGeoIPSource(d.geoip.source);
        setGeoIPAccountID(d.geoip.account_id || "");
        setAccessPolicy(d.access_policy);
      })
      .catch((err) => setError(err?.message || "Failed to load"));
    if (isAdmin && section === "access") {
      integrations.runtimeConnections().then((connections) => {
        setLLMConnections(connections.filter((connection) => connection.role === "llm"));
      }).catch(() => setLLMConnections([]));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const updated = await serverSettings.update({ public_url: draft.trim() });
      setData(updated);
      setDraft(updated.public_url.value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return <div className="text-sm" role={error ? "alert" : "status"}>{error || "Loading…"}{error && <button className="ml-3 text-accent" onClick={load}>Retry</button>}</div>;
  }

  const pu = data.public_url;

  const handleLifecycleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setLifecycleSaving(true);
    try {
      const updated = await serverSettings.update({
        agent_update_policy: lifecyclePolicy,
        agent_boot_resume: bootResume,
        agent_boot_resume_delay: bootDelay,
        agent_rollout_delay: rolloutDelay,
      });
      setData(updated);
      setLifecyclePolicy(updated.agent_lifecycle.update_policy);
      setBootResume(updated.agent_lifecycle.boot_resume);
      setBootDelay(updated.agent_lifecycle.boot_resume_delay);
      setRolloutDelay(updated.agent_lifecycle.rollout_delay);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message || "Failed to save agent lifecycle settings");
    } finally {
      setLifecycleSaving(false);
    }
  };

  const handleGeoIPSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    setGeoIPSaving(true);
    try {
      const patch: Parameters<typeof serverSettings.update>[0] = {
        geoip_enabled: geoIPEnabled,
        geoip_source: geoIPSource,
        geoip_account_id: geoIPAccountID.trim(),
      };
      if (geoIPLicenseKey.trim()) patch.geoip_license_key = geoIPLicenseKey.trim();
      const updated = await serverSettings.update(patch);
      setData(updated);
      setGeoIPLicenseKey("");
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        load();
      }, 1800);
    } catch (err: any) {
      setError(err?.message || "Failed to save country lookup settings");
    } finally {
      setGeoIPSaving(false);
    }
  };

  const handleAccessSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessPolicy) return;
    setError("");
    setSaved(false);
    setAccessSaving(true);
    try {
      const updated = await serverSettings.update({ access_policy: accessPolicy });
      setData(updated);
      setAccessPolicy(updated.access_policy);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message || "Failed to save access policy");
    } finally {
      setAccessSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold">{{ public: "Domain configuration", access: "Registration & access policy", lifecycle: "Agent startup & restarts", geoip: "Visitor country" }[section]}</h2>
        <p className="text-text-muted text-sm mt-1">Changes here affect the entire server.</p>
        {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
        {saved && <p role="status" className="mt-2 text-sm text-success">Settings saved.</p>}
      </div>

      {section === "public" && isAdmin && <>
      <DomainHTTPSSettings onActivated={() => { void serverSettings.get().then(updated => { setData(updated); setDraft(updated.public_url.value); }).catch(() => {}); }} />
      <details className="border border-border rounded-lg bg-bg-card">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Advanced public URL override</summary>
      <form onSubmit={handleSave} className="p-5 pt-0 space-y-4">
        <div>
          <label className="block text-text text-sm font-bold mb-1">Public URL</label>
          <p className="text-text-muted text-xs mb-3 leading-relaxed">
            The base URL external services use to reach this server. Required
            for OAuth callbacks (GitHub, Google, etc.) and incoming webhooks.
            Set this to the public hostname you've pointed at the server,
            including the scheme. Example: <code className="text-text">https://agents.example.com</code>.
            Leave blank to fall back to the <code className="text-text">PUBLIC_URL</code> env
            var, then to <code className="text-text">http://localhost:&lt;port&gt;</code>.
          </p>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://agents.example.com"
            className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Effective state — what the server is actually using right now,
            so the admin can confirm their change took effect. */}
        <div className="border border-border rounded-lg p-3 bg-bg-hover/40 text-[11px] space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-text-muted shrink-0">Effective:</span>
            <code className="text-text font-mono break-all">{pu.effective || "(unset)"}</code>
            <span className="ml-auto text-[10px] uppercase tracking-wide text-text-dim shrink-0">
              from {pu.source}
            </span>
          </div>
          {pu.env_value && pu.source !== "env" && (
            <div className="flex items-center gap-2">
              <span className="text-text-dim shrink-0">PUBLIC_URL env:</span>
              <code className="text-text-dim font-mono break-all">{pu.env_value}</code>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1 border-t border-border/50 mt-1">
            <span className="text-text-muted shrink-0">OAuth callback:</span>
            <code className="text-text font-mono break-all">{pu.oauth_callback}</code>
          </div>
          <p className="text-text-dim mt-1">
            Use the OAuth callback URL above when registering an OAuth app on the
            upstream provider (GitHub, Google, etc.). Save here first, then
            paste it into the provider's "Authorized redirect URI" field.
          </p>
        </div>

        {error && <div className="text-red text-sm">{error}</div>}
        {saved && <div className="text-green text-sm">Saved.</div>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving || draft.trim() === pu.value}
            className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {pu.value && (
            <button
              type="button"
              onClick={async () => {
                setError("");
                setSaving(true);
                try {
                  const updated = await serverSettings.update({ public_url: "" });
                  setData(updated);
                  setDraft("");
                } catch (err: any) {
                  setError(err?.message || "Failed to clear");
                } finally {
                  setSaving(false);
                }
              }}
              className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      </details>
      </>}

      {section === "access" && isAdmin && accessPolicy && <form onSubmit={handleAccessSave} className="border border-border rounded-lg p-5 bg-bg-card space-y-5">
        <div>
          <h3 className="text-text text-sm font-bold">Hosted access</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            One generic policy for public registration, account provisioning, resource limits, and the platform-managed model connection. A value of 0 means unlimited.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-bold text-text mb-2">Registration</span>
            <select
              value={accessPolicy.registration.mode}
              onChange={(e) => setAccessPolicy({ ...accessPolicy, registration: { ...accessPolicy.registration, mode: e.target.value as "open" | "locked" } })}
              className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="locked">Invite only</option>
              <option value="open">Open registration</option>
            </select>
          </label>
          <PolicyNumberField label="Registrations / IP / hour" value={accessPolicy.registration.registrations_per_ip_per_hour} min={1} onChange={(value) => setAccessPolicy({ ...accessPolicy, registration: { ...accessPolicy.registration, registrations_per_ip_per_hour: value } })} />
          <label className="block">
            <span className="block text-xs font-bold text-text mb-2">Initial project name</span>
            <input value={accessPolicy.provisioning.project_name} onChange={(e) => setAccessPolicy({ ...accessPolicy, provisioning: { ...accessPolicy.provisioning, project_name: e.target.value } })} className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-text mb-2">Provisioning preset ID</span>
            <input value={accessPolicy.provisioning.preset_id || ""} onChange={(e) => setAccessPolicy({ ...accessPolicy, provisioning: { ...accessPolicy.provisioning, preset_id: e.target.value } })} placeholder="Optional" className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none" />
          </label>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold text-text">Limits</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <PolicyNumberField label="Projects per user" value={accessPolicy.limits.projects_per_user} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, projects_per_user: value } })} />
            <PolicyNumberField label="Agents per project" value={accessPolicy.limits.agents_per_project} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, agents_per_project: value } })} />
            <PolicyNumberField label="Running agents per project" value={accessPolicy.limits.running_agents_per_project} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, running_agents_per_project: value } })} />
            <PolicyNumberField label="Daily model calls" value={accessPolicy.limits.daily_model_calls} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, daily_model_calls: value } })} />
            <PolicyNumberField label="Daily tokens" value={accessPolicy.limits.daily_tokens} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, daily_tokens: value } })} />
            <PolicyNumberField label="Concurrent calls / workspace" value={accessPolicy.limits.concurrent_llm_requests} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, concurrent_llm_requests: value } })} />
            <PolicyNumberField label="Concurrent calls / server" value={accessPolicy.limits.global_concurrent_llm_calls} onChange={(value) => setAccessPolicy({ ...accessPolicy, limits: { ...accessPolicy.limits, global_concurrent_llm_calls: value } })} />
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold text-text">Platform-managed model provider</h4>
          <p className="mb-3 text-[11px] text-text-dim">
            Today: {data.managed_llm_usage.calls.toLocaleString()} calls · {(data.managed_llm_usage.input_tokens + data.managed_llm_usage.output_tokens).toLocaleString()} tokens across the server.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-bold text-text mb-2">Connection</span>
              <select
                value={accessPolicy.managed_llm.connection_id || 0}
                onChange={(e) => setAccessPolicy({ ...accessPolicy, managed_llm: { ...accessPolicy.managed_llm, connection_id: Number(e.target.value) } })}
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
              >
                <option value={0}>Disabled</option>
                {llmConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name} ({connection.app_name})</option>)}
              </select>
              <p className="mt-2 text-[11px] text-text-dim">Connect a provider in AI & Helper → Providers & defaults first. Users never receive its secret.</p>
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-text mb-2">Allowed model IDs</span>
              <input
                value={(accessPolicy.managed_llm.models || []).join(", ")}
                onChange={(e) => setAccessPolicy({ ...accessPolicy, managed_llm: { ...accessPolicy.managed_llm, models: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })}
                placeholder="model-a, model-b"
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold text-text">Workspace lifecycle</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-bold text-text mb-2">Expire after</span>
              <input value={accessPolicy.workspace_lifecycle.expires_after || ""} onChange={(e) => setAccessPolicy({ ...accessPolicy, workspace_lifecycle: { ...accessPolicy.workspace_lifecycle, expires_after: e.target.value } })} placeholder="Optional, e.g. 24h" className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none" />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-text mb-2">Stop idle agents after</span>
              <input value={accessPolicy.workspace_lifecycle.idle_shutdown_after || ""} onChange={(e) => setAccessPolicy({ ...accessPolicy, workspace_lifecycle: { ...accessPolicy.workspace_lifecycle, idle_shutdown_after: e.target.value } })} placeholder="Optional, e.g. 15m" className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none" />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={accessPolicy.workspace_lifecycle.reset_from_preset} onChange={(e) => setAccessPolicy({ ...accessPolicy, workspace_lifecycle: { ...accessPolicy.workspace_lifecycle, reset_from_preset: e.target.checked } })} className="accent-accent" />
            Create a fresh workspace from the provisioning preset after expiration
          </label>
        </div>

        <div>
          <h4 className="mb-3 text-xs font-bold text-text">User capabilities</h4>
          <label className="mb-4 block">
            <span className="block text-xs font-bold text-text mb-2">Allowed app slugs</span>
            <input
              value={(accessPolicy.capabilities.allowed_apps || []).join(", ")}
              onChange={(e) => setAccessPolicy({ ...accessPolicy, capabilities: { ...accessPolicy.capabilities, allowed_apps: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })}
              placeholder="Empty allows any already-installed app"
              className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ["api_keys", "Create API keys"],
              ["custom_mcp", "Add custom MCP servers"],
              ["provider_management", "Manage model providers"],
              ["app_installation", "Install apps"],
              ["invitations", "Invite project members"],
              ["domains", "Manage domains"],
              ["backups", "Create backups"],
              ["realtime_voice", "Use realtime voice"],
              ["autonomous_scheduling", "Use autonomous scheduling"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-text">
                <input type="checkbox" checked={accessPolicy.capabilities[key]} onChange={(e) => setAccessPolicy({ ...accessPolicy, capabilities: { ...accessPolicy.capabilities, [key]: e.target.checked } })} className="accent-accent" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button type="submit" disabled={accessSaving} className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50">
          {accessSaving ? "Saving…" : "Save hosted access"}
        </button>
      </form>}

      {section === "geoip" && isAdmin && <form onSubmit={handleGeoIPSave} className="border border-border rounded-lg p-5 bg-bg-card space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-text text-sm font-bold">Visitor country</h3>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Resolve public visitor IPs locally. DB-IP Country Lite is enabled automatically on new installations; lookups add no network request to storefront traffic and fail open if the database is unavailable.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={geoIPEnabled}
              onChange={(e) => setGeoIPEnabled(e.target.checked)}
              disabled={!data.geoip.managed}
              className="accent-accent"
            />
            Enabled
          </label>
        </div>

        {!data.geoip.managed ? (
          <div className="rounded-lg border border-border bg-bg-hover/40 p-3 text-xs text-text-muted">
            Managed externally by <code className="text-text">APTEVA_GEOIP_COUNTRY_DB</code>.
          </div>
        ) : <>
          <label className="block">
            <span className="block text-xs font-bold text-text mb-2">Database source</span>
            <select
              value={geoIPSource}
              onChange={(e) => setGeoIPSource(e.target.value as "dbip" | "maxmind" | "test")}
              className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="dbip">DB-IP Country Lite (free, no account)</option>
              <option value="maxmind">GeoLite2 Country (MaxMind account)</option>
              <option value="test">MaxMind test database (development only)</option>
            </select>
          </label>

          {geoIPSource === "maxmind" && <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-bold text-text mb-2">MaxMind account ID</span>
              <input
                value={geoIPAccountID}
                onChange={(e) => setGeoIPAccountID(e.target.value)}
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-text mb-2">License key</span>
              <input
                type="password"
                value={geoIPLicenseKey}
                onChange={(e) => setGeoIPLicenseKey(e.target.value)}
                placeholder={data.geoip.has_license_key ? "Saved — leave blank to keep" : "Required"}
                autoComplete="new-password"
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
              />
            </label>
          </div>}

          {geoIPSource === "dbip" && <p className="text-[11px] leading-relaxed text-text-dim">
            IP geolocation data by{" "}
            <a className="text-accent hover:underline" href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a>
            {" "}(CC BY 4.0). The free country database is downloaded anonymously and refreshed monthly.
          </p>}

          <div className="rounded-lg border border-border bg-bg-hover/40 p-3 text-[11px] space-y-1">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${data.geoip.active ? "bg-green" : "bg-text-dim"}`} />
              <span className="text-text">{data.geoip.active ? "Country lookup active" : geoIPEnabled ? "Waiting for database" : "Country lookup disabled"}</span>
            </div>
            {data.geoip.updated_at && <div className="text-text-dim">Database updated {new Date(data.geoip.updated_at).toLocaleString()}</div>}
            <div className="text-text-dim break-all">{data.geoip.database_path}</div>
          </div>

          <button
            type="submit"
            disabled={geoIPSaving || (geoIPEnabled && geoIPSource === "maxmind" && (!geoIPAccountID.trim() || (!data.geoip.has_license_key && !geoIPLicenseKey.trim())))}
            className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {geoIPSaving ? "Saving…" : "Save visitor country"}
          </button>
        </>}
      </form>}

      {section === "lifecycle" && isAdmin && <form onSubmit={handleLifecycleSave} className="border border-border rounded-lg p-5 bg-bg-card space-y-5">
        <div>
          <h3 className="text-text text-sm font-bold">Agent lifecycle</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            Control what happens to active agent cores when Apteva is updated or restarted.
            Stopping Apteva completely always stops every agent process.
          </p>
        </div>

        <label className="block">
          <span className="block text-xs font-bold text-text mb-2">During updates and server restarts</span>
          <select
            value={lifecyclePolicy}
            onChange={(e) => setLifecyclePolicy(e.target.value as typeof lifecyclePolicy)}
            className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
          >
            <option value="restart">Restart active agents gradually</option>
            <option value="rolling">Keep running, then update cores one at a time</option>
            <option value="preserve">Keep running without updating their cores</option>
          </select>
          <p className="mt-2 text-xs text-text-dim">
            {lifecyclePolicy === "restart"
              ? "Applies the new core immediately. Agents are unavailable until their turn in the startup queue."
              : lifecyclePolicy === "rolling"
                ? "Reattaches all agents first, then replaces one core at a time after each becomes healthy."
                : "Reattaches existing cores. Their current versions remain active until manually updated."}
          </p>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-bold text-text mb-2">When Apteva starts</span>
            <select
              value={bootResume}
              onChange={(e) => setBootResume(e.target.value as typeof bootResume)}
              className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
            >
              <option value="staggered">Resume gradually</option>
              <option value="auto">Resume immediately</option>
              <option value="manual">Do not resume automatically</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold text-text mb-2">Fresh-start interval</span>
            <input
              value={bootDelay}
              onChange={(e) => setBootDelay(e.target.value)}
              disabled={bootResume !== "staggered"}
              placeholder="5s"
              className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="block text-xs font-bold text-text mb-2">Rolling-update interval</span>
            <input
              value={rolloutDelay}
              onChange={(e) => setRolloutDelay(e.target.value)}
              placeholder="15s"
              className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none"
            />
            <p className="mt-2 text-xs text-text-dim">Accepted examples: 15s, 1m, 2m30s.</p>
          </label>
        </div>

        <button
          type="submit"
          disabled={lifecycleSaving}
          className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {lifecycleSaving ? "Saving…" : "Save agent lifecycle"}
        </button>
      </form>}
    </div>
  );
}

function PolicyNumberField({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-text mb-2">{label}</span>
      <input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} className="w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 font-mono text-sm text-text focus:border-accent focus:outline-none" />
    </label>
  );
}
