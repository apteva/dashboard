import { useState, useEffect } from "react";
import { auth, providers, providerTypes, telemetry, mcpServers, integrations, subscriptions, channels, projects as projectsAPI, instances as instancesAPI, type Provider, type ProviderTypeInfo, type MCPServer, type MCPTool, type SubscriptionInfo, type Instance, type Project, type CatalogStatus, type Channel } from "../api";
import { Modal } from "../components/Modal";
import { useProjects } from "../hooks/useProjects";

interface Key {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
}


type Tab = "projects" | "channels" | "integrations" | "providers" | "mcp" | "subscriptions" | "api-keys" | "data" | "account";

export function Settings() {
  const [tab, setTab] = useState<Tab>("projects");

  const tabs: { id: Tab; label: string }[] = [
    { id: "projects", label: "Projects" },
    { id: "channels", label: "Channels" },
    { id: "integrations", label: "Integrations" },
    { id: "providers", label: "Providers" },
    { id: "mcp", label: "MCP Servers" },
    { id: "subscriptions", label: "Subscriptions" },
    { id: "api-keys", label: "API Keys" },
    { id: "data", label: "Data" },
    { id: "account", label: "Account" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-text text-lg font-bold">Settings</h1>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border px-6 flex gap-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "text-accent border-accent"
                : "text-text-muted border-transparent hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === "projects" && <ProjectsTab />}
        {tab === "channels" && <ChannelsTab />}
        {tab === "integrations" && <IntegrationsCatalogTab />}
        {tab === "providers" && <ProvidersTab />}
        {tab === "mcp" && <MCPServersTab />}
        {tab === "subscriptions" && <SubscriptionsTab />}
        {tab === "api-keys" && <APIKeysTab />}
        {tab === "data" && <DataTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </div>
  );
}

// ─── Channels Tab ───

function ChannelsTab() {
  const { currentProject } = useProjects();
  const [instanceList, setInstanceList] = useState<Instance[]>([]);
  const [channelsByInstance, setChannelsByInstance] = useState<Record<number, Channel[]>>({});
  const [telegramToken, setTelegramToken] = useState("");
  const [connectingFor, setConnectingFor] = useState<number | null>(null);
  const [showConnect, setShowConnect] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () => {
    instancesAPI.list(currentProject?.id).then((list) => {
      setInstanceList(list || []);
      for (const inst of list || []) {
        channels.list(inst.id).then((chs) => {
          setChannelsByInstance((prev) => ({ ...prev, [inst.id]: chs }));
        }).catch(() => {});
      }
    }).catch(() => {});
  };

  useEffect(() => { load(); }, [currentProject?.id]);

  const handleConnect = async (instanceId: number) => {
    if (!telegramToken.trim()) return;
    setError("");
    setSuccess("");
    setConnectingFor(instanceId);
    try {
      const result = await channels.connectTelegram(instanceId, telegramToken.trim());
      setSuccess(`Connected @${result.bot_name} to instance`);
      setTelegramToken("");
      setShowConnect(null);
      load();
    } catch (err: any) {
      setError(err.message || "Failed to connect");
    } finally {
      setConnectingFor(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold mb-1">Channels</h2>
        <p className="text-text-muted text-sm">Manage communication channels for each instance. Channels allow your agents to reach you via Telegram, CLI, or other gateways.</p>
      </div>

      {instanceList.length === 0 && (
        <p className="text-text-muted text-sm">No instances found.</p>
      )}

      {instanceList.map((inst) => {
        const chs = channelsByInstance[inst.id] || [];
        return (
          <div key={inst.id} className="border border-border rounded-lg bg-bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${inst.status === "running" ? "bg-green" : "bg-red"}`} />
                <span className="text-text font-bold text-sm">{inst.name}</span>
              </div>
              <button
                onClick={() => setShowConnect(showConnect === inst.id ? null : inst.id)}
                className="px-3 py-1 text-xs border border-border rounded-lg text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                + Connect
              </button>
            </div>

            {/* Channel list */}
            <div className="px-4 py-3 space-y-2">
              {chs.length === 0 && (
                <p className="text-text-dim text-xs">No channels connected</p>
              )}
              {chs.map((ch) => (
                <div key={ch.id} className="flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full ${ch.status === "connected" ? "bg-green" : "bg-red"}`} />
                  <span className="text-text font-medium">
                    {ch.id === "cli" ? "CLI / Dashboard" : ch.id === "telegram" ? "Telegram" : ch.id}
                  </span>
                  {ch.bot_name && <span className="text-text-muted text-xs">@{ch.bot_name}</span>}
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                    ch.status === "connected" ? "bg-green/10 text-green" : "bg-red/10 text-red"
                  }`}>
                    {ch.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Connect form */}
            {showConnect === inst.id && (
              <div className="px-4 py-3 border-t border-border space-y-3">
                <p className="text-text-muted text-xs">Connect a Telegram bot. Get a token from <a href="https://t.me/BotFather" target="_blank" className="text-accent hover:underline">@BotFather</a>.</p>
                <div className="flex gap-2">
                  <input
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    placeholder="Bot token from @BotFather"
                    className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => handleConnect(inst.id)}
                    disabled={connectingFor === inst.id}
                    className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {connectingFor === inst.id ? "Connecting..." : "Connect"}
                  </button>
                </div>
                {error && <p className="text-red text-xs">{error}</p>}
                {success && <p className="text-green text-xs">{success}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Integrations Catalog Tab ───

function IntegrationsCatalogTab() {
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = () => integrations.catalogStatus().then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  const handleDownload = async () => {
    setDownloading(true);
    setResult(null);
    try {
      const res = await integrations.downloadCatalog();
      setResult(`Downloaded ${res.count} integrations`);
      load();
    } catch (e: any) {
      setResult(`Failed: ${e.message || "unknown error"}`);
    }
    setDownloading(false);
  };

  const lastUpdated = status?.last_updated
    ? new Date(status.last_updated).toLocaleString()
    : null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold">Integration Catalog</h2>
        <p className="text-text-muted text-sm mt-1">
          Download and update the integration catalog to connect external services like GitHub, Slack, Stripe, and more.
        </p>
      </div>

      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <div className="flex items-center justify-between">
          <div>
            {status?.installed ? (
              <>
                <span className="text-text text-sm font-bold">{status.count} integrations available</span>
                {lastUpdated && (
                  <p className="text-text-dim text-xs mt-1">Last updated: {lastUpdated}</p>
                )}
              </>
            ) : (
              <>
                <span className="text-text-muted text-sm">No integrations installed</span>
                <p className="text-text-dim text-xs mt-1">
                  Download the catalog to connect apps and services to your instances.
                </p>
              </>
            )}
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="px-4 py-2.5 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {downloading ? "Downloading..." : status?.installed ? "Update" : "Download Catalog"}
          </button>
        </div>
        {result && (
          <p className={`text-sm mt-3 ${result.startsWith("Failed") ? "text-red" : "text-green"}`}>
            {result}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Providers Tab ───

function ProvidersTab() {
  const { currentProject } = useProjects();
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [types, setTypes] = useState<ProviderTypeInfo[]>([]);
  const [configuring, setConfiguring] = useState<ProviderTypeInfo | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = () => {
    providers.list(currentProject?.id).then(setProviderList).catch(() => {});
    providerTypes.list().then(setTypes).catch(() => {});
  };
  useEffect(() => { load(); }, [currentProject?.id]);

  const isActive = (name: string) => providerList.some((p) => p.name === name);
  const getActive = (name: string) => providerList.find((p) => p.name === name);

  const handleActivate = async (pt: ProviderTypeInfo) => {
    if (!pt.requires_credentials) {
      // No credentials needed — activate immediately (scoped to current project)
      try {
        await providers.create(pt.type, pt.name, {}, pt.id, currentProject?.id);
        load();
      } catch {}
      return;
    }
    // Open credential form
    setConfiguring(pt);
    setFields({});
    setError("");
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuring) return;
    setError("");

    const data: Record<string, string> = {};
    for (const f of configuring.fields) {
      if (fields[f]) data[f] = fields[f];
    }
    if (Object.keys(data).length === 0) {
      setError("At least one field is required");
      return;
    }

    try {
      await providers.create(configuring.type, configuring.name, data, configuring.id, currentProject?.id);
      setConfiguring(null);
      setFields({});
      load();
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  };

  const handleDeactivate = async (name: string) => {
    const p = getActive(name);
    if (p) {
      await providers.delete(p.id);
      load();
    }
  };

  // Group types by category
  const typeLabels: Record<string, string> = {
    llm: "LLM",
    embeddings: "Embeddings",
    tts: "Text-to-Speech",
    browser: "Browser",
    search: "Search",
    integrations: "Integrations",
  };
  const groups: Record<string, ProviderTypeInfo[]> = {};
  for (const t of types) {
    const key = t.type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Providers</h2>
        <p className="text-text-muted text-sm mt-1">
          Activate providers to enable LLMs, integrations, and other services.
          {currentProject ? (
            <>
              {" "}
              Scoped to project <b>{currentProject.name}</b>. Unscoped providers
              are visible in every project.
            </>
          ) : (
            <> Without a selected project, new providers are unscoped (visible everywhere).</>
          )}
        </p>
      </div>

      {Object.entries(groups).map(([groupType, items]) => (
        <section key={groupType}>
          <h3 className="text-text-muted text-sm font-bold mb-3 uppercase tracking-wide">
            {typeLabels[groupType] || groupType}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((pt) => {
              const active = isActive(pt.name);
              return (
                <div
                  key={pt.id}
                  className={`border rounded-lg p-4 transition-colors cursor-pointer ${
                    active
                      ? "border-green bg-bg-card"
                      : "border-border bg-bg-card hover:border-accent"
                  }`}
                  onClick={() => active ? undefined : handleActivate(pt)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-text text-sm font-bold">{pt.name}</span>
                    {active && (
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const p = getActive(pt.name);
                          const scope = p?.project_id ? "project" : "global";
                          return (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              scope === "project"
                                ? "bg-accent/20 text-accent"
                                : "bg-bg-hover text-text-dim"
                            }`}>
                              {scope}
                            </span>
                          );
                        })()}
                        <span className="inline-block w-2 h-2 rounded-full bg-green" />
                      </div>
                    )}
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed mb-2">{pt.description}</p>
                  {active ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeactivate(pt.name); }}
                      className="text-xs text-text-muted hover:text-red transition-colors"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <span className="text-xs text-accent">
                      {pt.requires_credentials ? "Configure" : "Activate"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Credential configuration modal */}
      <Modal open={!!configuring} onClose={() => setConfiguring(null)}>
        {configuring && (
          <form onSubmit={handleSaveCredentials} className="p-6 space-y-4">
            <h3 className="text-text text-base font-bold">{configuring.name}</h3>
            <p className="text-text-muted text-sm">{configuring.description}</p>

            {configuring.fields.map((field) => (
              <div key={field}>
                <label className="block text-text-muted text-sm mb-2">{field}</label>
                <input
                  type={field.includes("KEY") || field.includes("SECRET") ? "password" : "text"}
                  value={fields[field] || ""}
                  onChange={(e) => setFields({ ...fields, [field]: e.target.value })}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                  placeholder={field.includes("HOST") ? "http://localhost:11434" : ""}
                  autoFocus={configuring.fields[0] === field}
                />
              </div>
            ))}

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
                Activate
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ─── MCP Servers Tab ───

function MCPServersTab() {
  const { currentProject } = useProjects();
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [description, setDescription] = useState("");
  const [envFields, setEnvFields] = useState<Array<{ key: string; value: string }>>([{ key: "", value: "" }]);
  const [error, setError] = useState("");
  const [expandedTools, setExpandedTools] = useState<Record<number, MCPTool[]>>({});
  const [showConfig, setShowConfig] = useState<Record<number, boolean>>({});
  const [testingTool, setTestingTool] = useState<{ serverId: number; tool: MCPTool } | null>(null);
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<any>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [composioConns, setComposioConns] = useState<number>(0);
  const [syncingComposio, setSyncingComposio] = useState(false);
  const [composioSyncError, setComposioSyncError] = useState("");

  const load = () => mcpServers.list(currentProject?.id).then((s) => setServers(s || [])).catch(() => {});
  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [currentProject?.id]);

  // Look for a Composio provider and active composio connections in this
  // project — if they exist but there's no remote mcp row, offer a Sync
  // button. Reconcile is idempotent so Sync is always safe to click.
  useEffect(() => {
    providers.list(currentProject?.id).then(setProviderList).catch(() => {});
    integrations
      .connections(currentProject?.id)
      .then((cs) => {
        const count = (cs || []).filter(
          (c) => c.source === "composio" && c.status === "active",
        ).length;
        setComposioConns(count);
      })
      .catch(() => {});
  }, [currentProject?.id, servers.length]);

  const composioProvider = providerList.find((p) => p.name === "Composio");
  const hasRemoteRow = servers.some(
    (s) => s.source === "remote" && s.provider_id === composioProvider?.id,
  );
  const showComposioSyncHint =
    !!composioProvider && composioConns > 0 && !hasRemoteRow;

  const handleComposioSync = async () => {
    if (!composioProvider) return;
    setSyncingComposio(true);
    setComposioSyncError("");
    try {
      await integrations.composioReconcile(composioProvider.id, currentProject?.id);
      load();
    } catch (err: any) {
      setComposioSyncError(err?.message || "Sync failed");
    } finally {
      setSyncingComposio(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !command.trim()) {
      setError("Name and command are required");
      return;
    }

    const parsedArgs = args.trim() ? args.trim().split(/\s+/) : [];
    const env: Record<string, string> = {};
    for (const f of envFields) {
      if (f.key.trim() && f.value.trim()) env[f.key.trim()] = f.value.trim();
    }

    try {
      await mcpServers.create(name.trim(), command.trim(), parsedArgs, env, description.trim(), currentProject?.id);
      setShowAdd(false);
      setName(""); setCommand(""); setArgs(""); setDescription("");
      setEnvFields([{ key: "", value: "" }]);
      load();
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  };

  const handleStart = async (id: number) => {
    try {
      const result = await mcpServers.start(id);
      setExpandedTools((prev) => ({ ...prev, [id]: result.tools }));
      load();
    } catch (err: any) {
      alert(err.message || "Failed to start");
    }
  };

  const handleStop = async (id: number) => {
    await mcpServers.stop(id);
    setExpandedTools((prev) => { const n = { ...prev }; delete n[id]; return n; });
    load();
  };

  const handleDelete = async (id: number) => {
    await mcpServers.delete(id);
    load();
  };

  const toggleTools = async (id: number) => {
    if (expandedTools[id]) {
      setExpandedTools((prev) => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    // For remote rows that haven't been probed yet, kick off Start first so
    // the server-side probe populates the cached tool list.
    const srv = servers.find((s) => s.id === id);
    if (srv && srv.source === "remote" && srv.tool_count === 0) {
      try {
        const result = await mcpServers.start(id);
        setExpandedTools((prev) => ({ ...prev, [id]: result.tools || [] }));
        load();
        return;
      } catch {
        // fall through to tools() call — maybe the server had a stale probe
      }
    }
    const tools = await mcpServers.tools(id);
    setExpandedTools((prev) => ({ ...prev, [id]: tools }));
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">MCP Servers</h2>
        <p className="text-text-muted text-sm mt-1">
          Manage MCP (Model Context Protocol) servers. These provide tools
          that Apteva instances can use.
        </p>
      </div>

      {/* Hint for missing Composio hosted MCP row */}
      {showComposioSyncHint && (
        <div className="border border-accent/40 bg-accent/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="text-text text-sm font-bold">
                Composio hosted MCP not synced
              </div>
              <p className="text-text-muted text-xs mt-1">
                You have {composioConns} active Composio connection
                {composioConns === 1 ? "" : "s"} but no hosted MCP server row
                yet. Click Sync to create (or refresh) the aggregate Composio
                MCP endpoint for this project.
              </p>
              {composioSyncError && (
                <p className="text-red text-xs mt-2">{composioSyncError}</p>
              )}
            </div>
            <button
              onClick={handleComposioSync}
              disabled={syncingComposio}
              className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {syncingComposio ? "Syncing…" : "Sync"}
            </button>
          </div>
        </div>
      )}

      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors w-fit"
        >
          Add Server
        </button>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="border border-border rounded-lg p-5 bg-bg-card space-y-4">
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="pushover"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="./mcp-pushover-server"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Arguments (space-separated)</label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="--port 8080"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="Send push notifications"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Environment Variables</label>
            <div className="space-y-2">
              {envFields.map((f, i) => (
                <div key={i} className="flex gap-3">
                  <input
                    value={f.key}
                    onChange={(e) => {
                      const u = [...envFields]; u[i].key = e.target.value; setEnvFields(u);
                    }}
                    className="flex-1 bg-bg-input border border-border rounded-lg px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent"
                    placeholder="PUSHOVER_API_KEY"
                  />
                  <input
                    value={f.value}
                    onChange={(e) => {
                      const u = [...envFields]; u[i].value = e.target.value; setEnvFields(u);
                    }}
                    type="password"
                    className="flex-1 bg-bg-input border border-border rounded-lg px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent"
                    placeholder="Value"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => setEnvFields([...envFields, { key: "", value: "" }])}
                className="text-sm text-accent hover:text-accent-hover transition-colors"
              >
                + Add variable
              </button>
            </div>
          </div>

          {error && <div className="text-red text-sm">{error}</div>}

          <div className="flex gap-3">
            <button type="submit" className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors">
              Save
            </button>
            <button type="button" onClick={() => { setShowAdd(false); setError(""); }}
              className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {servers.length === 0 && !showAdd && (
        <p className="text-text-muted text-sm">No MCP servers configured.</p>
      )}

      <div className="space-y-3">
        {servers.map((s) => (
          <div key={s.id} className="border border-border rounded-lg bg-bg-card">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                  s.status === "running" || s.status === "reachable"
                    ? "bg-green"
                    : s.status === "unprobed"
                      ? "bg-yellow-500"
                      : "bg-red"
                }`} />
                <div>
                  <span className="text-text text-base font-bold">{s.name}</span>
                  {s.description && (
                    <span className="text-text-muted text-sm ml-3">{s.description}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {s.source === "local" && (
                  <span className="text-xs px-2 py-0.5 rounded bg-bg-hover text-text-dim">integration</span>
                )}
                {s.source === "remote" && (
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-900/40 text-purple-300">
                    hosted
                  </span>
                )}
                {s.source === "remote" && s.status === "reachable" && (
                  <span className="text-xs px-2 py-0.5 rounded bg-green/20 text-green">reachable</span>
                )}
                {s.source === "remote" && s.status === "unprobed" && (
                  <button
                    onClick={() => handleStart(s.id)}
                    className="text-xs px-2 py-0.5 rounded bg-bg-hover text-text-muted hover:text-accent transition-colors"
                  >
                    Probe
                  </button>
                )}
                {(s.tool_count > 0 || s.source === "remote") && (
                  <button onClick={() => toggleTools(s.id)}
                    className="text-sm text-text-muted hover:text-text transition-colors">
                    {s.tool_count > 0 ? `${s.tool_count} tools` : "probe"}
                  </button>
                )}
                {s.source === "custom" && s.status === "running" && (
                  <button onClick={() => handleStop(s.id)}
                    className="text-sm text-text-muted hover:text-red transition-colors">
                    Stop
                  </button>
                )}
                {s.source === "custom" && s.status !== "running" && (
                  <button onClick={() => handleStart(s.id)}
                    className="text-sm text-accent hover:text-accent-hover transition-colors">
                    Start
                  </button>
                )}
                <button onClick={() => handleDelete(s.id)}
                  className="text-sm text-text-muted hover:text-red transition-colors">
                  Delete
                </button>
              </div>
            </div>
            {s.command && (
              <div className="px-4 pb-3 text-text-dim text-sm">{s.command}</div>
            )}
            {s.source === "remote" && s.url && (
              <div className="px-4 pb-3 flex items-center gap-2">
                <span className="text-text-dim text-xs">URL:</span>
                <code className="text-accent text-xs bg-bg-input rounded px-2 py-1 select-all overflow-hidden truncate max-w-full">
                  {s.url}
                </code>
              </div>
            )}
            {s.source === "remote" && (
              <div className="px-4 pb-3 text-text-dim text-xs">
                Managed upstream. Cores connect directly — apteva-server does not proxy this endpoint.
              </div>
            )}

            {/* Server config toggle */}
            {expandedTools[s.id] && s.proxy_config && (
              <div className="border-t border-border px-4 py-2">
                <button
                  onClick={() => setShowConfig((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                  className="text-xs text-text-muted hover:text-accent transition-colors"
                >
                  {showConfig[s.id] ? "Hide connection details" : "Show connection details"}
                </button>

                {showConfig[s.id] && (
                  <div className="mt-3 space-y-2">
                    {s.proxy_config.transport === "http" && (
                      <div className="space-y-1.5">
                        <div className="text-text-dim text-xs">Endpoint:</div>
                        <code className="text-accent text-xs bg-bg-input rounded px-2 py-1.5 block select-all overflow-x-auto whitespace-nowrap">
                          {s.proxy_config.url}
                        </code>
                        <div className="text-text-dim text-xs mt-2">Via console:</div>
                        <code className="text-text text-xs bg-bg-input rounded px-2 py-1.5 block select-all overflow-x-auto whitespace-nowrap">
                          connect {s.proxy_config.url}
                        </code>
                        <div className="text-text-dim text-xs mt-2">For config.json:</div>
                        <pre className="text-text text-xs bg-bg-input rounded px-2 py-1.5 block select-all overflow-x-auto whitespace-pre">
{JSON.stringify({name: s.proxy_config.name, transport: "http", url: s.proxy_config.url}, null, 2)}
                        </pre>
                      </div>
                    )}
                    {s.proxy_config.transport === "stdio" && (
                      <div className="space-y-1.5">
                        <div className="text-text-dim text-xs">Command:</div>
                        <code className="text-text text-xs bg-bg-input rounded px-2 py-1.5 block select-all overflow-x-auto whitespace-nowrap">
                          {s.proxy_config.command} {(s.proxy_config.args || []).join(" ")}
                        </code>
                        <div className="text-text-dim text-xs mt-2">For config.json:</div>
                        <pre className="text-text text-xs bg-bg-input rounded px-2 py-1.5 block select-all overflow-x-auto whitespace-pre">
{JSON.stringify({name: s.proxy_config.name, command: s.proxy_config.command, args: s.proxy_config.args}, null, 2)}
                        </pre>
                      </div>
                    )}
                    <p className="text-text-dim text-xs mt-1">
                      Credentials are stored in the server. No API keys needed in core's config.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Expanded tools list */}
            {expandedTools[s.id] && expandedTools[s.id].length > 0 && (
              <div className="border-t border-border px-4 py-3 space-y-2">
                {expandedTools[s.id].map((tool) => (
                  <div key={tool.name} className="flex items-center justify-between">
                    <div className="flex items-start gap-3">
                      <span className="text-accent text-sm font-bold shrink-0">{tool.name}</span>
                      <span className="text-text-muted text-sm">{tool.description}</span>
                    </div>
                    {((s.source === "local" && s.connection_id > 0) ||
                      s.source === "remote" ||
                      (s.source === "custom" && s.status === "running")) && (
                      <button
                        onClick={() => { setTestingTool({ serverId: s.id, tool }); setTestArgs({}); setTestResult(null); setShowOptional(false); }}
                        className="text-xs text-accent hover:text-accent-hover transition-colors shrink-0 ml-3"
                      >
                        Test
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Tool testing modal */}
      <Modal open={!!testingTool} onClose={() => { setTestingTool(null); setTestResult(null); }}>
        {testingTool && (() => {
          const props = (testingTool.tool.inputSchema?.properties as Record<string, any>) || {};
          const requiredList = (testingTool.tool.inputSchema?.required as string[]) || [];
          const entries = Object.entries(props);
          const required = entries.filter(([k]) => requiredList.includes(k));
          const optional = entries.filter(([k]) => !requiredList.includes(k));

          const renderField = ([key, schema]: [string, any]) => (
            <div key={key}>
              <label className="block text-text-muted text-sm mb-1">
                {key}
                {requiredList.includes(key) && <span className="text-red ml-1">*</span>}
                {schema.type && (
                  <span className="text-text-dim text-xs ml-2">{schema.type}</span>
                )}
              </label>
              {schema.description && (
                <p className="text-text-dim text-xs mb-1 line-clamp-2">{schema.description}</p>
              )}
              <input
                value={testArgs[key] || ""}
                onChange={(e) => setTestArgs({ ...testArgs, [key]: e.target.value })}
                className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                placeholder={
                  schema.type === "number" || schema.type === "integer"
                    ? "0"
                    : schema.type === "array" || schema.type === "object"
                      ? "JSON"
                      : ""
                }
              />
            </div>
          );

          return (
            <div className="p-6 flex flex-col max-h-[80vh]">
              <div className="shrink-0">
                <h3 className="text-text text-base font-bold">{testingTool.tool.name}</h3>
                {testingTool.tool.description && (
                  <p className="text-text-muted text-sm mt-1 line-clamp-3">
                    {testingTool.tool.description}
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 my-4 pr-1">
                {entries.length === 0 && (
                  <p className="text-text-muted text-sm">No arguments.</p>
                )}
                {required.map(renderField)}
                {optional.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={() => setShowOptional((v) => !v)}
                      className="text-xs text-accent hover:text-accent-hover transition-colors"
                    >
                      {showOptional
                        ? `▾ Hide ${optional.length} optional field${optional.length === 1 ? "" : "s"}`
                        : `▸ Show ${optional.length} optional field${optional.length === 1 ? "" : "s"}`}
                    </button>
                    {showOptional && (
                      <div className="space-y-4 mt-3">
                        {optional.map(renderField)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {testResult && (
                <div className={`shrink-0 border rounded-lg p-3 text-sm mb-3 ${testResult.success ? "border-green" : "border-red"}`}>
                  <div className="text-text-muted text-xs mb-1">
                    Status: {testResult.status} {testResult.success ? "OK" : "Error"}
                  </div>
                  <pre className="text-text text-xs overflow-auto max-h-40 whitespace-pre-wrap">
                    {typeof testResult.data === "string" ? testResult.data : JSON.stringify(testResult.data, null, 2)}
                  </pre>
                </div>
              )}

              <div className="shrink-0 flex justify-end gap-3">
                <button
                  onClick={() => { setTestingTool(null); setTestResult(null); }}
                  className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
                >
                  Close
                </button>
                <button
                  disabled={testRunning}
                  onClick={async () => {
                    setTestRunning(true);
                    setTestResult(null);
                    try {
                      const srv = servers.find((sv) => sv.id === testingTool.serverId);
                      if (!srv) return;
                      // Parse arg types from the tool's input schema.
                      const input: Record<string, any> = {};
                      for (const [k, v] of Object.entries(testArgs)) {
                        if (v === "") continue;
                        const schema = (testingTool.tool.inputSchema?.properties as any)?.[k];
                        if (schema?.type === "number" || schema?.type === "integer") {
                          input[k] = Number(v);
                        } else if (schema?.type === "boolean") {
                          input[k] = v === "true" || v === "1";
                        } else if (schema?.type === "array" || schema?.type === "object") {
                          // Let user paste JSON for complex types.
                          try { input[k] = JSON.parse(v); } catch { input[k] = v; }
                        } else {
                          input[k] = v;
                        }
                      }
                      // Dispatch on source: local → integrations.execute,
                      // remote/custom → mcpServers.callTool.
                      let result;
                      if (srv.source === "local" && srv.connection_id > 0) {
                        result = await integrations.execute(srv.connection_id, testingTool.tool.name, input);
                      } else {
                        result = await mcpServers.callTool(srv.id, testingTool.tool.name, input);
                      }
                      setTestResult(result);
                    } catch (err: any) {
                      setTestResult({ success: false, status: 0, data: err.message });
                    } finally {
                      setTestRunning(false);
                    }
                  }}
                  className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {testRunning ? "Running..." : "Run"}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

// ─── Subscriptions Tab ───

function SubscriptionsTab() {
  const { currentProject } = useProjects();
  const [subs, setSubs] = useState<SubscriptionInfo[]>([]);
  const safeSubs = subs || [];
  const [connections, setConnections] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<Record<string, any>>({});
  const [instanceList, setInstanceList] = useState<Instance[]>([]);
  const [adding, setAdding] = useState<any | null>(null); // connection being subscribed to
  const [instanceId, setInstanceId] = useState(0);
  const [description, setDescription] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = () => {
    subscriptions.list(currentProject?.id).then(setSubs).catch(() => {});
    integrations.connections(currentProject?.id).then(setConnections).catch(() => {});
    instancesAPI.list(currentProject?.id).then(setInstanceList).catch(() => {});
    integrations.catalog().then((apps) => {
      const map: Record<string, any> = {};
      for (const app of apps || []) map[app.slug] = app;
      setCatalog(map);
    }).catch(() => {});
  };
  useEffect(() => { load(); }, [currentProject?.id]);

  const safeConns = connections || [];
  const subscribedConnIds = new Set(safeSubs.map((s) => s.connection_id));

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!adding || !instanceId) { setError("Select an instance"); return; }

    try {
      await subscriptions.create(
        `${adding.app_name} webhooks`,
        adding.app_slug,
        instanceId,
        {
          connectionId: adding.id,
          description: description.trim(),
          hmacSecret: hmacSecret.trim(),
        }
      );
      setAdding(null);
      setDescription(""); setHmacSecret(""); setInstanceId(0); setSelectedEvents(new Set());
      load();
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  };

  const handleDelete = async (id: string) => {
    await subscriptions.delete(id);
    load();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (enabled) await subscriptions.disable(id);
    else await subscriptions.enable(id);
    load();
  };

  const [testingSub, setTestingSub] = useState<any | null>(null);
  const [testEvent, setTestEvent] = useState("");
  const [testPayload, setTestPayload] = useState("{}");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const openTestModal = (sub: any) => {
    const events = catalog[sub.slug]?.webhook_events;
    setTestingSub(sub);
    setTestEvent(events?.[0]?.name || "test.event");
    setTestPayload(JSON.stringify({ message: "Test event", id: 123 }, null, 2));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!testingSub) return;
    setTestSending(true);
    setTestResult(null);
    try {
      let payload: Record<string, any> | undefined;
      try { payload = JSON.parse(testPayload); } catch { /* use default */ }
      const res = await subscriptions.test(testingSub.id, { event: testEvent, payload });
      setTestResult(`Delivered "${res.event}" to instance`);
    } catch (e: any) {
      setTestResult(`Failed: ${e.message || "unknown error"}`);
    }
    setTestSending(false);
  };

  const copyUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Subscriptions</h2>
        <p className="text-text-muted text-sm mt-1">
          Receive events from connected integrations via webhooks.
          Configure the webhook URL in your external service to deliver events to your Apteva instance.
        </p>
      </div>

      {/* Active subscriptions */}
      {safeSubs.length > 0 && (
        <section>
          <h3 className="text-text-muted text-sm font-bold mb-3 uppercase tracking-wide">Active</h3>
          <div className="space-y-3">
            {safeSubs.map((sub) => (
              <div key={sub.id} className="border border-border rounded-lg p-4 bg-bg-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${sub.enabled ? "bg-green" : "bg-red"}`} />
                    <span className="text-text text-base font-bold">{sub.name}</span>
                    {sub.slug && <span className="text-text-muted text-sm">{sub.slug}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => openTestModal(sub)}
                      className="text-sm text-accent hover:text-accent-hover transition-colors">
                      Test
                    </button>
                    <button onClick={() => handleToggle(sub.id, sub.enabled)}
                      className="text-sm text-text-muted hover:text-text transition-colors">
                      {sub.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => handleDelete(sub.id)}
                      className="text-sm text-text-muted hover:text-red transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
                {sub.description && <p className="text-text-dim text-sm mb-2">{sub.description}</p>}
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-bg-input rounded px-2 py-1 text-accent select-all flex-1 overflow-x-auto">
                    {sub.webhook_url}
                  </code>
                  <button
                    onClick={() => copyUrl(sub.id, sub.webhook_url)}
                    className="text-xs text-text-muted hover:text-text transition-colors shrink-0"
                  >
                    {copiedId === sub.id ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="text-text-dim text-xs mt-2">
                  Instance #{sub.instance_id}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Available connections to subscribe to */}
      {safeConns.length > 0 && (
        <section>
          <h3 className="text-text-muted text-sm font-bold mb-3 uppercase tracking-wide">
            Available Integrations
          </h3>
          <div className="space-y-2">
            {safeConns.filter((c: any) => !subscribedConnIds.has(c.id) && catalog[c.app_slug]?.has_webhooks).map((conn: any) => (
              <div key={conn.id} className="border border-border rounded-lg p-4 bg-bg-card flex items-center justify-between">
                <div>
                  <span className="text-text text-sm font-bold">{conn.app_name}</span>
                  <span className="text-text-muted text-sm ml-2">{conn.name}</span>
                </div>
                <button
                  onClick={() => {
                    setAdding(conn);
                    setError("");
                    const events = catalog[conn.app_slug]?.webhook_events;
                    setSelectedEvents(events ? new Set(events.map((ev: any) => ev.name)) : new Set());
                  }}
                  className="text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  Subscribe
                </button>
              </div>
            ))}
          </div>
          {safeConns.filter((c: any) => !subscribedConnIds.has(c.id) && catalog[c.app_slug]?.has_webhooks).length === 0 && (
            <p className="text-text-dim text-sm">No integrations with webhook support available.</p>
          )}
        </section>
      )}

      {safeConns.length === 0 && safeSubs.length === 0 && (
        <p className="text-text-muted text-sm">
          No integrations connected. Go to the Integrations page to connect an app first.
        </p>
      )}

      {/* Subscribe modal */}
      <Modal open={!!adding} onClose={() => setAdding(null)}>
        {adding && (
          <form onSubmit={handleSubscribe} className="p-6 space-y-4">
            <h3 className="text-text text-base font-bold">
              Subscribe to {adding.app_name}
            </h3>
            <p className="text-text-muted text-sm">
              Subscribe to {adding.app_name} events. The webhook will be automatically registered with {adding.app_name} — no manual configuration needed.
            </p>

            <div>
              <label className="block text-text-muted text-sm mb-2">Target Instance</label>
              <select
                value={instanceId} onChange={(e) => setInstanceId(Number(e.target.value))}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              >
                <option value={0}>Select instance...</option>
                {instanceList.map((inst) => (
                  <option key={inst.id} value={inst.id}>{inst.name} (#{inst.id})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-text-muted text-sm mb-2">Description (optional)</label>
              <input
                value={description} onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                placeholder="e.g. Push events on main branch"
              />
            </div>

            {(() => {
              const events = catalog[adding.app_slug]?.webhook_events;
              if (!events || events.length === 0) return null;
              return (
                <div>
                  <label className="block text-text-muted text-sm mb-2">Events</label>
                  <div className="border border-border rounded-lg bg-bg-input p-3 max-h-48 overflow-y-auto space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer py-1 px-1 rounded hover:bg-bg-card">
                      <input
                        type="checkbox"
                        checked={selectedEvents.size === events.length}
                        onChange={(e) => {
                          setSelectedEvents(e.target.checked ? new Set(events.map((ev: any) => ev.name)) : new Set());
                        }}
                        className="accent-accent"
                      />
                      <span className="text-text text-sm font-bold">All events</span>
                    </label>
                    <div className="border-t border-border my-1" />
                    {events.map((ev: any) => (
                      <label key={ev.name} className="flex items-start gap-2 cursor-pointer py-1 px-1 rounded hover:bg-bg-card">
                        <input
                          type="checkbox"
                          checked={selectedEvents.has(ev.name)}
                          onChange={(e) => {
                            const next = new Set(selectedEvents);
                            e.target.checked ? next.add(ev.name) : next.delete(ev.name);
                            setSelectedEvents(next);
                          }}
                          className="accent-accent mt-0.5"
                        />
                        <div>
                          <span className="text-text text-sm">{ev.name}</span>
                          {ev.description && <p className="text-text-dim text-xs">{ev.description}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="block text-text-muted text-sm mb-2">HMAC Secret (optional)</label>
              <input
                type="password"
                value={hmacSecret} onChange={(e) => setHmacSecret(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                placeholder="For signature verification"
              />
            </div>

            {error && <div className="text-red text-sm">{error}</div>}

            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setAdding(null)}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
                Cancel
              </button>
              <button type="submit"
                className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors">
                Create Subscription
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Test event modal */}
      <Modal open={!!testingSub} onClose={() => setTestingSub(null)}>
        {testingSub && (
          <div className="p-6 space-y-4">
            <h3 className="text-text text-base font-bold">
              Test {testingSub.name}
            </h3>
            <p className="text-text-muted text-sm">
              Send a test event to verify your subscription is working.
            </p>

            <div>
              <label className="block text-text-muted text-sm mb-2">Event Type</label>
              {(() => {
                const events = catalog[testingSub.slug]?.webhook_events;
                if (events && events.length > 0) {
                  return (
                    <select
                      value={testEvent}
                      onChange={(e) => setTestEvent(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                    >
                      {events.map((ev: any) => (
                        <option key={ev.name} value={ev.name}>{ev.name} — {ev.description}</option>
                      ))}
                    </select>
                  );
                }
                return (
                  <input
                    value={testEvent}
                    onChange={(e) => setTestEvent(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                    placeholder="e.g. content.created"
                  />
                );
              })()}
            </div>

            <div>
              <label className="block text-text-muted text-sm mb-2">Payload (JSON)</label>
              <textarea
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                rows={6}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent resize-y"
                placeholder='{ "message": "hello" }'
              />
            </div>

            {testResult && (
              <div className={`text-sm ${testResult.startsWith("Failed") ? "text-red" : "text-green"}`}>
                {testResult}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setTestingSub(null)}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
                Close
              </button>
              <button onClick={handleTest} disabled={testSending}
                className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50">
                {testSending ? "Sending..." : "Send Test Event"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── API Keys Tab ───

function APIKeysTab() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = () => auth.listKeys().then(setKeys).catch(() => {});
  useEffect(() => { load(); }, []);

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    const result = await auth.createKey(newKeyName.trim());
    setNewKey(result.key);
    setNewKeyName("");
    load();
  };

  const deleteKey = async (id: number) => {
    await auth.deleteKey(id);
    load();
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">API Keys</h2>
        <p className="text-text-muted text-sm mt-1">
          Create keys to access the server API programmatically.
        </p>
      </div>

      <form onSubmit={createKey} className="flex gap-3">
        <input
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          className="flex-1 bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
          placeholder="Key name"
        />
        <button
          type="submit"
          className="px-5 py-3 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
        >
          New Key
        </button>
      </form>

      {newKey && (
        <div className="border border-accent rounded-lg p-4 bg-bg-card">
          <p className="text-accent text-sm mb-2">Save this key — it won't be shown again:</p>
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
          <div key={k.id} className="border border-border rounded-lg p-4 bg-bg-card flex items-center justify-between">
            <div>
              <span className="text-text text-base">{k.name}</span>
              <span className="text-text-muted text-sm ml-4">{k.key_prefix}...</span>
            </div>
            <button
              onClick={() => deleteKey(k.id)}
              className="text-sm text-text-muted hover:text-red transition-colors"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Data Tab ───

function DataTab() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const handleWipe = async () => {
    const result = await telemetry.wipe();
    setCount(result.deleted);
    setShowConfirm(false);
    setWiped(true);
    setTimeout(() => setWiped(false), 3000);
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Data</h2>
        <p className="text-text-muted text-sm mt-1">
          Manage telemetry and event data stored by the system.
        </p>
      </div>

      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <h3 className="text-text text-sm font-bold mb-2">Telemetry</h3>
        <p className="text-text-muted text-sm mb-4">
          Clear all stored telemetry events (LLM calls, thread activity, tool usage).
          This does not affect running instances.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfirm(true)}
            className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
          >
            Wipe Telemetry
          </button>
          {wiped && (
            <span className="text-green text-sm">
              Deleted {count} events
            </span>
          )}
        </div>
      </div>

      <Modal open={showConfirm} onClose={() => setShowConfirm(false)}>
        <div className="p-6">
          <h3 className="text-text text-base font-bold mb-2">Wipe telemetry data?</h3>
          <p className="text-text-muted text-sm mb-6">
            This will permanently delete all stored telemetry events including LLM call history,
            thread activity, and tool usage data. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowConfirm(false)}
              className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleWipe}
              className="px-4 py-2.5 bg-red rounded-lg text-sm text-white font-bold hover:opacity-90 transition-colors"
            >
              Wipe All Data
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Account Tab ───

function AccountTab() {
  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Account</h2>
        <p className="text-text-muted text-sm mt-1">Manage your account settings.</p>
      </div>

      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <h3 className="text-text text-sm font-bold mb-3">Sign out</h3>
        <p className="text-text-muted text-sm mb-4">
          This will end your current session. You'll need to sign in again.
        </p>
        <button
          onClick={() => auth.logout()}
          className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

// ─── Projects Tab ───

const PROJECT_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4"];

function ProjectsTab() {
  const { projects, currentProject, setCurrentProject, reload } = useProjects();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const p = await projectsAPI.create(name.trim(), description.trim(), color);
    if (!currentProject) setCurrentProject(p);
    reload();
    setName(""); setDescription(""); setColor(PROJECT_COLORS[0]); setShowCreate(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !name.trim()) return;
    await projectsAPI.update(editingId, name.trim(), description.trim(), color);
    reload();
    setEditingId(null); setName(""); setDescription(""); setColor(PROJECT_COLORS[0]);
  };

  const handleDelete = async (id: string) => {
    await projectsAPI.delete(id);
    if (currentProject?.id === id) setCurrentProject(null);
    reload();
  };

  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description);
    setColor(p.color);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold">Projects</h2>
        <p className="text-text-muted text-sm mt-1">
          Organize instances, connections, and subscriptions by business or use case.
        </p>
      </div>
      <button
        onClick={() => { setShowCreate(true); setEditingId(null); setName(""); setDescription(""); setColor(PROJECT_COLORS[0]); }}
        className="px-4 py-2.5 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors"
      >
        New Project
      </button>

      {projects.length === 0 && (
        <p className="text-text-dim text-sm">No projects yet. Create one to get started.</p>
      )}

      <div className="space-y-3">
        {projects.map((p) => (
          <div key={p.id} className={`border rounded-lg p-4 bg-bg-card flex items-center justify-between ${currentProject?.id === p.id ? "border-accent" : "border-border"}`}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
              <div>
                <span className="text-text text-sm font-bold">{p.name}</span>
                {p.description && <p className="text-text-dim text-xs mt-0.5">{p.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {currentProject?.id !== p.id && (
                <button onClick={() => setCurrentProject(p)} className="text-xs text-accent hover:text-accent-hover transition-colors">
                  Switch
                </button>
              )}
              {currentProject?.id === p.id && (
                <span className="text-xs text-accent">Active</span>
              )}
              <button onClick={() => openEdit(p)} className="text-xs text-text-muted hover:text-text transition-colors">
                Edit
              </button>
              <button onClick={() => handleDelete(p.id)} className="text-xs text-text-muted hover:text-red transition-colors">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit modal */}
      <Modal open={showCreate || !!editingId} onClose={() => { setShowCreate(false); setEditingId(null); }}>
        <form onSubmit={editingId ? handleUpdate : handleCreate} className="p-6 space-y-4">
          <h3 className="text-text text-base font-bold">{editingId ? "Edit Project" : "New Project"}</h3>
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)} autoFocus
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
              placeholder="e.g. Business A"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Description (optional)</label>
            <input
              value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
              placeholder="What this project is for"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Color</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-colors ${color === c ? "border-text" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { setShowCreate(false); setEditingId(null); }}
              className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors">
              {editingId ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
