import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { auth, core, platformHelper, providers, providerTypes, telemetry, mcpServers, integrations, subscriptions, channels, slack, email as emailAPI, projects as projectsAPI, instances as instancesAPI, serverSettings, users as usersAPI, apps as appsAPI, projectMembers, projectInvites, adminUsers, type Provider, type ProviderTypeInfo, type ProviderAuthStart, type ProviderAuthStatus, type ProviderUsageSnapshot, type ModelInfo, type MCPServer, type MCPTool, type SubscriptionInfo, type Agent, type Project, type ChannelInfo, type SlackChannelInfo, type ServerSettings as ServerSettingsType, type UserRow, type AppRow, type ProjectMember, type ProjectInvite, type ProjectRole, type AdminUser } from "../api";
import { Modal } from "../components/Modal";
import { ProviderUsageDetails, ProviderUsageSummary } from "../components/ProviderUsage";
import { useProjects } from "../hooks/useProjects";
import { useAuth } from "../hooks/useAuth";
import { useTheme, type ThemeName, type ThemeMode } from "../hooks/useTheme";
import { usePageTitle } from "../hooks/usePageTitle";
import { useTranslation } from "react-i18next";
import { DASHBOARD_LANGUAGES, normalizeDashboardLanguage, setDashboardLanguage, type DashboardLanguage } from "../i18n";
import { resolveEffectiveAgentProvider } from "../utils/providerSelection";
import {
  globalHelperCapabilityInventory,
  helperCapabilityKind,
  helperCapabilityLabel,
} from "../utils/helperCapabilities";

interface Key {
  id: number;
  name: string;
  key_prefix: string;
  kind?: "private" | "public_client";
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


type Tab = "projects" | "helper" | "appearance" | "channels" | "providers" | "mcp" | "subscriptions" | "api-keys" | "data" | "account" | "server" | "users";

// GlobeIcon — Lucide-style outline glyph used for "global" provider
// scope. Inherits color via currentColor; sized to sit inline next to
// 10px text without nudging the line height.
function GlobeIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    requestedTab && ["projects", "helper", "appearance", "channels", "providers", "mcp", "subscriptions", "api-keys", "data", "account", "server", "users"].includes(requestedTab)
      ? requestedTab
      : "projects",
  );
  const { user } = useAuth();
  const { t } = useTranslation();
  // Multi-user: Users tab is admin-only. Non-admins still get every
  // other tab; just hides the platform-wide user management surface.
  const isAdmin = !!user && user.role === "admin";

  const tabs: { id: Tab; label: string }[] = [
    { id: "projects", label: t("settings.tabs.projects") },
    { id: "helper", label: t("settings.tabs.helper") },
    { id: "appearance", label: t("settings.tabs.appearance") },
    { id: "channels", label: t("settings.tabs.channels") },
    { id: "providers", label: t("settings.tabs.providers") },
    { id: "mcp", label: t("settings.tabs.mcp") },
    { id: "subscriptions", label: t("settings.tabs.subscriptions") },
    { id: "api-keys", label: t("settings.tabs.apiKeys") },
    { id: "data", label: t("settings.tabs.data") },
    { id: "server", label: t("settings.tabs.server") },
    { id: "account", label: t("settings.tabs.account") },
    ...(isAdmin ? [{ id: "users" as Tab, label: t("settings.tabs.users") }] : []),
  ];
  const activeTab = tabs.find((t) => t.id === tab);
  usePageTitle([t("settings.title"), activeTab?.label || t("settings.tabs.projects")]);
  const selectTab = (next: Tab) => {
    setTab(next);
    setSearchParams(next === "projects" ? {} : { tab: next }, { replace: true });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-text text-lg font-bold">{t("settings.title")}</h1>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border px-4 py-3 sm:hidden">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-text-dim">Section</span>
          <select
            value={tab}
            onChange={(event) => selectTab(event.target.value as Tab)}
            className="min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 text-base text-text focus:border-accent focus:outline-none"
            aria-label="Settings section"
          >
            {tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className="settings-tabs-scroll hidden overflow-x-auto border-b border-border px-6 sm:flex gap-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={`whitespace-nowrap px-5 py-3 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "text-accent border-accent"
                : "text-text-muted border-transparent hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="page-safe-bottom flex-1 overflow-y-auto p-4 sm:p-6">
        {tab === "projects" && <ProjectsTab />}
        {tab === "helper" && <HelperTab />}
        {tab === "appearance" && <AppearanceTab />}
        {tab === "channels" && <ChannelsTab />}
        {tab === "providers" && <ProvidersTab />}
        {tab === "mcp" && <MCPServersTab />}
        {tab === "subscriptions" && <SubscriptionsTab />}
        {tab === "api-keys" && <APIKeysTab />}
        {tab === "data" && <DataTab />}
        {tab === "server" && <ServerTab />}
        {tab === "account" && <AccountTab />}
        {tab === "users" && isAdmin && <UsersTab />}
      </div>
    </div>
  );
}

// ─── Appearance Tab ───
//
// Theme picks the identity (font family, radii, accent character).
// Mode picks the surface palette (dark, light, or "auto" which
// follows the OS prefers-color-scheme). The two are independent —
// e.g. Clean + Auto means "use clean's palette, dark or light per
// OS." Live preview happens because both controls drive the same
// CSS variables that every utility class reads.

function AppearanceTab() {
  const { theme, mode, resolvedMode, setTheme, setMode } = useTheme();
  const { user, refresh } = useAuth();
  const { t, i18n } = useTranslation();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageMessage, setLanguageMessage] = useState<string | null>(null);
  const currentLanguage = normalizeDashboardLanguage(i18n.resolvedLanguage || i18n.language);

  async function chooseLanguage(language: DashboardLanguage) {
    const previous = currentLanguage;
    setSavingLanguage(true);
    setLanguageMessage(null);
    await setDashboardLanguage(language);
    try {
      await auth.updatePreferences({ language });
      await refresh();
      setLanguageMessage(i18n.t("settings.appearance.languageSaved"));
    } catch {
      await setDashboardLanguage(previous);
      setLanguageMessage(i18n.t("settings.appearance.languageSaveFailed"));
    } finally {
      setSavingLanguage(false);
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <h2 className="text-text font-medium mb-1">{t("settings.appearance.title")}</h2>
        <p className="text-text-muted text-sm">
          {t("settings.appearance.description")}
        </p>
      </div>

      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">{t("settings.appearance.theme")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <ThemeCard
            value="terminal"
            label={t("settings.appearance.themeTerminal")}
            description={t("settings.appearance.themeTerminalDescription")}
            selected={theme === "terminal"}
            onSelect={() => setTheme("terminal")}
          />
          <ThemeCard
            value="clean"
            label={t("settings.appearance.themeClean")}
            description={t("settings.appearance.themeCleanDescription")}
            selected={theme === "clean"}
            onSelect={() => setTheme("clean")}
          />
        </div>
      </section>

      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">{t("settings.appearance.mode")}</h3>
        <div className="flex flex-wrap gap-2">
          {(["auto", "dark", "light"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                mode === m
                  ? "border-accent text-text bg-bg-card"
                  : "border-border text-text-muted hover:text-text hover:border-text-dim"
              }`}
            >
              {m === "auto"
                ? t("settings.appearance.modeAuto")
                : m === "dark"
                  ? t("settings.appearance.modeDark")
                  : t("settings.appearance.modeLight")}
              {m === "auto" && (
                <span className="ml-2 text-text-dim text-xs">
                  ({t("settings.appearance.currently")} {resolvedMode})
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-text-dim text-xs mt-2">
          {t("settings.appearance.autoModeHint")}
        </p>
      </section>

      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">{t("settings.appearance.language")}</h3>
        <div className="flex flex-wrap gap-2">
          {DASHBOARD_LANGUAGES.map((language) => (
            <button
              key={language}
              onClick={() => chooseLanguage(language)}
              disabled={savingLanguage || user === false}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                currentLanguage === language
                  ? "border-accent text-text bg-bg-card"
                  : "border-border text-text-muted hover:text-text hover:border-text-dim"
              } disabled:opacity-60`}
            >
              {t(`language.${language}`)}
            </button>
          ))}
        </div>
        <p className="text-text-dim text-xs mt-2">{t("settings.appearance.languageDescription")}</p>
        {languageMessage && (
          <p className="text-text-muted text-xs mt-2">{languageMessage}</p>
        )}
      </section>
    </div>
  );
}

