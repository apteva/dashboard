import { useState, useEffect } from "react";

import { AppIcon } from "@apteva/ui-kit";
import { auth, apps as appsAPI, type AppRow } from "../../api";

import { useProjects } from "../../hooks/useProjects";

export interface Key {
  id: number;
  name: string;
  key_prefix: string;
  access?: "read_only" | "read_write";
  kind?: "private" | "public_client" | "delegated_user" | string;
  project_id?: string;
  scopes?: string;
  allowed_origins?: string;
  rate_limit_per_minute?: number;
  expires_at?: string;
  revoked_at?: string;
  last_used?: string;
  last_used_ip?: string;
  created_at: string;
}

export function visibleUserManagedKeys(keys: Key[], now = Date.now()): Key[] {
  return keys.filter((key) => {
    const kind = key.kind || "private";
    if (kind !== "private" && kind !== "public_client") return false;
    if (key.revoked_at) return false;
    if (!key.expires_at) return true;
    const expiresAt = Date.parse(key.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

export function APIKeysTab() {
  const { projects, currentProject } = useProjects();
  const [keys, setKeys] = useState<Key[]>([]);
  const [keyAccess, setKeyAccess] = useState<"read_only" | "read_write">("read_only");
  const [newKeyAccess, setNewKeyAccess] = useState<"read_only" | "read_write">("read_only");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyKind, setNewKeyKind] = useState<"private" | "public_client">("private");
  const [keyKind, setKeyKind] = useState<"private" | "public_client">("private");
  const [projectId, setProjectId] = useState("");
  const [scopeApps, setScopeApps] = useState<AppRow[]>([]);
  const [selectedAppScopes, setSelectedAppScopes] = useState<Set<number>>(new Set());
  const [loadingScopeApps, setLoadingScopeApps] = useState(false);
  const [originsText, setOriginsText] = useState("");
  const [rateLimit, setRateLimit] = useState(60);
  const [expiresAt, setExpiresAt] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => auth.listKeys().then((rows) => setKeys(visibleUserManagedKeys(rows))).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!projectId && currentProject?.id) {
      setProjectId(currentProject.id);
    }
  }, [currentProject?.id, projectId]);
  useEffect(() => {
    if (keyKind !== "public_client" || !projectId) {
      setScopeApps([]);
      setSelectedAppScopes(new Set());
      return;
    }
    let cancelled = false;
    setLoadingScopeApps(true);
    appsAPI.list(projectId)
      .then((rows) => {
        if (cancelled) return;
        const visibleApps = (rows || []).filter((app) => app.status !== "disabled");
        setScopeApps(visibleApps);
        setSelectedAppScopes((prev) => {
          const valid = new Set(visibleApps.map((app) => app.install_id));
          return new Set([...prev].filter((id) => valid.has(id)));
        });
      })
      .catch(() => {
        if (!cancelled) {
          setScopeApps([]);
          setSelectedAppScopes(new Set());
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingScopeApps(false);
      });
    return () => { cancelled = true; };
  }, [keyKind, projectId]);

  const selectedProject = projects.find((p) => p.id === projectId) || null;
  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name || id || "No project";
  const parseJSONLabel = (raw?: string) => {
    if (!raw) return "No scopes";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const appScopes = parsed.filter((scope) => scope?.type === "app" && scope?.access === "all");
        if (appScopes.length > 0) {
          const names = appScopes.map((scope) => scope.display_name || scope.app).filter(Boolean);
          if (names.length <= 2) return names.join(", ");
          return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
        }
        return `${parsed.length} scope${parsed.length === 1 ? "" : "s"}`;
      }
      return "Custom scope";
    } catch {
      return "Custom scope";
    }
  };
  const parseOriginsLabel = (raw?: string) => {
    if (!raw) return "Any origin";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.length === 0 ? "Any origin" : `${parsed.length} origin${parsed.length === 1 ? "" : "s"}`;
    } catch {}
    return "Custom origins";
  };

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreateError("");
    setCreating(true);
    try {
      const options: {
        kind?: "private" | "public_client";
        access?: "read_only" | "read_write";
        project_id?: string;
        scopes?: unknown;
        allowed_origins?: string[];
        rate_limit_per_minute?: number;
        expires_at?: string;
      } = { kind: keyKind };
      if (keyKind === "private") options.access = keyAccess;
      if (keyKind === "public_client") {
        if (!projectId) {
          throw new Error("Choose a project for this scoped client key.");
        }
        const selectedApps = scopeApps.filter((app) => selectedAppScopes.has(app.install_id));
        if (selectedApps.length === 0) {
          throw new Error("Select at least one app scope.");
        }
        const allowedOrigins = originsText
          .split(/[\n,]/)
          .map((origin) => origin.trim())
          .filter(Boolean);
        options.project_id = projectId;
        options.scopes = selectedApps.map((app) => ({
          type: "app",
          app: app.name,
          install_id: app.install_id,
          display_name: app.display_name || app.name,
          access: "all",
        }));
        options.allowed_origins = allowedOrigins;
        options.rate_limit_per_minute = rateLimit;
        if (expiresAt) {
          options.expires_at = new Date(expiresAt).toISOString();
        }
      }
      const result = await auth.createKey(newKeyName.trim(), options);
      setNewKey(result.key);
      setNewKeyAccess(result.access || "read_write");
      setNewKeyKind(result.kind === "public_client" ? "public_client" : "private");
      setNewKeyName("");
      load();
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const deleteKey = async (id: number) => {
    await auth.deleteKey(id);
    load();
  };

  const toggleAppScope = (installId: number) => {
    setSelectedAppScopes((prev) => {
      const next = new Set(prev);
      if (next.has(installId)) next.delete(installId);
      else next.add(installId);
      return next;
    });
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">API Keys</h2>
        <p className="text-text-muted text-sm mt-1">
          Create private server keys or scoped client keys for browser-facing SDK use.
        </p>
      </div>

      <form onSubmit={createKey} className="border border-border rounded-lg bg-bg-card p-4 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
            placeholder="Key name"
          />
          <div className="flex border border-border rounded-lg overflow-hidden bg-bg-input">
            <button
              type="button"
              onClick={() => setKeyKind("private")}
              className={`px-4 py-3 text-sm font-bold transition-colors ${keyKind === "private" ? "bg-accent text-bg" : "text-text-muted hover:text-text"}`}
            >
              Private
            </button>
            <button
              type="button"
              onClick={() => setKeyKind("public_client")}
              className={`px-4 py-3 text-sm font-bold transition-colors ${keyKind === "public_client" ? "bg-accent text-bg" : "text-text-muted hover:text-text"}`}
            >
              Scoped client
            </button>
          </div>
          <button
            type="submit"
            disabled={creating || !newKeyName.trim()}
            className="px-5 py-3 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "New Key"}
          </button>
        </div>

        {keyKind === "private" ? (
          <div className="space-y-2">
            <label htmlFor="api-key-access" className="block text-text-muted text-xs font-bold uppercase tracking-wide">Permissions</label>
            <select
              id="api-key-access"
              value={keyAccess}
              onChange={(e) => setKeyAccess(e.target.value as "read_only" | "read_write")}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text focus:outline-none focus:border-accent"
            >
              <option value="read_only">Read only</option>
              <option value="read_write">Read &amp; write</option>
            </select>
            <p className="text-text-muted text-sm">
              {keyAccess === "read_only"
                ? "Inspect agents, status, saved settings, and telemetry within your existing access. Changes, commands, tool execution, and credential exports are blocked."
                : "Read and change server data within your existing user permissions."}
              {" "}Keep private keys on your server, never in public sites.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-text-muted text-xs font-bold uppercase tracking-wide">Project</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text focus:outline-none focus:border-accent"
              >
                {!selectedProject && <option value="">Choose project</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="block text-text-muted text-xs font-bold uppercase tracking-wide">Rate limit per minute</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={rateLimit}
                onChange={(e) => setRateLimit(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text focus:outline-none focus:border-accent"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="block text-text-muted text-xs font-bold uppercase tracking-wide">Allowed origins</label>
              <input
                value={originsText}
                onChange={(e) => setOriginsText(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text focus:outline-none focus:border-accent"
                placeholder="https://example.com, http://localhost:5173"
              />
              <p className="text-text-muted text-xs">Leave blank while developing, or enter comma-separated browser origins.</p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <label className="block text-text-muted text-xs font-bold uppercase tracking-wide">App scope</label>
                {scopeApps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedAppScopes.size === scopeApps.length) setSelectedAppScopes(new Set());
                      else setSelectedAppScopes(new Set(scopeApps.map((app) => app.install_id)));
                    }}
                    className="text-xs text-text-muted hover:text-text transition-colors"
                  >
                    {selectedAppScopes.size === scopeApps.length ? "Clear" : "Select all"}
                  </button>
                )}
              </div>
              <div className="border border-border rounded-lg bg-bg-input divide-y divide-border max-h-72 overflow-y-auto">
                {loadingScopeApps ? (
                  <p className="text-text-muted text-sm p-4">Loading apps...</p>
                ) : scopeApps.length === 0 ? (
                  <p className="text-text-muted text-sm p-4">No installed apps are available in this project.</p>
                ) : (
                  scopeApps.map((app) => {
                    const selected = selectedAppScopes.has(app.install_id);
                    return (
                      <label
                        key={app.install_id}
                        className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${selected ? "bg-accent/10" : "hover:bg-bg-card"}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleAppScope(app.install_id)}
                          className="h-4 w-4 accent-accent"
                        />
                        <AppIcon
                          src={app.icon}
                          iconStyle={app.icon_style}
                          name={app.display_name || app.name}
                          size="md"
                          className="text-accent"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-text text-sm font-bold truncate">{app.display_name || app.name}</span>
                            <span className="text-text-muted text-xs shrink-0">#{app.install_id}</span>
                          </div>
                          <div className="text-text-muted text-xs truncate">
                            {app.name} · {app.status}{app.project_id ? "" : " · global"}
                          </div>
                        </div>
                        <span className="text-text-muted text-xs shrink-0">all app</span>
                        </label>
                    );
                  })
                )}
              </div>
              <p className="text-text-muted text-xs">For now each selected app grants whole-app scope metadata for this project.</p>
            </div>
            <div className="space-y-2">
              <label className="block text-text-muted text-xs font-bold uppercase tracking-wide">Expires</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-text focus:outline-none focus:border-accent"
              />
            </div>
            <p className="text-text-muted text-sm md:col-span-2">
              Scoped client keys are safe to create for a project, but they do not authorize normal dashboard API calls.
            </p>
          </div>
        )}

        {createError && <p className="text-red text-sm">{createError}</p>}
      </form>

      {newKey && (
        <div className="border border-accent rounded-lg p-4 bg-bg-card">
          <p className="text-accent text-sm mb-2">
            Save this {newKeyKind === "public_client" ? "scoped client" : newKeyAccess === "read_only" ? "read-only private" : "read-write private"} key — it won't be shown again:
          </p>
          <code className="text-text text-sm select-all block bg-bg-input rounded px-3 py-2">{newKey}</code>
          <button
            onClick={() => setNewKey(null)}
            className="text-text-muted text-sm mt-3 hover:text-text transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {keys.length === 0 && !newKey && (
        <p className="text-text-muted text-sm">No API keys yet.</p>
      )}

      <div className="space-y-3">
        {keys.map((k) => (
          <div key={k.id} className="border border-border rounded-lg p-4 bg-bg-card flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-text text-base">{k.name}</span>
                <span className={`text-xs font-bold rounded px-2 py-0.5 ${k.kind === "public_client" ? "bg-accent/15 text-accent" : "bg-bg-input text-text-muted"}`}>
                  {k.kind === "public_client" ? "scoped client" : "private"}
                </span>
                <span className="text-text-muted text-sm">{k.key_prefix}...</span>
              </div>
              {k.kind === "public_client" ? (
                <div className="text-text-muted text-sm mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <span>{projectName(k.project_id)}</span>
                  <span>{parseJSONLabel(k.scopes)}</span>
                  <span>{parseOriginsLabel(k.allowed_origins)}</span>
                  {k.rate_limit_per_minute ? <span>{k.rate_limit_per_minute}/min</span> : null}
                  {k.expires_at ? <span>expires {new Date(k.expires_at).toLocaleString()}</span> : null}
                </div>
              ) : (
                <p className="text-text-muted text-sm mt-1">{k.access === "read_only" ? "Read only" : "Read & write"} · Your user permissions apply</p>
              )}
              {k.last_used && <p className="text-text-muted text-xs mt-1">Last used {new Date(k.last_used).toLocaleString()}</p>}
            </div>
            <button
              onClick={() => deleteKey(k.id)}
              className="text-sm text-text-muted hover:text-red transition-colors self-start md:self-auto"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
