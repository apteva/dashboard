import { useState, useEffect } from "react";
import { core, mcpServers, type MCPServer, type MCPServerConfig } from "../api";
import { Modal } from "./Modal";
import { useProjects } from "../hooks/useProjects";

// Post-discovery-refactor (apteva/core@ea67eab) the MCP attach flow
// is plain: pick a server, it's attached. Every attached MCP is
// reachable from main via search_tools and the directive-fed
// preload; there's no per-attachment mode/access decision in the
// new model.
//
// System MCPs (gateway, channels) are server-injected and identified
// by name — rendered with a non-toggleable "system" badge to explain
// why detaching one is consequential (it disables the feature it
// provides). The no_spawn flag the server sets on those entries
// controls sub-thread visibility at the core level; not exposed in
// the UI because it's a host-managed property.

const SYSTEM_MCP_NAMES = new Set(["apteva-server", "channels", "apteva-channels"]);

interface Props {
  instanceId: number;
  running: boolean;
}

// MCPPanel shows the MCP servers currently wired into a running instance,
// with per-entry detach and a picker for attaching any MCP server from the
// current project's inventory. Renders nothing when the instance is stopped.
export function MCPPanel({ instanceId, running }: Props) {
  const { currentProject } = useProjects();
  const [attached, setAttached] = useState<MCPServerConfig[]>([]);
  const [inventory, setInventory] = useState<MCPServer[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sticky notice when a system MCP was just enabled on a running
  // instance — the flag takes effect only on the next Start(), so we
  // prompt the user to restart. Cleared when the modal is reopened or
  // the user restarts.
  const [restartNotice, setRestartNotice] = useState<string | null>(null);

  // MCP list comes from GET /config on the server. When the instance
  // is running this proxies to core; when stopped it falls back to
  // config.json via serveStoppedInstanceData. Either way we render
  // the same attached list so the user can still add/remove MCPs.
  // Polling is disabled while stopped — nothing will change on its
  // own there.
  const load = () => {
    core
      .config(instanceId)
      .then((c) => setAttached(c.mcp_servers || []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    if (!running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, running]);

  useEffect(() => {
    if (!picker) return;
    mcpServers
      .list(currentProject?.id)
      .then((rows) => setInventory(rows || []))
      .catch(() => setInventory([]));
  }, [picker, currentProject?.id]);

  // Render the panel for stopped instances too — add/remove still
  // works because the server persists to config.json and the agent
  // picks it up on next start.

  // For the picker we hide rows that are already attached, by name,
  // and rows that are clearly not wirable (no proxy_config).
  const attachedNames = new Set(attached.map((s) => s.name));
  const attachable = inventory.filter(
    (s) => !!s.proxy_config && !attachedNames.has(s.proxy_config.name),
  );
  // System MCPs are injected by the server at instance Start() based on
  // the include_apteva_server / include_channels flags — they aren't in
  // the project inventory. When one is missing from the attached list
  // we surface it here so the user can re-enable it without having to
  // recreate the instance. Name alias "apteva-channels" is kept in sync
  // with the server-side detection (instances.go:1329).
  const systemMCPMissing = [
    {
      name: "apteva-server" as const,
      label: "Apteva server (gateway)",
      hint: "Main gets the instance management tools (create instance, list threads, edit config).",
    },
    {
      name: "channels" as const,
      label: "Channels (chat bridge)",
      hint: "Outbound user-facing chat / Slack / email. Without this, the agent can't reply to channel messages.",
    },
  ].filter(
    (m) =>
      !attachedNames.has(m.name) &&
      !(m.name === "channels" && attachedNames.has("apteva-channels")),
  );

  const writeList = async (next: MCPServerConfig[]) => {
    setBusy(true);
    setError("");
    try {
      // include_system=true: the server honors our full list including
      // system entries. An absent system entry will be disconnected.
      await core.setMCPServers(instanceId, next, true);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to update MCP servers");
    } finally {
      setBusy(false);
    }
  };

  const handleEnableSystem = async (name: "apteva-server" | "channels", label: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await core.toggleSystemMCP(instanceId, name, true);
      if (res.restart_required) {
        setRestartNotice(
          `${label} will attach on the next restart. Stop and start the instance to apply.`,
        );
      }
      load();
    } catch (err: any) {
      setError(err?.message || `Failed to enable ${name}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAttach = async (row: MCPServer) => {
    if (!row.proxy_config) return;
    const entry: MCPServerConfig = {
      name: row.proxy_config.name,
      transport: row.proxy_config.transport,
      url: row.proxy_config.url,
      command: row.proxy_config.command,
      args: row.proxy_config.args,
    };
    await writeList([...attached, entry]);
  };

  const handleDetach = async (name: string) => {
    await writeList(attached.filter((s) => s.name !== name));
  };

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-text-muted font-bold uppercase tracking-wide text-[10px]">
          MCP Servers ({attached.length})
        </h3>
        <button
          onClick={() => setPicker(true)}
          disabled={busy}
          className="text-[10px] text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
        >
          + add
        </button>
      </div>

      {error && <div className="text-red text-[10px] mb-2">{error}</div>}
      {restartNotice && (
        <div className="flex items-start gap-1.5 text-[10px] mb-2 text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1.5">
          <span className="shrink-0">⚠</span>
          <span className="flex-1">{restartNotice}</span>
          <button
            onClick={() => setRestartNotice(null)}
            className="shrink-0 text-text-muted hover:text-text"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {attached.length === 0 ? (
        <div className="text-text-dim text-[10px]">
          None attached. Click + add to wire one from this project's inventory.
        </div>
      ) : (
        <div className="space-y-1">
          {attached.map((s) => {
            // System MCPs (gateway, channels) are server-injected,
            // identified by name. The badge is informational: it
            // explains why detaching one is consequential (kills the
            // feature it provides). User-attached MCPs are just
            // attached — no per-row knobs in the new model.
            const isSystem = SYSTEM_MCP_NAMES.has(s.name);
            return (
              <div key={s.name} className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.connected ? "bg-green" : "bg-text-dim"
                  }`}
                />
                <span className="text-text truncate flex-1">{s.name}</span>
                {isSystem && (
                  <span
                    className="text-[9px] px-1.5 py-[1px] rounded bg-blue/15 text-blue"
                    title="System MCP — injected at startup. Removing disables the feature it provides (e.g. channels controls the chat bridge)."
                  >
                    system
                  </span>
                )}
                <span className="text-text-dim text-[10px]">{s.transport || "stdio"}</span>
                <button
                  onClick={() => handleDetach(s.name)}
                  disabled={busy}
                  className="text-text-muted hover:text-red transition-colors disabled:opacity-50 text-[10px] px-1"
                  title={isSystem ? `Remove ${s.name} from this agent` : "Detach from this agent"}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Picker modal */}
      <Modal open={picker} onClose={() => setPicker(false)}>
        <div className="p-6 max-h-[70vh] flex flex-col min-w-[480px]">
          <div className="shrink-0 mb-4">
            <h3 className="text-text text-base font-bold">Attach MCP server</h3>
            <p className="text-text-muted text-sm mt-1">
              Pick one of the MCP servers registered in this project. The core
              connects it immediately — tools become discoverable via
              search_tools and the agent's directive-fed preload.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2">
            {/* System MCPs — apteva-server + channels. The server
                injects these at Start() based on the include_* flags.
                If they're not currently attached, expose an Enable
                button here so a user who opted out at creation (or
                detached later) can bring them back without recreating
                the instance. */}
            {systemMCPMissing.length > 0 && (
              <div className="border border-blue/30 rounded-lg p-3 bg-blue/5">
                <div className="text-[10px] text-blue uppercase tracking-wide font-bold mb-2">
                  System MCPs
                </div>
                <div className="space-y-2">
                  {systemMCPMissing.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => {
                        handleEnableSystem(m.name, m.label);
                      }}
                      disabled={busy}
                      className="w-full text-left border border-border bg-bg-card rounded-lg p-3 hover:border-blue transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <span className="text-blue">+</span>
                        <span className="text-text">{m.label}</span>
                        <code className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-muted font-mono">
                          {m.name}
                        </code>
                        <span className="ml-auto text-[10px] text-text-dim">restart to apply</span>
                      </div>
                      <div className="text-[10px] text-text-muted mt-1">{m.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {attachable.length === 0 && systemMCPMissing.length === 0 && (
              <p className="text-text-muted text-sm">
                No unattached servers in this project. Add one in Settings → MCP Servers,
                or connect a Composio integration.
              </p>
            )}
            {attachable.map((s) => {
              const transport = s.proxy_config?.transport || "stdio";
              const isCustomStopped = s.source === "custom" && s.status !== "running";
              return (
                <button
                  key={s.id}
                  onClick={() => !isCustomStopped && handleAttach(s)}
                  disabled={busy || isCustomStopped}
                  className={`w-full text-left border rounded-lg p-3 transition-colors ${
                    isCustomStopped
                      ? "border-border bg-bg-card opacity-50 cursor-not-allowed"
                      : "border-border bg-bg-card hover:border-accent"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {/* Primary label: the display name (description),
                        falling back to the slug when description is
                        empty (legacy rows or composio's generic blurb).
                        The slug itself is shown as a mono pill next to
                        it so users can see exactly what the agent will
                        refer to the server as. */}
                    <span className="text-text text-sm font-bold">
                      {s.description || s.name}
                    </span>
                    <code className="text-[10px] px-1.5 py-0.5 rounded bg-bg-input text-text-muted font-mono">
                      {s.name}
                    </code>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-dim">
                      {s.source}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-dim">
                      {transport}
                    </span>
                    {s.tool_count > 0 && (
                      <span className="text-text-dim text-xs ml-auto">{s.tool_count} tools</span>
                    )}
                  </div>
                  {isCustomStopped && (
                    <p className="text-text-dim text-xs mt-1">
                      Start this server in Settings → MCP Servers before attaching.
                    </p>
                  )}
                  {s.proxy_config?.url && (
                    <code className="text-text-dim text-[10px] block mt-1 truncate">
                      {s.proxy_config.url}
                    </code>
                  )}
                </button>
              );
            })}
          </div>
          <div className="shrink-0 flex justify-end pt-3">
            <button
              onClick={() => setPicker(false)}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