function ThemeCard({
  value,
  label,
  description,
  selected,
  onSelect,
}: {
  value: ThemeName;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  void value;
  return (
    <button
      onClick={onSelect}
      className={`text-left border rounded-lg p-4 transition-colors ${
        selected
          ? "border-accent bg-bg-card"
          : "border-border hover:border-text-dim"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 rounded-full border ${
            selected ? "bg-accent border-accent" : "border-border"
          }`}
        />
        <span className="text-text font-medium">{label}</span>
      </div>
      <p className="text-text-muted text-xs leading-relaxed">{description}</p>
    </button>
  );
}

// ─── Channels Tab ───

function ChannelsTab() {
  const { currentProject } = useProjects();
  const [instanceList, setInstanceList] = useState<Agent[]>([]);
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
    if (!selectedInstance) { setError("Select an agent"); return; }
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
            {/* Agent picker */}
            <div>
              <label className="text-text-muted text-xs font-bold uppercase tracking-wide block mb-1">Agent</label>
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


// ─── Providers Tab ───

type HelperModelTier = "large" | "medium" | "small";
type HelperModelMapping = Record<HelperModelTier, string>;

const EMPTY_HELPER_MODELS: HelperModelMapping = { large: "", medium: "", small: "" };
const TEXT_PROVIDER_KEYS = new Set(["fireworks", "openai", "openai-codex", "anthropic", "google", "ollama", "nvidia", "opencode-go", "venice", "xai"]);

function runtimeProviderKey(provider: Pick<Provider, "type" | "name">): string {
  const raw = provider.type === "llm" ? provider.name : provider.type;
  return raw.toLowerCase().trim().replace(/\s+/g, "-");
}

function isTextProvider(provider: Provider): boolean {
  return provider.type === "llm" || TEXT_PROVIDER_KEYS.has(runtimeProviderKey(provider));
}

function HelperTab() {
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const textProviders = providerList
    .filter(isTextProvider)
    .filter((provider, index, rows) => rows.findIndex((row) => runtimeProviderKey(row) === runtimeProviderKey(provider)) === index);
  const [helper, setHelper] = useState<Agent | null>(null);
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
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesSaving, setCapabilitiesSaving] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState("");
  const [capabilitiesNotice, setCapabilitiesNotice] = useState("");

  const providerSignature = textProviders
    .map((provider) => `${provider.id}:${runtimeProviderKey(provider)}`)
    .join("|");

  useEffect(() => {
    providers.list().then(setProviderList).catch((err: any) => setError(err?.message || "Unable to load text providers."));
  }, []);

  useEffect(() => {
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
        setSelectedCapabilityIDs(state.selected_mcp_server_ids || []);
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
  }, []);

  const savedModelOverride = useCallback((agent: Agent, providerName: string) => {
    try {
      const parsed = JSON.parse(agent.config || "{}");
      const override = parsed?.model_override;
      return runtimeProviderKey({ type: String(override?.provider || ""), name: "" }) === providerName
        ? String(override?.model || "")
        : "";
    } catch {
      return "";
    }
  }, []);

  const applyRuntimeConfig = useCallback((agent: Agent, config: Awaited<ReturnType<typeof core.config>>) => {
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
    platformHelper.get()
      .then(async (agent) => {
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
  }, [providerSignature, applyRuntimeConfig]);

  const selectedProviderRow = textProviders.find((provider) => runtimeProviderKey(provider) === selectedProvider) || null;

  useEffect(() => {
    let cancelled = false;
    setCatalog([]);
    if (!selectedProviderRow) return () => { cancelled = true; };
    setLoadingModels(true);
    const loadModels = async () => {
      try {
        const nextCatalog = await providers.models(selectedProviderRow.id);
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
        providers: textProviders.map((provider) => ({
          name: runtimeProviderKey(provider),
          default: runtimeProviderKey(provider) === selectedProvider,
        })),
        modelOverride: selectedModel,
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
    setSelectedCapabilityIDs((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
    setCapabilitiesNotice("");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h2 className="text-base font-bold text-text">Helper</h2>
        <p className="mt-1 text-sm text-text-muted">Configure the Apteva Helper used for Build conversations and dashboard assistance.</p>
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
          {!loading && helper && <div className="rounded-md bg-bg-hover px-2.5 py-1.5 text-[10px] text-text-muted">Current: <span className="font-semibold text-text">{runtimeProvider || "unknown"}</span> · {runtimeModelSummary}</div>}
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
                  {textProviders.map((provider) => <option key={provider.id} value={runtimeProviderKey(provider)}>{provider.name}{provider.project_id ? " · project" : " · global"}</option>)}
                </select>
              </label>

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
                {error && <span className="text-xs text-danger">{error}</span>}
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
            {["Apteva control", "Channels", "Environments"].map((name) => (
              <div key={name} className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-hover px-3 py-2">
                <span className="text-xs font-medium text-text">{name}</span>
                <span className="text-[9px] font-bold uppercase tracking-wide text-text-dim">required</span>
              </div>
            ))}
          </div>

          {capabilitiesLoading ? (
            <div className="text-xs text-text-dim">Loading global capabilities…</div>
          ) : capabilityInventory.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-text-muted">
              No global app or integration MCPs are available. Install or connect one globally,
              then return here to enable it for the Helper.
            </div>
          ) : (
            <div className="grid gap-2">
              {capabilityInventory.map((capability) => {
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
            {capabilitiesError && <span className="text-xs text-danger">{capabilitiesError}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProvidersTab() {
  const { currentProject } = useProjects();
  const { t } = useTranslation();
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [types, setTypes] = useState<ProviderTypeInfo[]>([]);
  const [configuring, setConfiguring] = useState<ProviderTypeInfo | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [authSession, setAuthSession] = useState<ProviderAuthStart | null>(null);
  const [authStatus, setAuthStatus] = useState<ProviderAuthStatus | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authPollTick, setAuthPollTick] = useState(0);
  const [error, setError] = useState("");
  // makeGlobal — when true, this provider is created with project_id=""
  // (visible across every project the user owns). When false, it's
  // scoped to currentProject. The list endpoint always returns the
  // union of project-scoped + globals, so a global created here will
  // immediately show up everywhere with the "global" scope badge.
  const [makeGlobal, setMakeGlobal] = useState(false);
  // Health-check state, keyed by provider id. Set when the operator
  // clicks "Test" on a row; rendered next to the row's controls.
  // testingProviderID is the id of the in-flight probe (one at a
  // time — the button disables to avoid double-fires).
  const [testResultByID, setTestResultByID] = useState<Record<number, import("../api").ProviderTestResult>>({});
  const [testingProviderID, setTestingProviderID] = useState<number | null>(null);
  const [usageByID, setUsageByID] = useState<Record<number, ProviderUsageSnapshot>>({});
  const [usageLoadingByID, setUsageLoadingByID] = useState<Record<number, boolean>>({});
  const [usageErrorByID, setUsageErrorByID] = useState<Record<number, string>>({});
  const [usageDetails, setUsageDetails] = useState<{ provider: Provider; usage: ProviderUsageSnapshot } | null>(null);

  const loadProviderUsage = useCallback(async (providerID: number, refresh = false) => {
    setUsageLoadingByID((current) => ({ ...current, [providerID]: true }));
    try {
      const usage = await providers.usage(providerID, refresh);
      setUsageByID((current) => ({ ...current, [providerID]: usage }));
      setUsageErrorByID((current) => {
        if (!current[providerID]) return current;
        const next = { ...current };
        delete next[providerID];
        return next;
      });
    } catch (err: any) {
      setUsageErrorByID((current) => ({
        ...current,
        [providerID]: err?.message || "Usage unavailable",
      }));
    } finally {
      setUsageLoadingByID((current) => ({ ...current, [providerID]: false }));
    }
  }, []);

  const handleTest = async (name: string) => {
    const p = getActive(name);
    if (!p) return;
    setTestingProviderID(p.id);
    try {
      const res = await providers.test(p.id);
      setTestResultByID((m) => ({ ...m, [p.id]: res }));
    } catch (err: any) {
      // request() throws on 4xx/5xx; for the test endpoint we still
      // want to surface the error inline, so build a synthetic failure
      // result from the thrown message.
      setTestResultByID((m) => ({
        ...m,
        [p.id]: { ok: false, latency_ms: 0, error: String(err?.message || "test failed") },
      }));
    } finally {
      setTestingProviderID(null);
    }
  };

  const load = () => {
    providers.list(currentProject?.id).then(setProviderList).catch(() => {});
    providerTypes.list().then(setTypes).catch(() => {});
  };
  useEffect(() => { load(); }, [currentProject?.id]);

  useEffect(() => {
    const supportedNames = new Set(
      types
        .filter((type) => type.capabilities?.includes("subscription_usage"))
        .map((type) => type.name),
    );
    const eligible = providerList.filter((provider) => supportedNames.has(provider.name));
    if (eligible.length === 0) return;

    const refreshEligible = () => {
      if (document.visibilityState !== "visible") return;
      eligible.forEach((provider) => void loadProviderUsage(provider.id));
    };
    refreshEligible();
    const interval = window.setInterval(refreshEligible, 5 * 60 * 1000);
    window.addEventListener("focus", refreshEligible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshEligible);
    };
  }, [providerList, types, loadProviderUsage]);

  const isActive = (name: string) => providerList.some((p) => p.name === name);
  const getActive = (name: string) => providerList.find((p) => p.name === name);

  // Resolve "where does this provider belong" — global when the
  // checkbox is set OR when no project is currently selected (no
  // project context to scope to). Otherwise, the current project.
  const targetProjectID = (): string =>
    makeGlobal || !currentProject ? "" : currentProject.id;

  const handleActivate = async (pt: ProviderTypeInfo) => {
    const authType = pt.auth_type || "api_key";
    if (!pt.requires_credentials || authType === "none") {
      // No credentials needed — activate immediately. Honour the
      // makeGlobal toggle too (it persists across credential-less
      // activations within this tab session).
      try {
        await providers.create(pt.type, pt.name, {}, pt.id, targetProjectID());
        load();
      } catch {}
      return;
    }
    if (authType === "oauth_device_code") {
      setConfiguring(pt);
      setFields({});
      setAuthSession(null);
      setAuthStatus(null);
      setMakeGlobal(false);
      setError("");
      return;
    }
    // Open credential form. Reset the toggle to project-scoped by
    // default — globals are an explicit opt-in per provider.
    setConfiguring(pt);
    setFields({});
    setAuthSession(null);
    setAuthStatus(null);
    setMakeGlobal(false);
    setError("");
  };

  const handleStartAuth = async () => {
    if (!configuring) return;
    setError("");
    setAuthBusy(true);
    try {
      const session = await providers.authStart(configuring.id, targetProjectID());
      setAuthSession(session);
      setAuthStatus({ status: "pending", next_poll_seconds: session.interval_seconds || 5 });
      setAuthPollTick(0);
    } catch (err: any) {
      setError(err?.message || "Failed to start authentication");
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    if (!authSession?.session_id || authStatus?.status !== "pending") return;
    let cancelled = false;
    const delay = Math.max(2, authStatus.next_poll_seconds || authSession.interval_seconds || 5) * 1000;
    const timer = window.setTimeout(async () => {
      try {
        const next = await providers.authPoll(authSession.session_id);
        if (cancelled) return;
        setAuthStatus(next);
        if (next.status === "connected") {
          setConfiguring(null);
          setAuthSession(null);
          setAuthStatus(null);
          setMakeGlobal(false);
          load();
        } else if (next.status === "pending") {
          setAuthPollTick((n) => n + 1);
        } else if (next.status === "expired" || next.status === "failed") {
          setError(next.error || `Authentication ${next.status}`);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Authentication check failed");
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authSession?.session_id, authStatus?.status, authStatus?.next_poll_seconds, authPollTick]);

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
      await providers.create(configuring.type, configuring.name, data, configuring.id, targetProjectID());
      setConfiguring(null);
      setFields({});
      setMakeGlobal(false);
      load();
    } catch (err: any) {
      // request() now unpacks the {error, status_code, …} body on 4xx
      // into err.message + err.body, so the upstream's reason ("Invalid
      // API key") lands directly here without per-caller JSON parsing.
      // err.body.status_code is set when the upstream returned a
      // ProviderTestResult — prefix it for context.
      const body = err?.body;
      if (body && body.status_code) {
        setError(`${body.status_code} — ${err.message || "Failed"}`);
      } else {
        setError(err?.message || "Failed");
      }
    }
  };

  const handleDeactivate = async (name: string) => {
    const p = getActive(name);
    if (p) {
      await providers.delete(p.id);
      load();
    }
  };

  const handleRefreshAuth = async (name: string) => {
    const p = getActive(name);
    if (!p) return;
    setTestingProviderID(p.id);
    try {
      const res = await providers.authRefresh(p.id);
      setTestResultByID((m) => ({
        ...m,
        [p.id]: {
          ok: res.auth_status === "connected",
          latency_ms: 0,
          error: res.error || (res.auth_status === "connected" ? "" : res.auth_status || "refresh failed"),
        },
      }));
    } catch (err: any) {
      setTestResultByID((m) => ({
        ...m,
        [p.id]: { ok: false, latency_ms: 0, error: err?.message || "refresh failed" },
      }));
    } finally {
      setTestingProviderID(null);
    }
  };

  const handleTestAuth = async (name: string) => {
    const p = getActive(name);
    if (!p) return;
    setTestingProviderID(p.id);
    try {
      const res = await providers.authSmokeTest(p.id);
      setTestResultByID((m) => ({ ...m, [p.id]: res }));
    } catch (err: any) {
      setTestResultByID((m) => ({
        ...m,
        [p.id]: { ok: false, latency_ms: 0, error: err?.message || "test failed" },
      }));
    } finally {
      setTestingProviderID(null);
    }
  };

  const handleLogoutAuth = async (name: string) => {
    const p = getActive(name);
    if (!p) return;
    await providers.authLogout(p.id);
    load();
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
    if ((t.runtime_status || "available") === "unsupported" && !isActive(t.name)) {
      continue;
    }
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
              Showing providers scoped to project <b>{currentProject.name}</b>{" "}
              plus any{" "}
              <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded bg-bg-hover text-text-muted text-[10px] align-middle">
                <GlobeIcon /> global
              </span>{" "}
              providers shared across all your projects. Tick{" "}
              <i>Make global</i> in the credential modal to share a key
              everywhere; otherwise it stays project-only.
            </>
          ) : (
            <> Without a selected project, new providers are unscoped — global by default.</>
          )}
        </p>
      </div>

      {Object.entries(groups).map(([groupType, items]) => (
        <section key={groupType}>
          <h3 className="text-text-muted text-sm font-bold mb-3 uppercase tracking-wide">
            {typeLabels[groupType] || groupType}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((pt) => {
              const activeProvider = getActive(pt.name);
              const active = !!activeProvider;
              const unsupported = (pt.runtime_status || "available") === "unsupported";
              const supportsUsage = !!pt.capabilities?.includes("subscription_usage");
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
                  <div className="flex items-center justify-between mb-1 gap-2 min-w-0">
                    <span className="text-text text-sm font-bold truncate">{pt.name}</span>
                    {active && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(() => {
                          const p = getActive(pt.name);
                          // Global vs project badges share the same
                          // shape/weight — only the leading glyph
                          // differentiates them, so they read as
                          // siblings instead of one shouting at you.
                          const isGlobal = !p?.project_id;
                          if (isGlobal) {
                            return (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted flex items-center gap-1"
                                title="Global — shared with every project. To make this project-only, deactivate then re-activate without checking 'Make global'."
                              >
                                <GlobeIcon />
                                global
                              </span>
                            );
                          }
                          return (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted"
                              title={`Scoped to project ${p?.project_id ?? ""}`}
                            >
                              project
                            </span>
                          );
                        })()}
                        {unsupported && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-dim"
                            title="Legacy provider — use Apps or Integrations for new browser automation."
                          >
                            legacy
                          </span>
                        )}
                        <span className="inline-block w-2 h-2 rounded-full bg-green" />
                      </div>
                    )}
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed mb-2">{pt.description}</p>
                  {active && supportsUsage && activeProvider ? (
                    <ProviderUsageSummary
                      usage={usageByID[activeProvider.id]}
                      loading={usageLoadingByID[activeProvider.id]}
                      refreshing={usageLoadingByID[activeProvider.id] && !!usageByID[activeProvider.id]}
                      error={usageErrorByID[activeProvider.id]}
                      onRefresh={() => void loadProviderUsage(activeProvider.id, true)}
                      onOpenDetails={() => {
                        const usage = usageByID[activeProvider.id];
                        if (usage) setUsageDetails({ provider: activeProvider, usage });
                      }}
                    />
                  ) : null}
                  {active ? (
                    <div className="flex items-center gap-3">
                      {(pt.auth_type || "api_key") === "api_key" ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTest(pt.name); }}
                          className="text-xs text-text-muted hover:text-accent transition-colors disabled:opacity-50"
                          disabled={testingProviderID === getActive(pt.name)?.id}
                          title="Probe the upstream with the saved credentials"
                        >
                          {testingProviderID === getActive(pt.name)?.id ? "Testing…" : "Test"}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleTestAuth(pt.name); }}
                            className="text-xs text-text-muted hover:text-accent transition-colors disabled:opacity-50"
                            disabled={testingProviderID === getActive(pt.name)?.id}
                            title="Probe the subscription-backed runtime with the saved auth"
                          >
                            {testingProviderID === getActive(pt.name)?.id ? "Testing…" : "Test"}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRefreshAuth(pt.name); }}
                            className="text-xs text-text-muted hover:text-accent transition-colors disabled:opacity-50"
                            disabled={testingProviderID === getActive(pt.name)?.id}
                          >
                            {testingProviderID === getActive(pt.name)?.id ? "Refreshing…" : "Refresh"}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLogoutAuth(pt.name); }}
                            className="text-xs text-text-muted hover:text-red transition-colors"
                          >
                            Logout
                          </button>
                        </>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeactivate(pt.name); }}
                        className="text-xs text-text-muted hover:text-red transition-colors"
                      >
                        Deactivate
                      </button>
                      {testResultByID[getActive(pt.name)?.id ?? -1] && (
                        <span
                          className={`text-xs ${testResultByID[getActive(pt.name)?.id ?? -1]?.ok ? "text-green" : "text-red"}`}
                          title={testResultByID[getActive(pt.name)?.id ?? -1]?.error || ""}
                        >
                          {testResultByID[getActive(pt.name)?.id ?? -1]?.ok
                            ? `✓ ${testResultByID[getActive(pt.name)?.id ?? -1]?.model_count
                                ? `${testResultByID[getActive(pt.name)?.id ?? -1]?.model_count} models`
                                : "ok"} (${testResultByID[getActive(pt.name)?.id ?? -1]?.latency_ms}ms)`
                            : `✗ ${testResultByID[getActive(pt.name)?.id ?? -1]?.error || "failed"}`}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-accent">
                      {(pt.auth_type || "api_key") === "oauth_device_code" ? "Connect" : pt.requires_credentials ? "Configure" : "Activate"}
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
        {configuring && (configuring.auth_type || "api_key") === "oauth_device_code" ? (
          <div className="p-6 space-y-4">
            <h3 className="text-text text-base font-bold">{configuring.name}</h3>
            <p className="text-text-muted text-sm">{configuring.description}</p>

            {currentProject && !authSession && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={makeGlobal}
                  onChange={(e) => setMakeGlobal(e.target.checked)}
                  className="mt-1 accent-accent"
                />
                <span className="text-sm text-text-muted leading-snug">
                  <span className="text-text">Make global</span> — share this sign-in with every project, not just <b>{currentProject.name}</b>.
                </span>
              </label>
            )}

            {authSession ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-bg-hover p-4">
                  <div className="text-xs uppercase text-text-muted mb-1">Code</div>
                  <div className="text-text text-2xl font-bold tracking-wide">{authSession.user_code}</div>
                </div>
                {authSession.verification_uri && (
                  <a
                    href={authSession.verification_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm text-accent hover:text-accent-hover"
                  >
                    Open sign-in page
                  </a>
                )}
                <div className="text-sm text-text-muted">
                  {authStatus?.status === "pending" ? "Waiting for authorization…" : authStatus?.status}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartAuth}
                disabled={authBusy}
                className="w-full px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {authBusy ? "Starting…" : "Connect"}
              </button>
            )}

            {configuring.runtime_status === "auth_only" && (
              <div className="text-xs text-text-muted bg-bg-hover border border-border rounded-lg p-3">
                This sign-in can be saved now. Agent runtime support will be enabled separately.
              </div>
            )}

            {error && <div className="text-red text-sm">{error}</div>}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setConfiguring(null)}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : configuring && (
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

            {/* Scope toggle. Default off (project-scoped). When on, the
                provider is created with project_id="" — visible to every
                project the user owns. Useful for personal LLM / API keys
                you don't want to re-enter per project. */}
            {currentProject && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={makeGlobal}
                  onChange={(e) => setMakeGlobal(e.target.checked)}
                  className="mt-1 accent-accent"
                />
                <span className="text-sm text-text-muted leading-snug">
                  <span className="text-text">Make global</span> — share these credentials with every project, not just <b>{currentProject.name}</b>.
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
                Activate
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
                <h3 className="text-text text-base font-bold">{t("settings.providers.usageDetails")}</h3>
                <p className="text-xs text-text-muted mt-1">
                  {usageDetails.provider.name}
                  {usageDetails.usage.plan ? ` · ${usageDetails.usage.plan}` : ""}
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
  const [addTab, setAddTab] = useState<"managed" | "scratch" | "connection">("managed");
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
    setRenameMCPText(s.description || s.name);
    setRenameMCPErr("");
  };
  const submitRenameMCP = async () => {
    if (!renameMCP) return;
    const next = renameMCPText.trim();
    if (!next || next === (renameMCP.description || renameMCP.name)) { setRenameMCP(null); return; }
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
      setError(err.message || "Failed to start");
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
      setError(`Failed to load tool list: ${err.message || err}`);
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
      // upstream server with the new action set. Await it so upstream
      // PATCH failures surface to the user instead of a silent mismatch
      // between what the dashboard shows and what the hosted MCP exposes.
      if (
        scopeModal.server.source === "remote" &&
        scopeModal.server.provider_id
      ) {
        await integrations.composioReconcile(
          scopeModal.server.provider_id,
          currentProject?.id,
        );
      }
      // Refresh cached tool list + allowed_tools for this row.
      setAllowedTools((prev) => ({ ...prev, [scopeModal.server.id]: allowed }));
      setScopeModal(null);
      load();
    } catch (err: any) {
      setError(`Save failed: ${err.message || err}`);
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
                yet. Click Sync to create (or refresh) the per-toolkit
                Composio MCP rows for this project.
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
            setAddTab("managed");
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
          {/* Tabs: managed code, legacy local command, or an existing connection */}
          <div className="flex gap-0 border-b border-border -mx-5 px-5">
            <button
              type="button"
              onClick={() => { setAddTab("managed"); setError(""); }}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                addTab === "managed"
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              Custom code
            </button>
            <button
              type="button"
              onClick={() => { setAddTab("scratch"); setError(""); }}
              className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
                addTab === "scratch"
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text"
              }`}
            >
              Local command
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

          {addTab === "managed" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-bg-input p-4">
                <div className="text-sm text-text font-bold">Managed custom MCP</div>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                  Define tool schemas and JavaScript handlers in the dashboard. Each server runs in a separate process and can call only the project apps and integrations you explicitly bind.
                </p>
              </div>
              {!currentProject?.id ? (
                <p className="text-sm text-red">Select a project before creating a custom MCP server.</p>
              ) : (
                <Link
                  to="/mcp-servers/new"
                  className="inline-flex px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
                >
                  Open MCP builder
                </Link>
              )}
              <button
                type="button"
                onClick={() => { setShowAdd(false); setError(""); }}
                className="ml-3 px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

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
                      ? "bg-warn"
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
                {s.source === "app" && (
                  <span className="text-xs px-2 py-0.5 rounded bg-bg-hover text-text-dim">app</span>
                )}
                {s.source === "managed" && (
                  <span className="text-xs px-2 py-0.5 rounded bg-accent/15 text-accent">custom code</span>
                )}
                <span className="text-xs px-2 py-0.5 rounded bg-bg-hover text-text-dim">
                  {s.project_id ? "project" : "global"}
                </span>
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
                {((s.source === "local" && s.connection_id > 0) ||
                  s.source === "remote" ||
                  s.source === "custom" ||
                  s.source === "managed") && (
                    <button
                      onClick={() => openScopeModal(s)}
                      className="text-sm text-text-muted hover:text-accent transition-colors"
                      title="Select which tools are exposed by this MCP server"
                    >
                      Scope
                    </button>
                  )}
                {(s.source === "custom" || s.source === "managed") && s.status === "running" && (
                  <button onClick={() => handleStop(s.id)}
                    className="text-sm text-text-muted hover:text-red transition-colors">
                    Stop
                  </button>
                )}
                {(s.source === "custom" || s.source === "managed") && s.status !== "running" && (
                  <button onClick={() => handleStart(s.id)}
                    className="text-sm text-accent hover:text-accent-hover transition-colors">
                    Start
                  </button>
                )}
                {s.source === "managed" && (
                  <Link
                    to={`/mcp-servers/${s.id}`}
                    className="text-sm text-accent hover:text-accent-hover transition-colors"
                  >
                    Edit
                  </Link>
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
            {s.command && s.source !== "managed" && (
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
                      s.source === "app" ||
                      ((s.source === "custom" || s.source === "managed") && s.status === "running");
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
                        result = await mcpServers.callTool(srv.id, testingTool.tool.name, input, currentProject?.id);
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
        <div className="p-4 sm:p-6 w-full max-w-[480px] space-y-3">
          <h2 className="text-text text-base font-bold">Rename MCP server</h2>
          <p className="text-text-dim text-xs leading-snug">
            Changes the display name only. The underlying slug
            {renameMCP && (
              <> — <code className="text-text-muted">{renameMCP.name}</code> — </>
            )}
            stays the same, so agents that reference this server keep
            working.
          </p>
          <input
            value={renameMCPText}
            onChange={(e) => setRenameMCPText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitRenameMCP(); }}
            autoFocus
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
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
              disabled={renameMCPBusy || !renameMCPText.trim() || renameMCPText.trim() === (renameMCP?.description || renameMCP?.name)}
              className="px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {renameMCPBusy ? "Saving…" : "Rename"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!scopeModal} onClose={() => setScopeModal(null)}>
        {scopeModal && (
          <div className="p-4 sm:p-6 flex flex-col max-h-[80vh] w-full max-w-[560px]">
            <div className="shrink-0 mb-4">
              <h3 className="text-text text-base font-bold">
                Tool scope: {scopeModal.server.name}
              </h3>
              <p className="text-text-muted text-sm mt-1">
                Pick which tools this MCP server exposes. Only the ticked
                tools are visible to instances that attach this server.
                Tick every tool (Select all) to clear the filter and expose
                the whole catalog.
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
  const [instanceList, setInstanceList] = useState<Agent[]>([]);
  // Unified add flow:
  //   pickerOpen=true, adding=null  → modal shows the source picker
  //   pickerOpen=*,    adding=...   → modal shows the configure form
  //   both falsy                    → modal closed
  // Source tagged union covers app-event subscriptions + the two
  // existing webhook flavors (local + composio).
  type AddSource =
    | { kind: "app"; appName: string; appLabel: string; scope: "project" | "global" }
    | { kind: "webhook"; conn: any }
    | { kind: "composio"; conn: any };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [adding, setAdding] = useState<AddSource | null>(null);
  const [appsList, setAppsList] = useState<AppRow[]>([]);
  // For app-event subscriptions: free-text topic pattern (e.g. "row.*",
  // "table.created", "*"). The slug sent to the server is composed as
  // `${appName}:${topicPattern}`. Kept for the single-topic fallback
  // path when the app declares no publishes — otherwise the form
  // routes through selectedTopics (multi-select).
  const [topicPattern, setTopicPattern] = useState("*");
  // Multi-select state for the rich app-event picker. Empty = nothing
  // selected (Subscribe button disabled). The `*` sentinel is one of
  // the regular checkbox entries and lives in this set when chosen.
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  // Search filter for the event list, plus a free-text "custom topic"
  // composer that lets the operator add a pattern not declared by the
  // app (e.g. "row.*" when the app declared exact topics, or any
  // pattern for apps with no declared publishes at all).
  const [topicFilter, setTopicFilter] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  // Topics the operator added by hand via the "+ Custom topic" path
  // — kept separate from app.publishes so the checkbox list shows
  // them as the operator-authored extras they are.
  const [customTopics, setCustomTopics] = useState<string[]>([]);
  const [instanceId, setInstanceId] = useState(0);
  const [description, setDescription] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [notifyAgent, setNotifyAgent] = useState(false);
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
    // Installed apps (project-scoped + globals) for the app-event
    // subscription picker. Only running rows show up — a stopped
    // sidecar can't emit anyway.
    appsAPI.list(currentProject.id).then((rs) => {
      setAppsList((rs || []).filter((r) => r.status === "running"));
    }).catch(() => setAppsList([]));
  };

  const closeAddFlow = () => {
    setPickerOpen(false);
    setAdding(null);
    setPickerSearch("");
    setTopicPattern("*");
    setSelectedTopics(new Set());
    setTopicFilter("");
    setCustomTopic("");
    setCustomTopics([]);
    setInstanceId(0);
    setDescription("");
    setHmacSecret("");
    setNotifyAgent(false);
    setSelectedEvents(new Set());
    setSelectedTrigger("");
    setTriggerConfig({});
    setComposioTriggers([]);
    setError("");
  };
  useEffect(() => { load(); }, [currentProject?.id]);

  const safeConns = connections || [];

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
    if (adding.kind !== "composio") {
      setComposioTriggers([]);
      return;
    }
    setLoadingTriggers(true);
    integrations
      .triggers(adding.conn.id)
      .then((resp) => {
        setComposioTriggers(resp.triggers || []);
        if ((resp.triggers || []).length > 0) {
          setSelectedTrigger(resp.triggers[0].slug);
          setTriggerConfig({});
        }
      })
      .catch(() => setComposioTriggers([]))
      .finally(() => setLoadingTriggers(false));
  }, [adding?.kind === "composio" ? adding.conn.id : null]);

  // Currently-selected trigger's config schema — used by the dynamic
  // form renderer inside the modal.
  const selectedTriggerSchema = composioTriggers.find((t) => t.slug === selectedTrigger);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!adding || !instanceId) { setError("Select an agent"); return; }

    try {
      if (adding.kind === "app") {
        // Multi-select: one subscription row carries every checked
        // topic in events[], matching webhook subscription semantics.
        // We fall back to topicPattern when the operator uses the
        // single free-text path for apps that declare no events.
        const topics = selectedTopics.size > 0
          ? Array.from(selectedTopics)
          : [topicPattern.trim() || "*"];
        const uniqueTopics = Array.from(new Set(topics.map((t) => t.trim()).filter(Boolean)));
        const label = uniqueTopics.length === 1
          ? (uniqueTopics[0] === "*" ? "events" : uniqueTopics[0])
          : `${uniqueTopics.length} events`;
        await subscriptions.create(
          `${adding.appLabel} ${label}`,
          `${adding.appName}:*`,
          instanceId,
          {
            description: description.trim(),
            events: uniqueTopics.length > 0 ? uniqueTopics : ["*"],
            projectId: currentProject?.id,
            source: "app_event",
            notifyAgent,
          },
        );
      } else if (adding.kind === "composio") {
        if (!selectedTrigger) { setError("Select a trigger"); return; }
        await subscriptions.create(
          `${adding.conn.app_name} trigger`,
          adding.conn.app_slug,
          instanceId,
          {
            connectionId: adding.conn.id,
            description: description.trim(),
            events: [selectedTrigger],
            projectId: currentProject?.id,
            triggerSlug: selectedTrigger,
            triggerConfig,
            notifyAgent,
          },
        );
      } else {
        // webhook
        await subscriptions.create(
          `${adding.conn.app_name} webhooks`,
          adding.conn.app_slug,
          instanceId,
          {
            connectionId: adding.conn.id,
            description: description.trim(),
            hmacSecret: hmacSecret.trim(),
            events: Array.from(selectedEvents),
            projectId: currentProject?.id,
            notifyAgent,
          },
        );
      }
      closeAddFlow();
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

      {/* Single entry point. Picker modal lists every subscribable
          source (installed apps + webhook-capable integrations +
          composio integrations) so the operator can browse them in
          one place rather than chasing two separate lists. */}
      <div className="flex justify-end">
        <button
          onClick={() => { closeAddFlow(); setPickerOpen(true); }}
          className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover"
        >
          + New Subscription
        </button>
      </div>

      {/* Unified add flow — picker phase OR configure phase */}
      <Modal open={pickerOpen || !!adding} onClose={closeAddFlow}>
        {pickerOpen && !adding && (() => {
          // Build the picker source list: installed apps + webhook-
          // capable integrations + composio integrations. One row per
          // option, search-filterable on label.
          const webhookConns = safeConns.filter((c: any) =>
            c.source !== "composio" && catalog[c.app_slug]?.has_webhooks,
          );
          const composioConns = safeConns.filter((c: any) => c.source === "composio");
          const q = pickerSearch.trim().toLowerCase();
          const matches = (s: string) => !q || s.toLowerCase().includes(q);
          const visibleApps = (appsList || []).filter((a) =>
            matches(a.display_name || a.name),
          );
          const visibleWebhook = webhookConns.filter((c: any) =>
            matches(c.app_name) || matches(c.name),
          );
          const visibleComposio = composioConns.filter((c: any) =>
            matches(c.app_name) || matches(c.name),
          );
          return (
            <div className="p-4 sm:p-6 w-full max-w-[640px] space-y-4">
              <div>
                <h3 className="text-text text-base font-bold">New subscription</h3>
                <p className="text-text-muted text-sm mt-1">
                  Pick a source to wake up an agent. Apps emit events from the
                  in-process bus; integrations forward external webhooks.
                </p>
              </div>
              <input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search apps and integrations…"
                autoFocus
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-2.5 text-sm text-text focus:outline-none focus:border-accent"
              />
              <div className="max-h-[420px] overflow-y-auto space-y-4">
                {visibleApps.length > 0 && (
                  <section>
                    <h4 className="text-text-muted text-xs font-bold uppercase tracking-wide mb-2">
                      Installed apps
                    </h4>
                    <div className="space-y-1">
                      {visibleApps.map((a) => {
                        const scope: "project" | "global" = a.project_id ? "project" : "global";
                        const label = a.display_name || a.name;
                        return (
                          <button
                            key={a.install_id}
                            onClick={() => {
                              setAdding({ kind: "app", appName: a.name, appLabel: label, scope });
                              setPickerOpen(false);
                              setTopicPattern("*");
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-bg-card text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-text text-sm font-medium truncate">{label}</span>
                              <span className="text-text-dim text-xs font-mono truncate">{a.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                {scope}
                              </span>
                            </div>
                            <span className="text-text-muted text-xs">app events →</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
                {visibleWebhook.length > 0 && (
                  <section>
                    <h4 className="text-text-muted text-xs font-bold uppercase tracking-wide mb-2">
                      Integrations (webhooks)
                    </h4>
                    <div className="space-y-1">
                      {visibleWebhook.map((c: any) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            const events = catalog[c.app_slug]?.webhook_events;
                            setAdding({ kind: "webhook", conn: c });
                            setSelectedEvents(events ? new Set(events.map((ev: any) => ev.name)) : new Set());
                            setPickerOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-bg-card text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-text text-sm font-medium truncate">{c.app_name}</span>
                            <span className="text-text-dim text-xs truncate">{c.name}</span>
                          </div>
                          <span className="text-text-muted text-xs">webhook →</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {visibleComposio.length > 0 && (
                  <section>
                    <h4 className="text-text-muted text-xs font-bold uppercase tracking-wide mb-2">
                      Integrations (composio)
                    </h4>
                    <div className="space-y-1">
                      {visibleComposio.map((c: any) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setAdding({ kind: "composio", conn: c });
                            setSelectedEvents(new Set());
                            setPickerOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-bg-card text-left"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-text text-sm font-medium truncate">{c.app_name}</span>
                            <span className="text-text-dim text-xs truncate">{c.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">
                              composio
                            </span>
                          </div>
                          <span className="text-text-muted text-xs">trigger →</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {visibleApps.length === 0 && visibleWebhook.length === 0 && visibleComposio.length === 0 && (
                  <p className="text-text-dim text-sm py-4 text-center">
                    {q ? "No matches." : "No subscribable apps or integrations yet. Install an app, or connect an integration first."}
                  </p>
                )}
              </div>
            </div>
          );
        })()}

        {adding && (
          <form onSubmit={handleSubscribe} className="p-4 sm:p-6 w-full max-w-[560px] space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-text text-base font-bold">
                  {adding.kind === "app"
                    ? `Subscribe to ${adding.appLabel}`
                    : `Subscribe to ${adding.conn.app_name}`}
                </h3>
                <p className="text-text-muted text-sm mt-1">
                  {adding.kind === "app"
                    ? "Wake the agent on app events emitted from this project's installed sidecar."
                    : adding.kind === "composio"
                    ? "Subscribe via Composio. The trigger config drives the upstream subscription."
                    : `Subscribe to ${adding.conn.app_name} events. The webhook is auto-registered upstream — no manual setup needed.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setAdding(null); setPickerOpen(true); }}
                className="text-text-muted text-xs hover:text-text shrink-0"
              >
                ← back
              </button>
            </div>

            <div>
              <label className="block text-text-muted text-sm mb-2">Target agent</label>
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
                placeholder="e.g. Wake on row inserts in the leads table"
              />
            </div>

            {adding.kind === "app" && (() => {
              // Look up the picked app's declared publishes from the
              // installed-apps list. Two render modes:
              //   - Declared (decls.length > 0): rich checkbox picker
              //     with search + a "+ Custom topic" composer. Operator
              //     can subscribe to many events at once; each becomes
              //     its own subscription row server-side.
              //   - No declarations: degrade to the legacy single
              //     free-text input. Apps that haven't updated their
              //     manifest still work, just without the picker.
              const app = appsList.find((a) => a.name === adding.appName);
              const decls = app?.publishes || [];

              // Combined list = declared + operator-added customs.
              // Customs are tagged so the render shows them differently
              // (with a remove × button).
              type Row = { name: string; description?: string; payload?: Record<string, string>; custom: boolean };
              const allRows: Row[] = [
                { name: "*", description: `Every event from ${adding.appName}`, custom: false },
                ...decls.map((d) => ({ name: d.name, description: d.description, payload: d.payload, custom: false })),
                ...customTopics.map((n) => ({ name: n, description: "Custom topic / pattern (operator-added)", custom: true })),
              ];

              const filter = topicFilter.trim().toLowerCase();
              const filtered = filter
                ? allRows.filter((r) => r.name.toLowerCase().includes(filter) || (r.description || "").toLowerCase().includes(filter))
                : allRows;

              const toggle = (name: string) => {
                setSelectedTopics((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  // Picking "*" cancels out every specific topic — they
                  // would all be subsumed and create useless duplicate
                  // subs. Picking a specific topic cancels "*" for the
                  // same reason.
                  if (name === "*" && next.has("*")) {
                    for (const k of Array.from(next)) if (k !== "*") next.delete(k);
                  } else if (name !== "*" && next.has(name)) {
                    next.delete("*");
                  }
                  return next;
                });
              };

              const addCustom = () => {
                const t = customTopic.trim();
                if (!t) return;
                if (!customTopics.includes(t) && !decls.find((d) => d.name === t) && t !== "*") {
                  setCustomTopics((prev) => [...prev, t]);
                }
                setSelectedTopics((prev) => {
                  const next = new Set(prev);
                  next.add(t);
                  // Cancel the everything-wildcard if the user
                  // started narrowing to specific patterns.
                  if (t !== "*") next.delete("*");
                  return next;
                });
                setCustomTopic("");
              };

              const removeCustom = (name: string) => {
                setCustomTopics((prev) => prev.filter((n) => n !== name));
                setSelectedTopics((prev) => { const next = new Set(prev); next.delete(name); return next; });
              };

              return (
                <div>
                  <label className="block text-text-muted text-sm mb-2">
                    Event(s) <span className="text-text-dim font-mono">{adding.appName}:</span>
                    {selectedTopics.size > 0 && (
                      <span className="ml-2 text-text-dim text-xs">
                        ({selectedTopics.size} selected)
                      </span>
                    )}
                  </label>

                  {decls.length === 0 ? (
                    // Legacy single-pattern fallback — apps that
                    // haven't declared events yet. Same UX as before
                    // multi-select landed.
                    <>
                      <input
                        value={topicPattern}
                        onChange={(e) => setTopicPattern(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
                        placeholder="e.g. row.* or table.created or *"
                      />
                      <p className="text-text-dim text-xs mt-1">
                        <span className="font-mono">*</span> matches everything; <span className="font-mono">prefix.*</span> matches by prefix; otherwise exact match.
                        <span className="text-text-dim"> {adding.appName} hasn't declared its events in its manifest — pattern is free-form.</span>
                      </p>
                    </>
                  ) : (
                    <>
                      {/* Search filter for the checkbox list. Useful
                          once an app declares 10+ events; for tiny
                          surfaces (media has 5) it's basically idle. */}
                      <input
                        value={topicFilter}
                        onChange={(e) => setTopicFilter(e.target.value)}
                        className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                        placeholder="Filter events…"
                      />

                      {/* Checkbox list. Each row: label, optional
                          description, optional payload hint, custom
                          rows get a remove × on the right. */}
                      <div className="mt-2 border border-border rounded-lg max-h-72 overflow-y-auto divide-y divide-border">
                        {filtered.length === 0 ? (
                          <div className="px-3 py-4 text-center text-text-dim text-xs">
                            No events match "{topicFilter}".
                          </div>
                        ) : filtered.map((r) => {
                          const checked = selectedTopics.has(r.name);
                          return (
                            <label
                              key={r.name}
                              className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-hover transition-colors ${checked ? "bg-accent/5" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(r.name)}
                                className="mt-1 shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-sm font-mono ${r.name === "*" ? "text-accent" : "text-text"}`}>
                                    {r.name}
                                  </span>
                                  {r.custom && (
                                    <span className="text-[10px] uppercase tracking-wide text-text-dim px-1 py-0.5 border border-border rounded">
                                      custom
                                    </span>
                                  )}
                                </div>
                                {r.description && (
                                  <div className="text-text-muted text-xs mt-0.5">{r.description}</div>
                                )}
                                {r.payload && (
                                  <div className="text-text-dim text-[11px] mt-1 font-mono">
                                    payload: {Object.entries(r.payload).map(([k, v]) => `${k}: ${v}`).join(", ")}
                                  </div>
                                )}
                              </div>
                              {r.custom && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); removeCustom(r.name); }}
                                  className="shrink-0 text-text-dim hover:text-red text-sm px-1"
                                  title="Remove this custom topic"
                                >
                                  ×
                                </button>
                              )}
                            </label>
                          );
                        })}
                      </div>

                      {/* Custom-topic composer — for patterns the app
                          didn't declare ("row.*", "*.failed", etc.). */}
                      <div className="mt-2 flex gap-2">
                        <input
                          value={customTopic}
                          onChange={(e) => setCustomTopic(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
                          className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
                          placeholder="+ Custom topic or pattern (e.g. row.*)"
                        />
                        <button
                          type="button"
                          onClick={addCustom}
                          disabled={!customTopic.trim()}
                          className="px-3 py-2 border border-border rounded-lg text-text-muted hover:text-accent text-xs transition-colors disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                      <p className="text-text-dim text-[11px] mt-1">
                        <span className="font-mono">*</span> matches everything;
                        <span className="font-mono"> prefix.*</span> matches by prefix; otherwise exact match.
                      </p>
                    </>
                  )}
                </div>
              );
            })()}

            {adding.kind === "composio" && (
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
                    <p className="text-text-dim text-sm">No triggers available for {adding.conn.app_slug} in Composio.</p>
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
                    <p className="text-warn text-[11px] mt-1">
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
            )}

            {adding.kind === "webhook" && (() => {
              // Local-source: use the catalog's webhook_events list.
              const events = catalog[adding.conn.app_slug]?.webhook_events;
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

            {adding.kind === "webhook" && (
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

            <label className="flex items-start gap-3 border border-border rounded-lg bg-bg-input px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyAgent}
                onChange={(e) => setNotifyAgent(e.target.checked)}
                className="mt-1 accent-accent"
              />
              <div>
                <div className="text-text text-sm">Tell the agent about this subscription</div>
                <p className="text-text-dim text-xs mt-0.5">
                  Optional agent context. The subscription stays active when this is unchecked.
                </p>
              </div>
            </label>

            {error && <div className="text-red text-sm">{error}</div>}

            <div className="flex justify-end gap-3">
              <button type="button" onClick={closeAddFlow}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding?.kind === "app" && (appsList.find((a) => a.name === adding.appName)?.publishes?.length ?? 0) > 0 && selectedTopics.size === 0}
                className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {adding?.kind === "app" && selectedTopics.size > 1
                  ? `Subscribe to ${selectedTopics.size} events`
                  : "Create Subscription"}
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
  const { projects, currentProject } = useProjects();
  const [keys, setKeys] = useState<Key[]>([]);
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

  const load = () => auth.listKeys().then(setKeys).catch(() => {});
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
        project_id?: string;
        scopes?: unknown;
        allowed_origins?: string[];
        rate_limit_per_minute?: number;
        expires_at?: string;
      } = { kind: keyKind };
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
          <p className="text-text-muted text-sm">
            Private keys keep the existing behavior: full server API access as your user. Do not put them in static sites.
          </p>
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
                    const canRenderIcon = app.icon && /^(https?:|data:|\/)/.test(app.icon);
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
                        <div className="h-9 w-9 rounded bg-bg-card border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {canRenderIcon ? (
                            <img src={app.icon} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs font-bold text-text-muted">
                              {(app.display_name || app.name).slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
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
            Save this {newKeyKind === "public_client" ? "scoped client" : "private"} key — it won't be shown again:
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
                <p className="text-text-muted text-sm mt-1">Full server API access</p>
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
// the public internet uses to reach this server (Google, GitHub, etc., for
// OAuth callbacks; webhook providers for delivery). Stored in
// server_settings table so it survives container redeploys and doesn't
// require a server restart to change.

function ServerTab() {
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold">Server</h2>
        <p className="text-text-muted text-sm mt-1">
          Server-wide settings that affect how this Apteva instance is reached
          from the public internet.
        </p>
      </div>

      <form onSubmit={handleSave} className="border border-border rounded-lg p-5 bg-bg-card space-y-4">
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

      {isAdmin && <form onSubmit={handleLifecycleSave} className="border border-border rounded-lg p-5 bg-bg-card space-y-5">
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

// ─── Account Tab ───

function AccountTab() {
  // Pull the authenticated profile straight from the auth hook —
  // /auth/me returns {user_id, email, created_at} on every page load
  // so we don't need our own fetch. Password-change modal state is
  // local: open → collect current/new/confirm → POST /auth/password.
  const { user, refresh } = useAuth();
  const [showPwd, setShowPwd] = useState(false);
  // Success banner state here so the page itself acknowledges the
  // change; the modal's own banner is short-lived.
  const [changed, setChanged] = useState(false);

  // Handle the "user is still null" transient first so the rest of the
  // render can assume a concrete profile.
  if (user === null) {
    return <p className="text-text-muted text-sm">Loading…</p>;
  }
  if (user === false) {
    return <p className="text-text-muted text-sm">Not signed in.</p>;
  }

  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "";

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Account</h2>
        <p className="text-text-muted text-sm mt-1">Manage your account settings.</p>
      </div>

      {/* Profile — email + user id + joined date. Small read-only
          card so the user always knows which account they're acting
          under without having to check the sidebar. */}
      <div className="border border-border rounded-lg p-5 bg-bg-card space-y-3">
        <h3 className="text-text text-sm font-bold">Profile</h3>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-4 text-sm">
          <dt className="text-text-muted">Email</dt>
          <dd className="text-text font-mono break-all">{user.email}</dd>
          <dt className="text-text-muted">User ID</dt>
          <dd className="text-text font-mono">#{user.id}</dd>
          {joined && (<>
            <dt className="text-text-muted">Joined</dt>
            <dd className="text-text-muted">{joined}</dd>
          </>)}
        </dl>
      </div>

      {/* Password — change via the same flow the sidebar AccountMenu
          uses. Other sessions get revoked; the current session stays
          alive. */}
      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <h3 className="text-text text-sm font-bold mb-3">Password</h3>
        <p className="text-text-muted text-sm mb-4">
          Change your password. All other active sessions will be
          signed out; this session stays logged in.
        </p>
        {changed && (
          <div className="mb-3 text-green text-xs bg-green/10 border border-green/30 rounded px-3 py-2">
            Password updated. Other sessions have been signed out.
          </div>
        )}
        <button
          onClick={() => setShowPwd(true)}
          className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-accent hover:border-accent transition-colors"
        >
          Change password
        </button>
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

      <AccountChangePasswordModal
        open={showPwd}
        onClose={() => setShowPwd(false)}
        onChanged={() => { setChanged(true); refresh(); }}
      />
    </div>
  );
}

// Inline password-change modal for the Account tab. Mirrors the
// sidebar ChangePasswordModal in AccountMenu but surfaces success
// back to the tab (via onChanged) so the page can render its own
// confirmation banner.
function AccountChangePasswordModal({
  open, onClose, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setErr(""); setBusy(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (next.length < 8) { setErr("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setErr("New password and confirmation don't match."); return; }
    if (next === current) { setErr("New password must differ from the current one."); return; }
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      onChanged();
      reset();
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }}>
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Change password</h3>
        <label className="block">
          <span className="text-text-muted">Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required autoFocus disabled={busy} />
        </label>
        <label className="block">
          <span className="text-text-muted">New password</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required disabled={busy} />
        </label>
        <label className="block">
          <span className="text-text-muted">Confirm new password</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required disabled={busy} />
        </label>
        {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => { reset(); onClose(); }} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
          <button type="submit" className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Modal>
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
  // Which project's Members modal is open. Null when closed.
  const [membersFor, setMembersFor] = useState<string | null>(null);

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
              <button onClick={() => setMembersFor(p.id)} className="text-xs text-text-muted hover:text-text transition-colors">
                Members
              </button>
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

      {/* Members modal — opens from a per-project "Members" button.
          Owners (and platform admins) get inline role-edit + remove +
          invite affordances; viewers and editors get a read-only
          listing. The modal owns its own data fetch so opening/closing
          doesn't perturb the surrounding ProjectsTab state. */}
      {membersFor && (
        <Modal open={!!membersFor} onClose={() => setMembersFor(null)}>
          <ProjectMembersPane
            projectID={membersFor}
            projectName={projects.find((p) => p.id === membersFor)?.name || ""}
            onClose={() => setMembersFor(null)}
          />
        </Modal>
      )}
    </div>
  );
}

// ProjectMembersPane — modal body for managing a single project's
// members + pending invites. Self-contained: owns its own data
// fetches, refreshes after every mutation.
function ProjectMembersPane({
  projectID,
  projectName,
  onClose,
}: {
  projectID: string;
  projectName: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = !!user && user.role === "admin";
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("editor");
  const [creatingInvite, setCreatingInvite] = useState(false);
  // Admin-only: full user roster fetched on modal open. Non-admins
  // can't (and shouldn't) see other users' emails — they stay on
  // the type-email-by-hand form.
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);

  // The caller's role on THIS project drives the can-edit gating. A
  // non-owner who somehow opens the modal sees a read-only view. Admins
  // are always treated as effective owners (matches server-side
  // requireProjectAccess short-circuit).
  const myRole: ProjectRole | null = user
    ? (members.find((m) => m.user_id === user.id)?.role
        || (user.role === "admin" ? "owner" : null))
    : null;
  const canManage = myRole === "owner";

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [m, i, u] = await Promise.all([
        projectMembers.list(projectID),
        projectInvites.list(projectID),
        // /admin/users is 403 for non-admins — swallow the error so
        // the rest of the modal still loads. Empty list means "no
        // picker, just the type-email form".
        isAdmin ? adminUsers.list().catch(() => [] as AdminUser[]) : Promise.resolve([] as AdminUser[]),
      ]);
      setMembers(m);
      setInvites(i);
      setAllUsers(u);
    } catch (e: any) {
      setErr(e?.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectID]);

  // Pickable = every user on the platform minus those already in
  // this project's members list. The picker hides itself entirely
  // when the set is empty (everyone's already in) or when the
  // caller isn't an admin.
  const memberIDs = new Set(members.map((m) => m.user_id));
  const pickable = allUsers.filter((u) => !memberIDs.has(u.id));

  // notice — short-lived confirmation banner after an invite action.
  // "added" path tells the operator the existing user is in now; the
  // "invited" path is silent because the new pending invite row
  // appears in the list above and is self-explanatory.
  const [notice, setNotice] = useState<string | null>(null);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setCreatingInvite(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await projectInvites.create(projectID, inviteEmail.trim(), inviteRole);
      if (res.kind === "added") {
        setNotice(`Added ${res.email} as ${res.role}.`);
      } else {
        setNotice(`Invite sent to ${res.invite.email}. Use "Copy link" if your mail isn't auto-delivered.`);
      }
      setInviteEmail("");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to create invite");
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/login?invite=${encodeURIComponent(token)}`;
    void navigator.clipboard.writeText(url).catch(() => {});
  };

  const changeRole = async (uid: number, role: ProjectRole) => {
    setErr(null);
    try {
      await projectMembers.updateRole(projectID, uid, role);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to update role");
    }
  };

  const removeMember = async (uid: number) => {
    setErr(null);
    try {
      await projectMembers.remove(projectID, uid);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to remove member");
    }
  };

  const revokeInvite = async (token: string) => {
    setErr(null);
    try {
      await projectInvites.revoke(projectID, token);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to revoke invite");
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-lg">
      <div>
        <h3 className="text-text text-base font-bold">Members of {projectName}</h3>
        <p className="text-text-muted text-xs mt-1">
          {canManage
            ? "Owners can change roles, remove members, and send invites."
            : "Read-only — only project owners can change membership."}
        </p>
      </div>

      {err && (
        <div className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
          {err}
        </div>
      )}
      {notice && (
        <div className="text-green text-xs bg-green/10 border border-green/30 rounded px-3 py-2">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-text text-sm truncate">{m.email}</div>
                  <div className="text-text-dim text-[11px]">User #{m.user_id}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && user && m.user_id !== user.id ? (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.user_id, e.target.value as ProjectRole)}
                        className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        onClick={() => removeMember(m.user_id)}
                        className="text-[11px] text-text-muted hover:text-red transition-colors"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-text-muted capitalize">{m.role}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {invites.length > 0 && (
            <div>
              <h4 className="text-text-muted text-xs uppercase tracking-wide mb-2">Pending invites</h4>
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 border border-dashed border-border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-text text-sm truncate">{inv.email}</div>
                      <div className="text-text-dim text-[11px] capitalize">
                        {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => copyInviteLink(inv.id)}
                          className="text-[11px] text-accent hover:text-accent-hover transition-colors"
                          title="Copy invite link to clipboard"
                        >
                          Copy link
                        </button>
                        <button
                          onClick={() => revokeInvite(inv.id)}
                          className="text-[11px] text-text-muted hover:text-red transition-colors"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canManage && pickable.length > 0 && (
            <div className="border-t border-border pt-4 space-y-2">
              <h4 className="text-text-muted text-xs uppercase tracking-wide">Add an existing user</h4>
              <div className="space-y-1.5">
                {pickable.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-1.5">
                    <div className="text-text text-sm truncate">{u.email}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        defaultValue="editor"
                        id={`role-${u.id}`}
                        className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        onClick={async () => {
                          const select = document.getElementById(`role-${u.id}`) as HTMLSelectElement | null;
                          const role = (select?.value || "editor") as ProjectRole;
                          setErr(null);
                          setNotice(null);
                          try {
                            await projectInvites.create(projectID, u.email, role);
                            setNotice(`Added ${u.email} as ${role}.`);
                            await load();
                          } catch (e: any) {
                            setErr(e?.message || "Failed to add user");
                          }
                        }}
                        className="text-[11px] text-accent hover:text-accent-hover transition-colors font-bold"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-text-dim text-[11px]">
                Existing accounts on this server. Pick a role and click <b>Add</b> — no invite link needed.
              </p>
            </div>
          )}

          {canManage && (
            <form onSubmit={submitInvite} className="border-t border-border pt-4 space-y-2">
              <h4 className="text-text-muted text-xs uppercase tracking-wide">{pickable.length > 0 ? "Invite someone new" : "Add or invite someone"}</h4>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                  required
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                  className="bg-bg-input border border-border rounded-lg px-2 py-2 text-xs text-text focus:outline-none focus:border-accent"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingInvite}
                  className="px-3 py-2 bg-accent text-bg rounded-lg text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {creatingInvite ? "…" : "Send"}
                </button>
              </div>
              <p className="text-text-dim text-[11px]">
                If the email already has an account on this server, they're added
                immediately. Otherwise an invite link is minted — click "Copy link"
                on the pending invite to send it.
              </p>
            </form>
          )}
        </>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 border border-border rounded-lg text-text-muted hover:text-text transition-colors text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// --- Users tab (admin-only) --------------------------------------------
//
// Table of every registered user with quick blast-radius counts,
// "+ Add user" to mint a new account with an initial password, per-row
// "Reset password" and "Delete" actions. Admin + self never get a
// delete button (server also blocks both). Rendered only when the
// calling user is the admin (user_id=1); the Settings tab is already
// hidden for non-admins.
function UsersTab() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const load = () => {
    usersAPI.list()
      .then((r) => { setRows(r || []); setLoaded(true); setErr(""); })
      .catch((e) => { setErr(e?.message || String(e)); setLoaded(true); });
  };

  useEffect(() => { load(); }, []);

  // toggleRole flips the user's platform role via /admin/users PATCH.
  // Server enforces the "at least one admin must remain" invariant
  // and refuses self-demotion, so we just surface errors inline.
  const toggleRole = async (u: UserRow) => {
    setErr("");
    try {
      await adminUsers.setRole(u.id, u.is_admin ? "user" : "admin");
      load();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text text-base font-bold">Users</h2>
          <p className="text-text-muted text-xs mt-1">
            Admin-only. Create additional accounts directly — no invite
            flow. Share the initial password over a trusted channel;
            the new user can change it from their own Account menu.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="touch-target shrink-0 px-3 py-1.5 bg-accent text-bg text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors"
        >
          + Add user
        </button>
      </div>

      {err && (
        <div className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
          {err}
        </div>
      )}

      {!loaded ? (
        <p className="text-text-muted text-xs">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-muted text-xs">No users yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="divide-y divide-border md:hidden">
            {rows.map((u) => (
              <article key={`mobile-${u.id}`} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-sm text-text">{u.email}</span>
                  {u.is_admin && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">admin</span>}
                  {u.is_self && !u.is_admin && <span className="rounded bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">you</span>}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[10px] uppercase tracking-wide text-text-dim">Created</dt><dd className="mt-0.5 text-text-muted">{fmtDate(u.created_at)}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wide text-text-dim">Owned</dt><dd className="mt-0.5 text-text-muted">{u.agents} agents · {u.keys} keys · {u.projects} projects</dd></div>
                </dl>
                <div className="grid grid-cols-2 gap-2">
                  {!u.is_self && <button type="button" onClick={() => toggleRole(u)} className="touch-target rounded-lg border border-border px-2 text-xs text-text-muted">{u.is_admin ? "Demote" : "Make admin"}</button>}
                  <button type="button" onClick={() => setResetTarget(u)} className="touch-target rounded-lg border border-border px-2 text-xs text-text-muted">Reset password</button>
                  {!u.is_admin && !u.is_self && <button type="button" onClick={() => setDeleteTarget(u)} className="touch-target rounded-lg border border-red/40 px-2 text-xs text-red">Delete</button>}
                </div>
              </article>
            ))}
          </div>
          <table className="hidden w-full text-xs md:table">
            <thead className="bg-bg-hover text-text-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-normal">Email</th>
                <th className="px-3 py-2 font-normal">Created</th>
                <th className="px-3 py-2 font-normal text-right">Agents</th>
                <th className="px-3 py-2 font-normal text-right">Keys</th>
                <th className="px-3 py-2 font-normal text-right">Projects</th>
                <th className="px-3 py-2 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-text">{u.email}</span>
                      {u.is_admin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent uppercase tracking-wide">admin</span>
                      )}
                      {u.is_self && !u.is_admin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-border text-text-muted uppercase tracking-wide">you</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{fmtDate(u.created_at)}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{u.agents}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{u.keys}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{u.projects}</td>
                  <td className="px-3 py-2 text-right">
                    {/* Role toggle. Hidden for self so an admin can't
                        accidentally demote themselves (server also
                        refuses). Promotes user → admin or demotes
                        admin → user via /admin/users PATCH. */}
                    {!u.is_self && (
                      <button
                        onClick={() => toggleRole(u)}
                        className="text-[10px] text-text-muted hover:text-accent transition-colors mr-3"
                        title={u.is_admin
                          ? "Demote to user — they keep their owned projects but lose platform-admin power"
                          : "Promote to admin — implicit owner on every project"}
                      >
                        {u.is_admin ? "Demote" : "Make admin"}
                      </button>
                    )}
                    <button
                      onClick={() => setResetTarget(u)}
                      className="text-[10px] text-text-muted hover:text-accent transition-colors mr-3"
                      title="Set a new password on behalf of this user"
                    >
                      Reset password
                    </button>
                    {!u.is_admin && !u.is_self && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="text-[10px] text-text-muted hover:text-red transition-colors"
                        title="Delete this user and everything they own"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserModal
        open={showAdd}
        onClose={() => { setShowAdd(false); load(); }}
      />
      <ResetPasswordModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
      <DeleteUserModal
        target={deleteTarget}
        onClose={() => { setDeleteTarget(null); load(); }}
      />
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState<{ email: string; password: string } | null>(null);

  const reset = () => {
    setEmail(""); setPassword(""); setConfirm(""); setErr(""); setOk(null); setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      await usersAPI.create(email.trim(), password);
      setOk({ email: email.trim(), password });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }}>
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Add user</h3>
        {ok ? (
          <div className="space-y-3">
            <div className="text-green text-[11px] bg-green/10 border border-green/30 rounded px-3 py-2">
              User <span className="font-mono">{ok.email}</span> created.
            </div>
            <div className="text-text-muted leading-relaxed">
              Share this password with the user over a trusted channel.
              It isn't stored anywhere we can show you again — if they
              lose it, use <em>Reset password</em>.
            </div>
            <div className="bg-bg-input border border-border rounded px-3 py-2 font-mono text-text break-all">
              {ok.password}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => { reset(); onClose(); }}
                className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-text-muted leading-relaxed">
              Creates a new user with the initial password you pick.
              They'll be able to change it themselves after first login.
            </p>
            <label className="block">
              <span className="text-text-muted">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
                required autoFocus disabled={busy}
              />
            </label>
            <label className="block">
              <span className="text-text-muted">Initial password</span>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
                required disabled={busy}
              />
            </label>
            <label className="block">
              <span className="text-text-muted">Confirm password</span>
              <input
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
                required disabled={busy}
              />
            </label>
            {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { reset(); onClose(); }} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
              <button type="submit" className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={busy}>
                {busy ? "Creating…" : "Create user"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ target, onClose }: { target: UserRow | null; onClose: () => void }) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (target) { setNext(""); setConfirm(""); setErr(""); setOk(false); setBusy(false); }
  }, [target]);

  if (!target) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (next.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (next !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      await usersAPI.resetPassword(target.id, next);
      setOk(true);
      setTimeout(onClose, 1500);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Reset password for {target.email}</h3>
        <p className="text-text-muted leading-relaxed">
          Sets a new password without needing the current one. Every
          active session for this user is signed out immediately.
        </p>
        <label className="block">
          <span className="text-text-muted">New password</span>
          <input type="text" value={next} onChange={(e) => setNext(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
            required autoFocus disabled={busy || ok}
          />
        </label>
        <label className="block">
          <span className="text-text-muted">Confirm</span>
          <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
            required disabled={busy || ok}
          />
        </label>
        {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
        {ok && <div className="text-green text-[11px] bg-green/10 border border-green/30 rounded px-2 py-1">Password reset. User signed out of all sessions.</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
          <button type="submit" className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={busy || ok}>
            {busy ? "Updating…" : "Reset password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUserModal({ target, onClose }: { target: UserRow | null; onClose: () => void }) {
  const [counts, setCounts] = useState<{ agents: number; keys: number; projects: number; providers: number; connections: number; mcp_servers: number; subscriptions: number; channels: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setCounts(null); setErr(""); setBusy(false);
    if (!target) return;
    usersAPI.preview(target.id)
      .then((r) => setCounts(r.would_delete))
      .catch((e) => setErr(e?.message || String(e)));
  }, [target]);

  if (!target) return null;

  const confirm = async () => {
    setBusy(true);
    setErr("");
    try {
      await usersAPI.remove(target.id);
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose}>
      <div className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Delete user {target.email}?</h3>
        <p className="text-text-muted leading-relaxed">
          Everything this user owns will be removed. Running cores are
          stopped first. This can't be undone.
        </p>
        {counts ? (
          <ul className="text-text-muted bg-bg-input border border-border rounded px-3 py-2 space-y-0.5">
            <li>Agents: <span className="text-text">{counts.agents}</span></li>
            <li>API keys: <span className="text-text">{counts.keys}</span></li>
            <li>Projects: <span className="text-text">{counts.projects}</span></li>
            <li>Providers: <span className="text-text">{counts.providers}</span></li>
            <li>Connections: <span className="text-text">{counts.connections}</span></li>
            <li>MCP servers: <span className="text-text">{counts.mcp_servers}</span></li>
            <li>Subscriptions: <span className="text-text">{counts.subscriptions}</span></li>
            <li>Channels: <span className="text-text">{counts.channels}</span></li>
          </ul>
        ) : (
          <p className="text-text-dim">Loading preview…</p>
        )}
        {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
          <button type="button" onClick={confirm} className="px-3 py-1.5 bg-red text-bg rounded-lg font-bold hover:bg-red/80 transition-colors disabled:opacity-50" disabled={busy || !counts}>
            {busy ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
