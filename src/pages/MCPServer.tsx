import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  apps as appsAPI,
  integrations,
  mcpServers,
  type AppRow,
  type ConnectionInfo,
  type ManagedMCPBindings,
  type ManagedMCPDefinition,
  type ManagedMCPDetails,
  type ManagedMCPTool,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";

type ToolDraft = Omit<ManagedMCPTool, "inputSchema" | "outputSchema"> & {
  inputSchemaText: string;
  outputSchemaText: string;
};

type BindingDraft = { alias: string; id: number };
type EnvDraft = { key: string; value: string };

const defaultTool = (): ToolDraft => ({
  name: "hello",
  description: "Return a greeting for a name.",
  handler: "tools/hello.js",
  code: 'return { message: `Hello, ${input.name || "world"}!` };',
  inputSchemaText: JSON.stringify(
    {
      type: "object",
      properties: { name: { type: "string", description: "Name to greet" } },
    },
    null,
    2,
  ),
  outputSchemaText: "",
});

function toolToDraft(tool: ManagedMCPTool): ToolDraft {
  return {
    name: tool.name,
    description: tool.description,
    handler: tool.handler,
    code: tool.code,
    inputSchemaText: JSON.stringify(tool.inputSchema || { type: "object", properties: {} }, null, 2),
    outputSchemaText: tool.outputSchema ? JSON.stringify(tool.outputSchema, null, 2) : "",
  };
}

function mapToBindings(values?: Record<string, number>): BindingDraft[] {
  return Object.entries(values || {}).map(([alias, id]) => ({ alias, id }));
}

function bindingsToMap(values: BindingDraft[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of values) {
    const alias = row.alias.trim();
    if (alias && row.id > 0) out[alias] = row.id;
  }
  return out;
}

