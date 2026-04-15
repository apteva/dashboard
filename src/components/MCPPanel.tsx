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
  // Attach mode the user selected in the picker before committing. `main`
  // makes the server's tools visible to the root thread and every thread
  // with a matching allowlist; `catalog` only surfaces the server's
  // name + tool count in the system prompt so sub-threads must explicitly
  // spawn with mcp="<name>" to use it. Defaults to main because that's
  // the common case — a user attaching an integration usually wants the
  // agent to use it directly, not to have to delegate through a worker.
  const [pickerMainAccess, setPickerMainAccess] = useState(true);
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
      // Mode selected in the picker — main (root-thread tools) or catalog
      // (workers must spawn with mcp="<name>" to see them). Defaults to
      // main but the user can flip it in the picker before clicking.
      main_access: pickerMainAccess,
    };
    await writeList([...userAttached, entry]);
    setPicker(false);
    // Reset picker state so next open starts from the default.
    setPickerMainAccess(true);
  };

  const handleDetach = async (name: string) => {
    await writeList(userAttached.filter((s) => s.name !== name));
  };

  // Flip the main_access flag on an already-attached entry. Core's
  // reconcileMCP diff detects the change via `changed()` and will
  // disconnect-then-reconnect the server so the mode switch takes
  // effect on the next iteration.
  const handleToggleMode = async (name: string) => {
    const next = userAttached.map((s) =>
      s.name === name ? { ...s, main_access: !s.main_access } : s,
    );
    await writeList(next);
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
          {userAttached.map((s) => {
            // Treat undefined as the legacy default: the core used to
            // default undefined to main-access for any row lacking the
            // flag. We show the badge accordingly but don't rewrite the
            // row on load — the user flips it explicitly.
            const isMain = s.main_access !== false;
            return (
              <div key={s.name} className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.connected ? "bg-green" : "bg-text-dim"
                  }`}
                />
                <span className="text-text truncate flex-1">{s.name}</span>
                <button
                  onClick={() => handleToggleMode(s.name)}
                  disabled={busy}
                  className={`text-[9px] px-1.5 py-[1px] rounded transition-colors disabled:opacity-50 ${
                    isMain
                      ? "bg-accent/15 text-accent hover:bg-accent/25"
                      : "bg-bg-hover text-text-dim hover:text-text"
                  }`}
                  title={
                    isMain
                      ? "Main access — tools visible to root thread. Click to switch to catalog."
                      : "Catalog — sub-threads must spawn with mcp=\"" +
                        s.name +
                        "\" to use these tools. Click to promote to main."
                  }
                >
                  {isMain ? "main" : "catalog"}
                </button>
                <span className="text-text-dim text-[10px]">{s.transport || "stdio"}</span>
                <button
                  onClick={() => handleDetach(s.name)}
                  disabled={busy}
                  className="text-text-muted hover:text-red transition-colors disabled:opacity-50 text-[10px] px-1"
                  title="Detach from this agent"
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
              Pick one of the MCP servers registered in this project. The core will
              reconcile and connect it immediately.
            </p>
          </div>

          {/* Attach-mode toggle — determines whether clicking a row below
              creates a main-access or catalog-only entry. The choice is
              per-click: pick a mode, then click the server. Can be
              changed again later via the mode badge in the attached list. */}
          <div className="shrink-0 mb-4 border border-border rounded-lg p-3 bg-bg-card/30">
            <div className="text-[10px] text-text-muted uppercase tracking-wide font-bold mb-2">
              Attach mode
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPickerMainAccess(true)}
                className={`flex-1 text-left px-3 py-2 rounded-lg border transition-colors ${
                  pickerMainAccess
                    ? "border-accent bg-accent/10 text-text"
                    : "border-border text-text-muted hover:text-text hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-bold">
                  {pickerMainAccess && <span className="text-accent">●</span>}
                  Main access
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  Tools register on the root thread. Agent can call them directly.
                </div>
              </button>
              <button
                onClick={() => setPickerMainAccess(false)}
                className={`flex-1 text-left px-3 py-2 rounded-lg border transition-colors ${
                  !pickerMainAccess
                    ? "border-accent bg-accent/10 text-text"
                    : "border-border text-text-muted hover:text-text hover:border-border"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-bold">
                  {!pickerMainAccess && <span className="text-accent">●</span>}
                  Catalog
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  Visible to main as a name + tool count. Sub-threads spawn with mcp=&quot;…&quot;.
                </div>
              </button>
            </div>
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
