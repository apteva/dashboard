import { useState, useEffect } from "react";
import { core, mcpServers, type MCPServer, type MCPServerConfig } from "../api";
import { Modal } from "./Modal";
import { useProjects } from "../hooks/useProjects";

// System entries cores inject into every instance's mcp_servers list. We
// hide them from the user-facing list but preserve them on every write so
// reconcileMCP doesn't reap them.
const SYSTEM_MCP_NAMES = new Set(["apteva-server", "apteva-channels", "channels"]);

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

  const load = () => {
    if (!running) {
      setAttached([]);
      return;
    }
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

  if (!running) return null;

  // Partition: system entries stay invisible but we keep a reference so
  // we can re-include them on every PUT.
  const userAttached = attached.filter((s) => !SYSTEM_MCP_NAMES.has(s.name));
  const systemAttached = attached.filter((s) => SYSTEM_MCP_NAMES.has(s.name));

  // For the picker we hide rows that are already attached, by name, and
  // rows that are clearly not wirable (no proxy_config).
  const attachedNames = new Set(attached.map((s) => s.name));
  const attachable = inventory.filter(
    (s) => !!s.proxy_config && !attachedNames.has(s.proxy_config.name),
  );

  const writeList = async (next: MCPServerConfig[]) => {
    setBusy(true);
    setError("");
    try {
      // Always include system entries so core's reconcile doesn't reap them.
      await core.setMCPServers(instanceId, [...systemAttached, ...next]);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to update MCP servers");
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
      // Default to main-access so the server's tools are visible to the
      // root thread. Without this flag core would only catalog it and
      // spawn per-thread connections on demand, which isn't what "attach
      // to instance" implies in the UI.
      main_access: true,
    };
    await writeList([...userAttached, entry]);
    setPicker(false);
  };

  const handleDetach = async (name: string) => {
    await writeList(userAttached.filter((s) => s.name !== name));
  };

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-text-muted font-bold uppercase tracking-wide text-[10px]">
          MCP Servers ({userAttached.length})
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

      {userAttached.length === 0 ? (
        <div className="text-text-dim text-[10px]">
          None attached. Click + add to wire one from this project's inventory.
        </div>
      ) : (
        <div className="space-y-1">
          {userAttached.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  s.connected ? "bg-green" : "bg-text-dim"
                }`}
              />
              <span className="text-text truncate flex-1">{s.name}</span>
              <span className="text-text-dim text-[10px]">{s.transport || "stdio"}</span>
              <button
                onClick={() => handleDetach(s.name)}
                disabled={busy}
                className="text-text-muted hover:text-red transition-colors disabled:opacity-50 text-[10px] px-1"
                title="Detach from this instance"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Picker modal */}
      <Modal open={picker} onClose={() => setPicker(false)}>
        <div className="p-6 max-h-[70vh] flex flex-col min-w-[480px]">
          <div className="shrink-0 mb-4">
            <h3 className="text-text text-base font-bold">Attach MCP server</h3>
            <p className="text-text-muted text-sm mt-1">
              Pick one of the MCP servers registered in this project. The core will
              reconcile and connect it immediately.
            </p>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {attachable.length === 0 && (
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
                    <span className="text-text text-sm font-bold">{s.name}</span>
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
                  {s.description && (
                    <p className="text-text-muted text-xs line-clamp-2">{s.description}</p>
                  )}
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