export function MCPServerPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const serverID = isNew ? 0 : Number(id);
  const { currentProject } = useProjects();
  const navigate = useNavigate();
  usePageTitle(isNew ? "New custom MCP" : "Custom MCP");

  const [details, setDetails] = useState<ManagedMCPDetails | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tools, setTools] = useState<ToolDraft[]>([defaultTool()]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [appInstalls, setAppInstalls] = useState<AppRow[]>([]);
  const [integrationBindings, setIntegrationBindings] = useState<BindingDraft[]>([]);
  const [appBindings, setAppBindings] = useState<BindingDraft[]>([]);
  const [env, setEnv] = useState<EnvDraft[]>([]);
  const [deleteEnv, setDeleteEnv] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const projectID = details?.server.project_id || currentProject?.id || "";

  const load = async () => {
    if (!serverID) return;
    setLoading(true);
    setError("");
    try {
      const next = await mcpServers.managed(serverID);
      setDetails(next);
      setName(next.server.name);
      setDescription(next.server.description || next.server.name);
      setTools((next.definition.tools || []).map(toolToDraft));
      setIntegrationBindings(mapToBindings(next.bindings.integrations));
      setAppBindings(mapToBindings(next.bindings.apps));
      const logResult = await mcpServers.managedLogs(serverID).catch(() => ({ logs: "" }));
      setLogs(logResult.logs || "");
    } catch (err: any) {
      setError(err?.message || "Failed to load custom MCP server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    if (!Number.isFinite(serverID) || serverID <= 0) {
      setError("Invalid MCP server id");
      setLoading(false);
      return;
    }
    void load();
  }, [serverID, isNew]);

  useEffect(() => {
    if (!projectID) return;
    integrations.connections(projectID).then((rows) => setConnections(rows || [])).catch(() => setConnections([]));
    appsAPI.list(projectID).then((rows) => setAppInstalls((rows || []).filter(
      (row) => row.status === "running" && (row.surfaces?.mcp_tool_count || 0) > 0,
    ))).catch(() => setAppInstalls([]));
  }, [projectID]);

  const existingEnvKeys = details?.env_keys || [];
  const visibleEnvKeys = existingEnvKeys.filter((key) => !deleteEnv.has(key));

  const definition = useMemo((): ManagedMCPDefinition | null => {
    try {
      const parsedTools = tools.map((tool) => {
        const inputSchema = JSON.parse(tool.inputSchemaText || "{}");
        const outputSchema = tool.outputSchemaText.trim() ? JSON.parse(tool.outputSchemaText) : undefined;
        return {
          name: tool.name.trim(),
          description: tool.description.trim(),
          handler: tool.handler.trim() || `tools/${tool.name.trim()}.js`,
          code: tool.code,
          inputSchema,
          ...(outputSchema ? { outputSchema } : {}),
        };
      });
      return { version: 1, tools: parsedTools };
    } catch {
      return null;
    }
  }, [tools]);

  const bindings = useMemo((): ManagedMCPBindings => ({
    integrations: bindingsToMap(integrationBindings),
    apps: bindingsToMap(appBindings),
  }), [integrationBindings, appBindings]);

  const validateLocally = () => {
    if (!name.trim()) throw new Error("A server name is required.");
    if (!projectID) throw new Error("Select a project first.");
    if (!definition) throw new Error("Every input/output schema must be valid JSON.");
    if (definition.tools.length === 0) throw new Error("Add at least one tool.");
    const names = new Set<string>();
    for (const tool of definition.tools) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(tool.name)) {
        throw new Error(`Invalid tool name: ${tool.name || "(empty)"}`);
      }
      if (names.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      names.add(tool.name);
      if (!tool.description) throw new Error(`Tool ${tool.name} needs a description.`);
      if (!tool.code.trim()) throw new Error(`Tool ${tool.name} needs handler code.`);
      if (tool.inputSchema?.type && tool.inputSchema.type !== "object") {
        throw new Error(`Tool ${tool.name} input schema must have type "object".`);
      }
    }
    for (const row of [...integrationBindings, ...appBindings]) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(row.alias.trim()) || row.id <= 0) {
        throw new Error("Every binding needs a valid alias and selected target.");
      }
    }
  };

  const buildEnv = () => {
    const out: Record<string, string> = {};
    for (const row of env) {
      if (row.key.trim()) out[row.key.trim()] = row.value;
    }
    return out;
  };

  const handleValidate = async () => {
    setValidating(true);
    setError("");
    setMessage("");
    try {
      validateLocally();
      if (!isNew && definition) {
        await mcpServers.validateManaged(serverID, definition, bindings);
        setMessage("Definition and bindings are valid.");
      } else {
        setMessage("Definition is valid. The server will perform the final JavaScript validation on create.");
      }
    } catch (err: any) {
      setError(err?.message || "Validation failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      validateLocally();
      if (!definition) return;
      if (isNew) {
        const created = await mcpServers.createManaged({
          name: name.trim(),
          description: description.trim() || name.trim(),
          project_id: projectID,
          definition,
          bindings,
          env: buildEnv(),
          start: true,
        });
        navigate(`/mcp-servers/${created.server.id}`, { replace: true });
        return;
      }
      const next = await mcpServers.updateManaged(serverID, {
        description: description.trim() || name,
        definition,
        bindings,
        env: buildEnv(),
        delete_env: Array.from(deleteEnv),
      });
      setDetails(next);
      setEnv([]);
      setDeleteEnv(new Set());
      setMessage("Saved and applied. A running server was restarted atomically.");
      const logResult = await mcpServers.managedLogs(serverID).catch(() => ({ logs: "" }));
      setLogs(logResult.logs || "");
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleRunning = async () => {
    if (!details) return;
    setSaving(true);
    setError("");
    try {
      if (details.server.status === "running") {
        await mcpServers.stop(details.server.id);
      } else {
        await mcpServers.start(details.server.id);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || "Status change failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-text-muted">Loading custom MCP server…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/settings?tab=mcp" className="text-xs text-text-muted hover:text-accent">← MCP Servers</Link>
          <h1 className="text-xl text-text font-bold mt-2">{isNew ? "Build a custom MCP server" : description || name}</h1>
          <p className="text-sm text-text-muted mt-1 max-w-3xl">
            Define MCP tools in JavaScript. Code runs in a separate process and can call only the project apps and integrations you bind below.
          </p>
        </div>
        {!isNew && details && (
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded ${
              details.server.status === "running"
                ? "bg-green/15 text-green"
                : details.server.status === "failed"
                  ? "bg-red/15 text-red"
                  : "bg-bg-hover text-text-muted"
            }`}>
              {details.server.status}
            </span>
            <button
              onClick={toggleRunning}
              disabled={saving}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text disabled:opacity-50"
            >
              {details.server.status === "running" ? "Stop" : "Start"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="border border-red/40 bg-red/5 rounded-lg p-3 text-sm text-red whitespace-pre-wrap">{error}</div>}
      {message && <div className="border border-green/40 bg-green/5 rounded-lg p-3 text-sm text-green">{message}</div>}

      <section className="border border-border rounded-lg bg-bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm text-text font-bold">Server</h2>
          <p className="text-xs text-text-muted mt-1">The name is the stable identifier agents attach to.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-xs text-text-muted">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!isNew}
              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text disabled:opacity-60"
              placeholder="customer-tools"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-text-muted">Display name</span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text"
              placeholder="Customer tools"
            />
          </label>
        </div>
        <div className="text-xs text-text-dim">
          Scope: <span className="text-text-muted">
            {currentProject?.id === projectID ? currentProject.name : projectID || "No project selected"}
          </span>
          {!isNew && details && <> · Revision <code>{details.server.upstream_id?.slice(0, 12) || "unknown"}</code></>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm text-text font-bold">Tools</h2>
            <p className="text-xs text-text-muted mt-1">Each handler receives <code>input</code> and the scoped <code>apteva</code> API.</p>
          </div>
          <button
            onClick={() => setTools([...tools, { ...defaultTool(), name: `tool_${tools.length + 1}`, handler: `tools/tool_${tools.length + 1}.js` }])}
            className="text-sm text-accent hover:text-accent-hover"
          >
            + Add tool
          </button>
        </div>
        {tools.map((tool, index) => (
          <div key={index} className="border border-border rounded-lg bg-bg-card p-5 space-y-4">
            <div className="flex justify-between gap-3">
              <div className="grid sm:grid-cols-2 gap-3 flex-1">
                <label className="space-y-1">
                  <span className="text-xs text-text-muted">Tool name</span>
                  <input
                    value={tool.name}
                    onChange={(event) => {
                      const next = [...tools];
                      const oldDefault = `tools/${next[index].name}.js`;
                      next[index] = { ...next[index], name: event.target.value };
                      if (!next[index].handler || next[index].handler === oldDefault) {
                        next[index].handler = `tools/${event.target.value}.js`;
                      }
                      setTools(next);
                    }}
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-text-muted">Description</span>
                  <input
                    value={tool.description}
                    onChange={(event) => {
                      const next = [...tools];
                      next[index] = { ...next[index], description: event.target.value };
                      setTools(next);
                    }}
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text"
                  />
                </label>
              </div>
              <button
                onClick={() => setTools(tools.filter((_, toolIndex) => toolIndex !== index))}
                className="text-xs text-text-muted hover:text-red self-end pb-2"
              >
                Remove
              </button>
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-xs text-text-muted">Input schema (JSON Schema)</span>
                <textarea
                  value={tool.inputSchemaText}
                  onChange={(event) => {
                    const next = [...tools];
                    next[index] = { ...next[index], inputSchemaText: event.target.value };
                    setTools(next);
                  }}
                  rows={10}
                  spellCheck={false}
                  className="w-full bg-bg-input border border-border rounded-lg p-3 text-xs text-text font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-text-muted">Handler JavaScript</span>
                <textarea
                  value={tool.code}
                  onChange={(event) => {
                    const next = [...tools];
                    next[index] = { ...next[index], code: event.target.value };
                    setTools(next);
                  }}
                  rows={10}
                  spellCheck={false}
                  className="w-full bg-bg-input border border-border rounded-lg p-3 text-xs text-text font-mono"
                />
              </label>
            </div>
            <details>
              <summary className="text-xs text-text-muted cursor-pointer">Output schema (optional)</summary>
              <textarea
                value={tool.outputSchemaText}
                onChange={(event) => {
                  const next = [...tools];
                  next[index] = { ...next[index], outputSchemaText: event.target.value };
                  setTools(next);
                }}
                rows={6}
                spellCheck={false}
                className="w-full mt-2 bg-bg-input border border-border rounded-lg p-3 text-xs text-text font-mono"
                placeholder={'{\n  "type": "object"\n}'}
              />
            </details>
          </div>
        ))}
      </section>

      <section className="border border-border rounded-lg bg-bg-card p-5 space-y-5">
        <div>
          <h2 className="text-sm text-text font-bold">Bound capabilities</h2>
          <p className="text-xs text-text-muted mt-1">
            Handler code calls <code>apteva.integration(alias, tool, input)</code> or <code>apteva.app(alias, tool, input)</code>. Unbound aliases are rejected by the server.
          </p>
        </div>
        <BindingEditor
          label="Integrations"
          rows={integrationBindings}
          setRows={setIntegrationBindings}
          options={connections.filter((row) => row.status === "active").map((row) => ({ id: row.id, label: `${row.name} (${row.app_slug})` }))}
        />
        <BindingEditor
          label="Apps"
          rows={appBindings}
          setRows={setAppBindings}
          options={appInstalls.map((row) => ({ id: row.install_id, label: row.display_name || row.name }))}
        />
      </section>

      <section className="border border-border rounded-lg bg-bg-card p-5 space-y-4">
        <div>
          <h2 className="text-sm text-text font-bold">Secrets and environment</h2>
          <p className="text-xs text-text-muted mt-1">Values are encrypted and are never returned to the browser. Read them with <code>apteva.env("NAME")</code>.</p>
        </div>
        {visibleEnvKeys.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {visibleEnvKeys.map((key) => (
              <span key={key} className="inline-flex items-center gap-2 px-2 py-1 rounded bg-bg-input text-xs text-text-muted">
                {key}
                <button onClick={() => setDeleteEnv(new Set([...deleteEnv, key]))} className="hover:text-red" title="Delete secret">×</button>
              </span>
            ))}
          </div>
        )}
        {env.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              value={row.key}
              onChange={(event) => {
                const next = [...env];
                next[index] = { ...next[index], key: event.target.value };
                setEnv(next);
              }}
              className="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono"
              placeholder="API_TOKEN"
            />
            <input
              type="password"
              value={row.value}
              onChange={(event) => {
                const next = [...env];
                next[index] = { ...next[index], value: event.target.value };
                setEnv(next);
              }}
              className="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text"
              placeholder="Value"
            />
            <button onClick={() => setEnv(env.filter((_, envIndex) => envIndex !== index))} className="px-2 text-text-muted hover:text-red">×</button>
          </div>
        ))}
        <button onClick={() => setEnv([...env, { key: "", value: "" }])} className="text-sm text-accent hover:text-accent-hover">+ Add variable</button>
      </section>

      {!isNew && (
        <section className="border border-border rounded-lg bg-bg-card p-5 space-y-3">
          <div className="flex justify-between">
            <h2 className="text-sm text-text font-bold">Runner logs</h2>
            <button onClick={load} className="text-xs text-text-muted hover:text-accent">Refresh</button>
          </div>
          <pre className="min-h-24 max-h-72 overflow-auto rounded-lg bg-bg-input p-3 text-xs text-text-muted whitespace-pre-wrap">
            {logs || "No runner output."}
          </pre>
        </section>
      )}

      <div className="flex justify-end gap-3 sticky bottom-3">
        <button
          onClick={handleValidate}
          disabled={validating || saving}
          className="px-4 py-2.5 border border-border bg-bg-card rounded-lg text-sm text-text-muted hover:text-text disabled:opacity-50"
        >
          {validating ? "Validating…" : "Validate"}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : isNew ? "Create and start" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function BindingEditor({
  label,
  rows,
  setRows,
  options,
}: {
  label: string;
  rows: BindingDraft[];
  setRows: (rows: BindingDraft[]) => void;
  options: Array<{ id: number; label: string }>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <span className="text-xs text-text-muted">{label}</span>
        <button onClick={() => setRows([...rows, { alias: "", id: 0 }])} className="text-xs text-accent hover:text-accent-hover">+ Bind</button>
      </div>
      {rows.length === 0 && <div className="text-xs text-text-dim">None bound.</div>}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(120px,0.65fr)_1.35fr_auto] gap-2">
          <input
            value={row.alias}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...next[index], alias: event.target.value };
              setRows(next);
            }}
            className="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono"
            placeholder="alias"
          />
          <select
            value={row.id}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...next[index], id: Number(event.target.value) };
              setRows(next);
            }}
            className="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text"
          >
            <option value={0}>Select…</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))} className="px-2 text-text-muted hover:text-red">×</button>
        </div>
      ))}
    </div>
  );
}
