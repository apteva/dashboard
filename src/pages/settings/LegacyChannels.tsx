import { useState, useEffect } from "react";

import { channels, slack, email as emailAPI, instances as instancesAPI, type Agent, type ChannelInfo, type SlackChannelInfo } from "../../api";

import { Modal } from "../../components/Modal";

import { useProjects } from "../../hooks/useProjects";

export function ChannelsTab() {
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
