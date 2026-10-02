import { useState, useEffect } from "react";

import { Link } from "react-router-dom";

import { mcpServers, integrations, type ConnectionInfo, type MCPServer, type MCPTool } from "../../api";

import { Modal } from "../../components/Modal";

import { useProjects } from "../../hooks/useProjects";

export function MCPServersTab() {
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
  const [addConnList, setAddConnList] = useState<import("../../api").ConnectionInfo[]>([]);
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

  const load = () => mcpServers.list(currentProject?.id).then((s) => setServers((s || []).filter((row) => row.source !== "builtin"))).catch(() => {});

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
