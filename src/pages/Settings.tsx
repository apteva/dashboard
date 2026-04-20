import { useState, useEffect } from "react";
import { auth, providers, providerTypes, telemetry, mcpServers, integrations, subscriptions, channels, slack, email as emailAPI, projects as projectsAPI, instances as instancesAPI, serverSettings, type Provider, type ProviderTypeInfo, type MCPServer, type MCPTool, type SubscriptionInfo, type Instance, type Project, type CatalogStatus, type ChannelInfo, type SlackChannelInfo, type ServerSettings as ServerSettingsType } from "../api";
import { Modal } from "../components/Modal";
import { useProjects } from "../hooks/useProjects";

interface Key {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
}


type Tab = "projects" | "channels" | "integrations" | "providers" | "mcp" | "subscriptions" | "api-keys" | "data" | "account" | "server";

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
    { id: "server", label: "Server" },
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
        {tab === "server" && <ServerTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </div>
  );
}

// ─── Channels Tab ───

function ChannelsTab() {
  const { currentProject } = useProjects();
  const [instanceList, setInstanceList] = useState<Instance[]>([]);
  const [allChannels, setAllChannels] = useState<ChannelInfo[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal state
  const [connectType, setConnectType] = useState<"slack" | "telegram" | "email">("slack");
  const [selectedInstance, setSelectedInstance] = useState<number>(0);
  const [connecting, setConnecting] = useState(false);

  // Telegram
  const [telegramToken, setTelegramToken] = useState("");

  // Slack
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [slackConfiguring, setSlackConfiguring] = useState(false);
  const [slackChannels, setSlackChannels] = useState<SlackChannelInfo[]>([]);
  const [selectedSlackChannel, setSelectedSlackChannel] = useState("");

  // Email
  const [emailConnected, setEmailConnected] = useState(false);
  const [emailApiKey, setEmailApiKey] = useState("");
  const [emailConfiguring, setEmailConfiguring] = useState(false);

  const load = () => {
    const pid = currentProject?.id;
    instancesAPI.list(pid).then((list) => {
      setInstanceList(list || []);
      // Load channels for all instances
      const all: ChannelInfo[] = [];
      Promise.all((list || []).map((inst) =>
        channels.list({ instanceId: inst.id }).then((chs) => {
          for (const ch of chs) all.push(ch);
        }).catch(() => {})
      )).then(() => setAllChannels(all));
    }).catch(() => {});
    slack.status(pid || "").then((s) => {
      setSlackConnected(s.connected);
      if (s.connected) {
        slack.listChannels(pid || "").then(setSlackChannels).catch(() => {});
      }
    }).catch(() => {});
    emailAPI.status(pid || "").then((s) => setEmailConnected(s.connected)).catch(() => {});
  };

  useEffect(() => { load(); }, [currentProject?.id]);

  const instName = (id: number) => instanceList.find((i) => i.id === id)?.name || `#${id}`;

  const handleConfigureSlack = async () => {
    if (!slackBotToken.trim() || !slackAppToken.trim()) return;
    setError(""); setSlackConfiguring(true);
    try {
      await slack.configure(currentProject?.id || "", slackBotToken.trim(), slackAppToken.trim());
      setSlackConnected(true); setSlackBotToken(""); setSlackAppToken("");
      setSlackChannels(await slack.listChannels(currentProject?.id || ""));
    } catch (err: any) {
      setError(err.message || "Failed to configure Slack");
    } finally { setSlackConfiguring(false); }
  };

  const handleConfigureEmail = async () => {
    if (!emailApiKey.trim()) return;
    setError(""); setEmailConfiguring(true);
    try {
      await emailAPI.configure(currentProject?.id || "", emailApiKey.trim());
      setEmailConnected(true); setEmailApiKey("");
    } catch (err: any) {
      setError(err.message || "Failed to configure email");
    } finally { setEmailConfiguring(false); }
  };

  const handleConnect = async () => {
    if (!selectedInstance) { setError("Select an instance"); return; }
    setError(""); setConnecting(true);
    try {
      if (connectType === "telegram") {
        if (!telegramToken.trim()) { setError("Token required"); setConnecting(false); return; }
        const r = await channels.connect(selectedInstance, "telegram", { token: telegramToken.trim() });
        setSuccess(`Connected @${r.bot_name}`);
        setTelegramToken("");
      } else if (connectType === "slack") {
        if (!selectedSlackChannel) { setError("Select a channel"); setConnecting(false); return; }
        const ch = slackChannels.find((c) => c.id === selectedSlackChannel);
        await channels.connect(selectedInstance, "slack", {
          channel_id: selectedSlackChannel,
          channel_name: ch?.name || selectedSlackChannel,
        });
        setSuccess(`Connected #${ch?.name || selectedSlackChannel}`);
        setSelectedSlackChannel("");
      } else if (connectType === "email") {
        const r = await channels.connect(selectedInstance, "email", {});
        setSuccess(`Created inbox ${(r as any).email || ""}`);
      }
      setShowModal(false); load();
    } catch (err: any) {
      setError(err.message || "Failed to connect");
    } finally { setConnecting(false); }
  };

  const handleDisconnect = async (id: number) => {
    try { await channels.disconnect(id); load(); } catch {}
  };

  // Group non-CLI channels by instance for display
  const connected = allChannels.filter((c) => c.type !== "cli");

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text text-base font-bold mb-1">Channels</h2>
          <p className="text-text-muted text-sm">Connect agents to Slack, Telegram, or other messaging platforms.</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setError(""); setSuccess(""); setConnectType(slackConnected ? "slack" : "telegram"); setSelectedInstance(instanceList[0]?.id || 0); }}
          className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors shrink-0"
        >
          + Connect channel
        </button>
      </div>

      {/* Connected channels list */}
      {connected.length === 0 ? (
        <div className="border border-border rounded-lg bg-bg-card px-4 py-8 text-center">
          <p className="text-text-muted text-sm">No channels connected yet.</p>
          <p className="text-text-dim text-xs mt-1">Click "+ Connect channel" to link an agent to Slack or Telegram.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg bg-bg-card divide-y divide-border">
          {connected.map((ch) => (
            <div key={`${ch.type}-${ch.id}`} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${ch.status === "connected" ? "bg-green" : "bg-red"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-text font-medium text-sm">
                    {ch.type === "telegram" ? "Telegram" : ch.type === "slack" ? "Slack" : ch.type === "email" ? "Email" : ch.type}
                  </span>
                  <span className="text-text-muted text-xs truncate">{ch.name}</span>
                </div>
                <div className="text-text-dim text-[10px] mt-0.5">{instName(ch.instance_id)}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                ch.status === "connected" ? "bg-green/10 text-green" : "bg-red/10 text-red"
              }`}>
                {ch.status}
              </span>
              <button
                onClick={() => handleDisconnect(ch.id)}
                className="text-text-dim hover:text-red text-xs transition-colors shrink-0 ml-1"
                title="Disconnect"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {success && <p className="text-green text-xs">{success}</p>}

      {/* Connect modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)}>
        <div className="p-6 space-y-4">
          <h3 className="text-text text-base font-bold">Connect channel</h3>
            {/* Instance picker */}
            <div>
              <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Instance</label>
              <select
                value={selectedInstance}
                onChange={(e) => setSelectedInstance(Number(e.target.value))}
                className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
              >
                <option value={0}>Select an instance...</option>
                {instanceList.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} {inst.status !== "running" ? "(stopped)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Channel type */}
            <div>
              <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConnectType("slack")}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors flex-1 ${
                    connectType === "slack" ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted"
                  }`}
                >
                  Slack
                </button>
                <button
                  onClick={() => setConnectType("email")}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors flex-1 ${
                    connectType === "email" ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted"
                  }`}
                >
                  Email
                </button>
                <button
                  onClick={() => setConnectType("telegram")}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors flex-1 ${
                    connectType === "telegram" ? "border-accent text-accent bg-accent/10" : "border-border text-text-muted"
                  }`}
                >
                  Telegram
                </button>
              </div>
            </div>

            {/* Type-specific config */}
            {connectType === "slack" && !slackConnected && (
              <div className="space-y-3 border border-border rounded-lg p-3">
                <p className="text-text-muted text-xs">
                  First, connect your Slack app. Create one at{" "}
                  <a href="https://api.slack.com/apps" target="_blank" className="text-accent hover:underline">api.slack.com/apps</a>.
                </p>
                <input
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  placeholder="Bot token (xoxb-...)"
                  className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                />
                <input
                  value={slackAppToken}
                  onChange={(e) => setSlackAppToken(e.target.value)}
                  placeholder="App token (xapp-...)"
                  className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleConfigureSlack}
                  disabled={slackConfiguring || !slackBotToken.trim() || !slackAppToken.trim()}
                  className="w-full py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {slackConfiguring ? "Connecting..." : "Connect Slack app"}
                </button>
              </div>
            )}

            {connectType === "slack" && slackConnected && (
              <div>
                <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Slack channel</label>
                <select
                  value={selectedSlackChannel}
                  onChange={(e) => setSelectedSlackChannel(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                >
                  <option value="">Select a channel...</option>
                  {slackChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      #{ch.name} {ch.is_private ? "(private)" : ""} — {ch.num_members} members
                    </option>
                  ))}
                </select>
              </div>
            )}

            {connectType === "telegram" && (
              <div>
                <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Bot token</label>
                <input
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder="Token from @BotFather"
                  className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                />
                <p className="text-text-dim text-[10px] mt-1">
                  Get a token from <a href="https://t.me/BotFather" target="_blank" className="text-accent hover:underline">@BotFather</a> on Telegram.
                </p>
              </div>
            )}

            {connectType === "email" && !emailConnected && (
              <div className="space-y-3 border border-border rounded-lg p-3">
                <p className="text-text-muted text-xs">
                  First, connect your AgentMail account. Get an API key at{" "}
                  <a href="https://www.agentmail.to" target="_blank" className="text-accent hover:underline">agentmail.to</a>.
                </p>
                <input
                  value={emailApiKey}
                  onChange={(e) => setEmailApiKey(e.target.value)}
                  placeholder="AgentMail API key"
                  className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleConfigureEmail}
                  disabled={emailConfiguring || !emailApiKey.trim()}
                  className="w-full py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {emailConfiguring ? "Connecting..." : "Connect AgentMail"}
                </button>
              </div>
            )}

            {connectType === "email" && emailConnected && (
              <p className="text-text-muted text-xs">A dedicated inbox will be created for this agent. Replies to that address will route back to the agent.</p>
            )}

            {error && <p className="text-red text-xs">{error}</p>}

            {/* Connect button */}
            <button
              onClick={handleConnect}
              disabled={connecting || !selectedInstance || (connectType === "slack" && (!slackConnected || !selectedSlackChannel)) || (connectType === "telegram" && !telegramToken.trim()) || (connectType === "email" && !emailConnected)}
              className="w-full py-2.5 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </Modal>
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

  // Group types by category. We collapse "browser" and "browserbase" into
  // the same "Browser" section so users see Browserbase, Local Browser, and
  // Remote CDP side-by-side instead of in two separate headings.
  const typeLabels: Record<string, string> = {
    llm: "LLM",
    embeddings: "Embeddings",
    tts: "Text-to-Speech",
    browser: "Browser",
    search: "Search",
    integrations: "Integrations",
  };
  const groupKeyFor = (t: string): string => {
    if (t === "browserbase") return "browser";
    return t;
  };
  const groups: Record<string, ProviderTypeInfo[]> = {};
  for (const t of types) {
    const key = groupKeyFor(t.type);
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
  // Add-MCP form tab: either build a custom stdio server from scratch,
  // or create another MCP row over an existing connection on this project
  // (different name + tool subset).
  const [addTab, setAddTab] = useState<"scratch" | "connection">("scratch");
  const [addConnList, setAddConnList] = useState<import("../api").ConnectionInfo[]>([]);
  const [addConnId, setAddConnId] = useState<number | 0>(0);
  const [addConnName, setAddConnName] = useState("");
  const [addConnTools, setAddConnTools] = useState<MCPTool[]>([]);
  const [addConnSelected, setAddConnSelected] = useState<Set<string>>(new Set());
  const [addConnLoading, setAddConnLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<number, MCPTool[]>>({});
  // allowedTools[serverId] is the currently-persisted filter for each row,
  // populated alongside expandedTools when the user clicks to see the tool
  // list. null = no filter (all tools enabled).
  const [allowedTools, setAllowedTools] = useState<Record<number, string[] | null>>({});
  const [scopeModal, setScopeModal] = useState<{
    server: MCPServer;
    allTools: MCPTool[];
    selected: Set<string>;
  } | null>(null);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [renameMCP, setRenameMCP] = useState<MCPServer | null>(null);
  const [renameMCPText, setRenameMCPText] = useState("");
  const [renameMCPBusy, setRenameMCPBusy] = useState(false);
  const [renameMCPErr, setRenameMCPErr] = useState("");
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

  const openRenameMCP = (s: MCPServer) => {
    setRenameMCP(s);
    setRenameMCPText(s.name);
    setRenameMCPErr("");
  };
  const submitRenameMCP = async () => {
    if (!renameMCP) return;
    const next = renameMCPText.trim();
    if (!next || next === renameMCP.name) { setRenameMCP(null); return; }
    setRenameMCPBusy(true);
    setRenameMCPErr("");
    try {
      await mcpServers.rename(renameMCP.id, next);
      setRenameMCP(null);
      load();
    } catch (e: any) {
      setRenameMCPErr(e?.message || "rename failed");
    } finally {
      setRenameMCPBusy(false);
    }
  };
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

  // When the user picks a connection in the "From connection" tab, load
  // the full app tool catalog. A connection always has at least one MCP
  // server row — any of them exposes the full catalog via the tools()
  // endpoint (the allowed_tools field only filters what the agent sees,
  // not what the catalog returns).
  const selectAddConnection = async (connId: number) => {
    setAddConnId(connId);
    setAddConnTools([]);
    setAddConnSelected(new Set());
    if (!connId) return;
    const conn = addConnList.find((c) => c.id === connId);
    const existing = servers.find((s) => s.connection_id === connId && s.source === "local");
    if (!conn || !existing) {
      setError("No MCP row found for this connection — reconnect first");
      return;
    }
    setAddConnLoading(true);
    try {
      const resp = await mcpServers.tools(existing.id);
      setAddConnTools(resp.tools || []);
      setAddConnName(`${conn.app_slug}-2`);
    } catch (err: any) {
      setError(err?.message || "Failed to load tool list");
    } finally {
      setAddConnLoading(false);
    }
  };

  const handleAddFromConnection = async () => {
    setError("");
    if (!addConnId) { setError("Pick a connection"); return; }
    if (!addConnName.trim()) { setError("Name is required"); return; }
    if (addConnSelected.size === 0) { setError("Select at least one tool"); return; }
    try {
      await integrations.createScopedMCP(addConnId, addConnName.trim(), Array.from(addConnSelected));
      setShowAdd(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Save failed");
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
    const resp = await mcpServers.tools(id);
    setExpandedTools((prev) => ({ ...prev, [id]: resp.tools || [] }));
    setAllowedTools((prev) => ({ ...prev, [id]: resp.allowed_tools || null }));
  };

  // openScopeModal fetches the full tool catalog for the server row and
  // opens a picker with every tool as a checkbox. The picker's initial
  // selection is the server's current allowed_tools (or "all ticked" if
  // the filter is empty — legacy behaviour).
  const openScopeModal = async (server: MCPServer) => {
    try {
      const resp = await mcpServers.tools(server.id);
      const tools = resp.tools || [];
      const existing = resp.allowed_tools || [];
      const selected = new Set<string>(
        existing.length > 0 ? existing : tools.map((t) => t.name),
      );
      setScopeModal({ server, allTools: tools, selected });
    } catch (err: any) {
      alert(`Failed to load tool list: ${err.message || err}`);
    }
  };

  const saveScope = async () => {
    if (!scopeModal) return;
    setScopeSaving(true);
    try {
      // If every available tool is ticked, we persist an empty list meaning
      // "no filter" — keeps the row's allowed_tools column clean for the
      // common case and avoids constant-sized payloads that grow with the
      // catalog.
      const allChecked =
        scopeModal.selected.size === scopeModal.allTools.length;
      const allowed = allChecked ? [] : Array.from(scopeModal.selected);
      await mcpServers.setAllowedTools(scopeModal.server.id, allowed);

      // For remote rows, trigger a reconcile so Composio re-creates the
      // upstream server with the new action set. Best-effort — we surface
      // the update immediately on the UI regardless.
      if (
        scopeModal.server.source === "remote" &&
        scopeModal.server.provider_id
      ) {
        integrations
          .composioReconcile(scopeModal.server.provider_id, currentProject?.id)
          .catch(() => {});
      }
      // Refresh cached tool list + allowed_tools for this row.
      setAllowedTools((prev) => ({ ...prev, [scopeModal.server.id]: allowed }));
      setScopeModal(null);
      load();
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setScopeSaving(false);
    }
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
          onClick={() => {
            setShowAdd(true);
            setAddTab("scratch");
            setError("");
            setAddConnId(0);
            setAddConnName("");
            setAddConnTools([]);
            setAddConnSelected(new Set());
            integrations
              .connections(currentProject?.id)
              .then((cs) => setAddConnList((cs || []).filter((c) => c.source === "local" && c.status === "active")))
              .catch(() => setAddConnList([]));
          }}
          className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors w-fit"
        >
          Add MCP
        </button>
      )}

      {showAdd && (
        <div className="border border-border rounded-lg p-5 bg-bg-card space-y-4">
          {/* Tabs: scratch vs. from existing connection */}
          <div className="flex gap-0 border-b border-border -mx-5 px-5">
            <button
              type="button"
              onClick={() => { setAddTab("scratch"); setError(""); }}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                addTab === "scratch"
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              From scratch
            </button>
            <button
              type="button"
              onClick={() => { setAddTab("connection"); setError(""); }}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                addTab === "connection"
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              From existing connection
            </button>
          </div>

          {addTab === "connection" && (
            <div className="space-y-4">
              <div>
                <label className="block text-text-muted text-sm mb-2">Connection</label>
                <select
                  value={addConnId}
                  onChange={(e) => selectAddConnection(Number(e.target.value))}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                >
                  <option value={0}>— pick a connection —</option>
                  {addConnList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.app_slug})
                    </option>
                  ))}
                </select>
                {addConnList.length === 0 && (
                  <p className="text-text-dim text-xs mt-1">
                    No local connections on this project. Create one from the Integrations tab first.
                  </p>
                )}
              </div>

              {addConnId > 0 && (
                <>
                  <div>
                    <label className="block text-text-muted text-sm mb-2">MCP name</label>
                    <input
                      value={addConnName}
                      onChange={(e) => setAddConnName(e.target.value)}
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                      placeholder="google-sheets-readonly"
                    />
                    <p className="text-text-dim text-xs mt-1">
                      Must be unique within this project. The agent references the MCP by this name.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-text-muted text-sm">Tools</label>
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setAddConnSelected(new Set(addConnTools.map((t) => t.name)))}
                          className="text-text-muted hover:text-accent transition-colors"
                        >
                          All
                        </button>
                        <span className="text-text-dim">·</span>
                        <button
                          type="button"
                          onClick={() => setAddConnSelected(new Set())}
                          className="text-text-muted hover:text-accent transition-colors"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="text-text-dim text-xs mb-2">
                      {addConnSelected.size} / {addConnTools.length} selected
                    </div>
                    <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                      {addConnLoading && (
                        <div className="px-3 py-2 text-text-dim text-sm">Loading tools…</div>
                      )}
                      {!addConnLoading && addConnTools.length === 0 && (
                        <div className="px-3 py-2 text-text-dim text-sm">No tools found.</div>
                      )}
                      {addConnTools.map((tool) => {
                        const checked = addConnSelected.has(tool.name);
                        return (
                          <label
                            key={tool.name}
                            className="flex items-start gap-2 px-3 py-2 hover:bg-bg-hover cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(addConnSelected);
                                if (checked) next.delete(tool.name);
                                else next.add(tool.name);
                                setAddConnSelected(next);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-text text-sm font-mono">{tool.name}</div>
                              {tool.description && (
                                <div className="text-text-dim text-xs truncate">{tool.description}</div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {error && <div className="text-red text-sm">{error}</div>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleAddFromConnection}
                  className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
                >
                  Create MCP
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setError(""); }}
                  className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {addTab === "scratch" && (
          <form onSubmit={handleAdd} className="space-y-4">
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
        </div>
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
                  {/* Display name prominent, slug shown as a mono pill
                      so the user sees what the agent refers to the
                      server as. For legacy rows where the name was
                      set to the display form, show just the name. */}
                  <span className="text-text text-base font-bold">
                    {s.description || s.name}
                  </span>
                  {s.description && s.description !== s.name && (
                    <code className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-muted font-mono">
                      {s.name}
                    </code>
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
                    {(() => {
                      // Prefer the row's own allowed_tools from the list
                      // response — it's the authoritative source right
                      // from the DB, available on every load() tick. The
                      // allowedTools side-state is kept around so the
                      // Scope modal's "in-flight" save reflects instantly,
                      // but we only fall back to it when the row doesn't
                      // carry allowed_tools yet (older server responses).
                      const fromRow = s.allowed_tools;
                      const fromState = allowedTools[s.id];
                      const allowed = fromRow && fromRow.length > 0
                        ? fromRow
                        : fromState;
                      if (allowed && allowed.length > 0) {
                        return `${allowed.length}/${s.tool_count} tools`;
                      }
                      return s.tool_count > 0 ? `${s.tool_count} tools` : "probe";
                    })()}
                  </button>
                )}
                {(s.source === "local" || s.source === "remote") &&
                  s.connection_id > 0 && (
                    <button
                      onClick={() => openScopeModal(s)}
                      className="text-sm text-text-muted hover:text-accent transition-colors"
                      title="Select which tools are exposed by this MCP server"
                    >
                      Scope
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
                <button onClick={() => openRenameMCP(s)}
                  className="text-sm text-text-muted hover:text-text transition-colors"
                  title="Rename this MCP server (changes the canonical name agents use)">
                  Rename
                </button>
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
            {expandedTools[s.id] && expandedTools[s.id].length > 0 && (() => {
              // When the MCP server is scoped, only show the tools that
              // are actually in the filter — this is what the agent sees
              // at runtime. The full catalog is still available in the
              // Scope modal for editing; the list view here reflects the
              // live state. Accept both bare and slug-prefixed forms in
              // the filter set because scenarios sometimes store one or
              // the other.
              const fullList = expandedTools[s.id] || [];
              let visible = fullList;
              let hiddenCount = 0;
              if (s.allowed_tools && s.allowed_tools.length > 0) {
                const allowedSet = new Set<string>();
                for (const name of s.allowed_tools) {
                  allowedSet.add(name);
                  // Also accept the bare form (without integration prefix)
                  // so DB rows that stored prefixed names match tools that
                  // were registered bare, and vice versa.
                  const slugMatch = s.name
                    .toLowerCase()
                    .replace(/[-\s]/g, "[-_]?");
                  const bare = name.replace(new RegExp("^" + slugMatch + "[_-]?", "i"), "");
                  if (bare && bare !== name) allowedSet.add(bare);
                }
                visible = fullList.filter((t) => allowedSet.has(t.name));
                hiddenCount = fullList.length - visible.length;
              }
              return (
              <div className="border-t border-border">
                {/* Compact tool count header with scope indicator */}
                <div className="px-4 py-2 flex items-center justify-between bg-bg-card/30 border-b border-border/50">
                  <span className="text-text-dim text-[10px] uppercase tracking-wide font-bold">
                    {visible.length} tool{visible.length === 1 ? "" : "s"} visible
                    {hiddenCount > 0 && (
                      <span className="text-text-muted normal-case font-normal ml-2">
                        ({hiddenCount} hidden by scope)
                      </span>
                    )}
                  </span>
                  {(s.allowed_tools && s.allowed_tools.length > 0) && (
                    <span className="text-accent text-[10px] font-bold">
                      scoped to {s.allowed_tools.length}/{fullList.length}
                    </span>
                  )}
                </div>
                {/* Tool list: name on top (mono, no prefix), description on
                    bottom (muted), Test button right-aligned. Two-line
                    layout is much easier to scan than the old single-row
                    flex that jammed everything together. */}
                <div className="divide-y divide-border/30">
                  {visible.map((tool) => {
                    // Strip the slug_ prefix for display — the integration
                    // is already identified by the parent card, and the
                    // prefix is noise here. "omnikit-storage_get_file"
                    // renders as "get_file". Keep the full name for the
                    // Test modal key.
                    const displayName = tool.name.replace(
                      new RegExp("^" + s.name.toLowerCase().replace(/[-\s]/g, "[-_]?") + "[_-]?", "i"),
                      "",
                    ) || tool.name;
                    const canTest =
                      (s.source === "local" && s.connection_id > 0) ||
                      s.source === "remote" ||
                      (s.source === "custom" && s.status === "running");
                    return (
                      <div
                        key={tool.name}
                        className="group px-4 py-2.5 flex items-start gap-3 hover:bg-bg-hover transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <code className="text-accent text-xs font-bold font-mono truncate">
                              {displayName}
                            </code>
                          </div>
                          {tool.description && (
                            <p className="text-text-muted text-xs mt-0.5 line-clamp-2 leading-snug">
                              {/* Drop the [IntegrationName] prefix core tacks
                                  onto descriptions — the card header already
                                  names the integration, showing it here again
                                  just adds clutter. */}
                              {tool.description.replace(/^\[[^\]]+\]\s*/, "")}
                            </p>
                          )}
                        </div>
                        {canTest && (
                          <button
                            onClick={() => {
                              setTestingTool({ serverId: s.id, tool });
                              setTestArgs({});
                              setTestResult(null);
                              setShowOptional(false);
                            }}
                            className="text-[10px] text-text-muted hover:text-accent transition-colors shrink-0 opacity-0 group-hover:opacity-100 px-2 py-1 border border-border rounded"
                          >
                            Test
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}
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

      {/* Tool scope picker — select which tools this MCP server exposes */}
      <Modal open={!!renameMCP} onClose={() => !renameMCPBusy && setRenameMCP(null)}>
        <div className="p-6 w-[480px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">Rename MCP server</h2>
          <p className="text-text-dim text-xs leading-snug">
            This name is the canonical identifier agents use — it appears
            as the tool-name prefix and as the <code>mcp=</code> argument
            when sub-threads spawn. Running sub-threads that reference the
            old name will need to be re-spawned after rename.
          </p>
          <input
            value={renameMCPText}
            onChange={(e) => setRenameMCPText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitRenameMCP(); }}
            autoFocus
            placeholder="slug-like-name"
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
          />
          <div className="text-text-dim text-[10px]">
            letters, digits, <code>-</code>, <code>_</code>, <code>.</code> only
          </div>
          {renameMCPErr && <div className="text-red text-xs">{renameMCPErr}</div>}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setRenameMCP(null)}
              disabled={renameMCPBusy}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={submitRenameMCP}
              disabled={renameMCPBusy || !renameMCPText.trim() || renameMCPText.trim() === renameMCP?.name}
              className="px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {renameMCPBusy ? "Saving…" : "Rename"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!scopeModal} onClose={() => setScopeModal(null)}>
        {scopeModal && (
          <div className="p-6 flex flex-col max-h-[80vh] min-w-[560px]">
            <div className="shrink-0 mb-4">
              <h3 className="text-text text-base font-bold">
                Tool scope: {scopeModal.server.name}
              </h3>
              <p className="text-text-muted text-sm mt-1">
                Pick which tools this MCP server exposes. Only the ticked
                tools are visible to instances that attach this server.
                Untick everything to re-enable all tools.
              </p>
              {scopeModal.server.source === "remote" && (
                <p className="text-accent text-xs mt-2">
                  ℹ Composio-hosted server — a reconcile will run after save
                  so the upstream gets the new action set. Running instances
                  need a restart to pick up the change.
                </p>
              )}
            </div>

            <div className="shrink-0 flex items-center gap-3 mb-3 text-xs">
              <button
                onClick={() =>
                  setScopeModal({
                    ...scopeModal,
                    selected: new Set(scopeModal.allTools.map((t) => t.name)),
                  })
                }
                className="text-accent hover:text-accent-hover transition-colors"
              >
                Select all
              </button>
              <span className="text-text-dim">·</span>
              <button
                onClick={() =>
                  setScopeModal({ ...scopeModal, selected: new Set() })
                }
                className="text-text-muted hover:text-text transition-colors"
              >
                Clear
              </button>
              <span className="ml-auto text-text-dim">
                {scopeModal.selected.size} / {scopeModal.allTools.length}{" "}
                selected
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 border border-border rounded-lg p-3 mb-4">
              {scopeModal.allTools.length === 0 && (
                <p className="text-text-muted text-sm py-4 text-center">
                  No tools available from this server.
                </p>
              )}
              {scopeModal.allTools.map((tool) => {
                const checked = scopeModal.selected.has(tool.name);
                return (
                  <label
                    key={tool.name}
                    className="flex items-start gap-2 py-1 cursor-pointer hover:bg-bg-hover rounded px-2"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(scopeModal.selected);
                        if (e.target.checked) next.add(tool.name);
                        else next.delete(tool.name);
                        setScopeModal({ ...scopeModal, selected: next });
                      }}
                      className="mt-1 shrink-0 accent-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-text text-sm font-mono">
                        {tool.name}
                      </div>
                      {tool.description && (
                        <div className="text-text-muted text-xs mt-0.5 line-clamp-2">
                          {tool.description}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="shrink-0 flex justify-end gap-3">
              <button
                onClick={() => setScopeModal(null)}
                disabled={scopeSaving}
                className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveScope}
                disabled={scopeSaving}
                className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {scopeSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
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

  // Composio trigger picker state. Populated when the user opens the
  // subscribe modal on a composio-source connection; empty for local
  // connections (those use the catalog's webhook_events list instead).
  const [composioTriggers, setComposioTriggers] = useState<Array<{
    slug: string;
    name: string;
    description: string;
    type: string;
    config: Record<string, any>;
  }>>([]);
  const [loadingTriggers, setLoadingTriggers] = useState(false);
  const [selectedTrigger, setSelectedTrigger] = useState<string>("");
  const [triggerConfig, setTriggerConfig] = useState<Record<string, any>>({});

  const load = () => {
    // Wait for the current project to resolve before hitting the
    // scoped endpoints — without the project id, the server falls
    // back to "all user rows" and the tab renders subs from every
    // project (plus legacy unscoped ones), which is not what you
    // want when you're looking at a specific project.
    if (!currentProject?.id) {
      setSubs([]);
      setConnections([]);
      setInstanceList([]);
      return;
    }
    subscriptions.list(currentProject.id).then(setSubs).catch(() => {});
    integrations.connections(currentProject.id).then(setConnections).catch(() => {});
    instancesAPI.list(currentProject.id).then(setInstanceList).catch(() => {});
    integrations.catalog().then((apps) => {
      const map: Record<string, any> = {};
      for (const app of apps || []) map[app.slug] = app;
      setCatalog(map);
    }).catch(() => {});
  };
  useEffect(() => { load(); }, [currentProject?.id]);

  const safeConns = connections || [];
  const subscribedConnIds = new Set(safeSubs.map((s) => s.connection_id));

  // When the user opens the subscribe modal on a composio-source
  // connection, fetch the available trigger templates for that toolkit.
  // Local-source connections use the catalog's webhook_events list
  // instead; we clear Composio state to avoid stale picker entries.
  useEffect(() => {
    if (!adding) {
      setComposioTriggers([]);
      setSelectedTrigger("");
      setTriggerConfig({});
      return;
    }
    if (adding.source !== "composio") {
      setComposioTriggers([]);
      return;
    }
    setLoadingTriggers(true);
    integrations
      .triggers(adding.id)
      .then((resp) => {
        setComposioTriggers(resp.triggers || []);
        if ((resp.triggers || []).length > 0) {
          setSelectedTrigger(resp.triggers[0].slug);
          setTriggerConfig({});
        }
      })
      .catch(() => setComposioTriggers([]))
      .finally(() => setLoadingTriggers(false));
  }, [adding?.id, adding?.source]);

  // Currently-selected trigger's config schema — used by the dynamic
  // form renderer inside the modal.
  const selectedTriggerSchema = composioTriggers.find((t) => t.slug === selectedTrigger);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!adding || !instanceId) { setError("Select an instance"); return; }

    const isComposio = adding.source === "composio";
    if (isComposio && !selectedTrigger) {
      setError("Select a trigger");
      return;
    }

    try {
      await subscriptions.create(
        `${adding.app_name} ${isComposio ? "trigger" : "webhooks"}`,
        adding.app_slug,
        instanceId,
        {
          connectionId: adding.id,
          description: description.trim(),
          hmacSecret: hmacSecret.trim(),
          events: isComposio ? [selectedTrigger] : Array.from(selectedEvents),
          projectId: currentProject?.id,
          triggerSlug: isComposio ? selectedTrigger : undefined,
          triggerConfig: isComposio ? triggerConfig : undefined,
        }
      );
      setAdding(null);
      setDescription(""); setHmacSecret(""); setInstanceId(0); setSelectedEvents(new Set());
      setSelectedTrigger(""); setTriggerConfig({});
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
            {safeSubs.map((sub) => {
              const conn = connections.find((c: any) => c.id === sub.connection_id);
              const inst = instanceList.find((i) => i.id === sub.instance_id);
              return (
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
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs mt-2">
                  <dt className="text-text-dim">Connection</dt>
                  <dd className="text-text">
                    {conn ? (
                      <>
                        {conn.app_name}
                        <span className="text-text-muted ml-2">{conn.name}</span>
                      </>
                    ) : (
                      <span className="text-text-dim">#{sub.connection_id} (not found)</span>
                    )}
                  </dd>
                  <dt className="text-text-dim">Agent</dt>
                  <dd className="text-text">
                    {inst ? inst.name : <span className="text-text-dim">#{sub.instance_id} (not found)</span>}
                  </dd>
                  <dt className="text-text-dim">Events</dt>
                  <dd>
                    {sub.events && sub.events.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {sub.events.map((ev) => (
                          <code key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text font-mono">
                            {ev}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <span className="text-text-dim">all events</span>
                    )}
                  </dd>
                </dl>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Available connections to subscribe to. A connection qualifies
          if it's a local template with webhook.registration config OR
          any composio-source connection (Composio exposes triggers for
          most toolkits, the picker inside the modal shows the real
          list per-connection so we don't try to guess here). */}
      {safeConns.length > 0 && (() => {
        const available = safeConns.filter((c: any) => {
          if (c.source === "composio") return true;
          return catalog[c.app_slug]?.has_webhooks;
        });
        return (
          <section>
            <h3 className="text-text-muted text-sm font-bold mb-3 uppercase tracking-wide">
              Available Integrations
            </h3>
            <div className="space-y-2">
              {available.map((conn: any) => (
                <div key={conn.id} className="border border-border rounded-lg p-4 bg-bg-card flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-text text-sm font-bold">{conn.app_name}</span>
                    <span className="text-text-muted text-sm">{conn.name}</span>
                    {conn.source === "composio" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">composio</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setAdding(conn);
                      setError("");
                      if (conn.source === "composio") {
                        setSelectedEvents(new Set());
                      } else {
                        const events = catalog[conn.app_slug]?.webhook_events;
                        setSelectedEvents(events ? new Set(events.map((ev: any) => ev.name)) : new Set());
                      }
                    }}
                    className="text-sm text-accent hover:text-accent-hover transition-colors"
                  >
                    Subscribe
                  </button>
                </div>
              ))}
            </div>
            {available.length === 0 && (
              <p className="text-text-dim text-sm">No integrations with webhook or trigger support available.</p>
            )}
          </section>
        );
      })()}

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
              <label className="block text-text-muted text-sm mb-2">Target Agent</label>
              <select
                value={instanceId} onChange={(e) => setInstanceId(Number(e.target.value))}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              >
                <option value={0}>Select agent...</option>
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

            {adding.source === "composio" ? (
              // Composio-source: render a trigger picker populated from
              // the live Composio catalog for this connection's toolkit,
              // plus a dynamic config form built from the selected
              // trigger's config schema.
              <div className="space-y-3">
                <div>
                  <label className="block text-text-muted text-sm mb-2">Trigger</label>
                  {loadingTriggers ? (
                    <p className="text-text-dim text-sm">Loading triggers…</p>
                  ) : composioTriggers.length === 0 ? (
                    <p className="text-text-dim text-sm">No triggers available for {adding.app_slug} in Composio.</p>
                  ) : (
                    <select
                      value={selectedTrigger}
                      onChange={(e) => { setSelectedTrigger(e.target.value); setTriggerConfig({}); }}
                      className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                    >
                      {composioTriggers.map((t) => (
                        <option key={t.slug} value={t.slug}>
                          {t.name} ({t.type})
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedTriggerSchema?.description && (
                    <p className="text-text-dim text-xs mt-1">{selectedTriggerSchema.description}</p>
                  )}
                  {selectedTriggerSchema?.type === "poll" && (
                    <p className="text-yellow-500 text-[11px] mt-1">
                      ⓘ Polling trigger — Composio checks upstream on a schedule (typically 15-min intervals). Not real-time.
                    </p>
                  )}
                </div>
                {selectedTriggerSchema && Object.keys(selectedTriggerSchema.config || {}).length > 0 && (
                  <div>
                    <label className="block text-text-muted text-sm mb-2">Configuration</label>
                    <div className="space-y-2 border border-border rounded-lg bg-bg-input p-3">
                      {Object.entries(selectedTriggerSchema.config).map(([key, spec]: [string, any]) => {
                        const required = spec?.required === true;
                        const typeLabel = spec?.type || "string";
                        const desc = spec?.description || spec?.title || "";
                        const current = triggerConfig[key] ?? "";
                        return (
                          <div key={key}>
                            <label className="block text-[11px] text-text-dim mb-1">
                              <span className="font-mono text-text">{key}</span>
                              <span className="ml-2 text-text-dim">{typeLabel}{required ? " *" : ""}</span>
                            </label>
                            <input
                              value={String(current)}
                              onChange={(e) => setTriggerConfig({ ...triggerConfig, [key]: e.target.value })}
                              placeholder={desc}
                              className="w-full bg-bg-card border border-border rounded px-2 py-1.5 text-sm text-text font-mono focus:outline-none focus:border-accent"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (() => {
              // Local-source: use the catalog's webhook_events list.
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

            {adding.source !== "composio" && (
              <div>
                <label className="block text-text-muted text-sm mb-2">HMAC Secret (optional)</label>
                <input
                  type="password"
                  value={hmacSecret} onChange={(e) => setHmacSecret(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
                  placeholder="For signature verification"
                />
              </div>
            )}

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

// ─── Server Tab ───
//
// Admin-editable server-wide settings. Today: just `public_url`, the URL
// the outside world uses to reach this server (Google, GitHub, etc., for
// OAuth callbacks; webhook providers for delivery). Stored in
// server_settings table so it survives container redeploys and doesn't
// require a server restart to change.

function ServerTab() {
  const [data, setData] = useState<ServerSettingsType | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = () => {
    serverSettings
      .get()
      .then((d) => {
        setData(d);
        setDraft(d.public_url.value);
      })
      .catch((err) => setError(err?.message || "Failed to load"));
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
    return <div className="text-text-muted text-sm">Loading…</div>;
  }

  const pu = data.public_url;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold">Server</h2>
        <p className="text-text-muted text-sm mt-1">
          Server-wide settings that affect how this Apteva instance is reached
          from the outside world.
        </p>
      </div>

      <form onSubmit={handleSave} className="border border-border rounded-lg p-5 bg-bg-card space-y-4">
        <div>
          <label className="block text-text text-sm font-bold mb-1">Public URL</label>
          <p className="text-text-muted text-xs mb-3 leading-relaxed">
            The base URL the outside world uses to reach this server. Required
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
