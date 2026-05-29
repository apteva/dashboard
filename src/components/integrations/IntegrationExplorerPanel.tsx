import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  integrations,
  type AppDetail,
  type ConnectionInfo,
  type IntegrationExplorerAction,
  type IntegrationExplorerResource,
} from "../../api";

type ToolInfo = {
  name: string;
  description: string;
  method: string;
  path: string;
  input_schema: Record<string, any>;
};

interface Props {
  connection: ConnectionInfo | null;
  open: boolean;
  onClose: () => void;
}

export function IntegrationExplorerPanel({ connection, open, onClose }: Props) {
  const [app, setApp] = useState<AppDetail | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [activeResourceId, setActiveResourceId] = useState("");
  const [resourceInput, setResourceInput] = useState<Record<string, Record<string, any>>>({});
  const [rows, setRows] = useState<any[]>([]);
  const [rawData, setRawData] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [activeAction, setActiveAction] = useState<IntegrationExplorerAction | null>(null);
  const [actionInput, setActionInput] = useState<Record<string, any>>({});
  const [actionResult, setActionResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !connection) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setApp(null);
    setTools([]);
    setRows([]);
    setRawData(null);
    setSelectedItem(null);
    setDetail(null);
    setActiveAction(null);
    setActionResult(null);
    Promise.all([integrations.app(connection.app_slug), integrations.tools(connection.id)])
      .then(([nextApp, nextTools]) => {
        if (cancelled) return;
        setApp(nextApp);
        setTools(nextTools);
        const first = nextApp.explorer?.resources?.[0];
        setActiveResourceId(first?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "failed to load explorer");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connection?.id, connection?.app_slug]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const resources = app?.explorer?.resources || [];
  const activeResource = useMemo(
    () => resources.find((r) => r.id === activeResourceId) || resources[0],
    [resources, activeResourceId],
  );

  const findTool = useCallback(
    (name: string) =>
      tools.find((t) => t.name === name) ||
      tools.find((t) => t.name.endsWith(`_${name}`)) ||
      app?.tools.find((t) => t.name === name),
    [tools, app?.tools],
  );

  const runResource = useCallback(async (resource: IntegrationExplorerResource) => {
    if (!connection) return;
    setResourceLoading(true);
    setError("");
    setSelectedItem(null);
    setDetail(null);
    setActionResult(null);
    try {
      const input = {
        ...(resolveTemplates(resource.list_input || {}, null)),
        ...(resourceInput[resource.id] || {}),
      };
      const result = await integrations.execute(connection.id, resource.list_tool, cleanInput(input));
      const data = result.data;
      setRawData(data);
      setRows(extractRows(data, resource.response_path));
    } catch (e: any) {
      setError(e?.message || "failed to load resource");
      setRows([]);
      setRawData(null);
    } finally {
      setResourceLoading(false);
    }
  }, [connection, resourceInput]);

  useEffect(() => {
    if (!open || !activeResource || loading) return;
    runResource(activeResource);
    // Only auto-run when the selected resource changes. Filter edits are
    // applied by the form submit button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeResourceId, loading]);

  const loadDetail = async (item: any) => {
    setSelectedItem(item);
    setDetail(null);
    setActionResult(null);
    if (!connection || !activeResource?.detail_tool) return;
    setDetailLoading(true);
    setError("");
    try {
      const input = cleanInput(resolveTemplates(activeResource.detail_input || {}, item));
      const result = await integrations.execute(connection.id, activeResource.detail_tool, input);
      setDetail(result.data);
    } catch (e: any) {
      setError(e?.message || "failed to load details");
    } finally {
      setDetailLoading(false);
    }
  };

  const openAction = (action: IntegrationExplorerAction) => {
    setActiveAction(action);
    setActionInput(resolveTemplates(action.input || {}, selectedItem));
    setActionResult(null);
    setError("");
  };

  const submitAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!connection || !activeAction) return;
    if (activeAction.destructive && !window.confirm(`Run ${activeAction.label}?`)) return;
    setActionBusy(true);
    setError("");
    try {
      const result = await integrations.execute(connection.id, activeAction.tool, cleanInput(actionInput));
      if (activeResource) await runResource(activeResource);
      setActionResult(result.data);
    } catch (err: any) {
      setError(err?.message || "action failed");
    } finally {
      setActionBusy(false);
    }
  };

  if (!open || !connection) return null;

  const listTool = activeResource ? findTool(activeResource.list_tool) : undefined;
  const activeActionTool = activeAction ? findTool(activeAction.tool) : undefined;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[92vw] flex-col border-l border-border bg-bg-card shadow-xl sm:w-[820px] xl:w-[940px]"
        role="dialog"
        aria-label={`${connection.app_name} explorer`}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-5">
          {app?.logo && (
            <img
              src={app.logo}
              alt=""
              className="h-10 w-10 shrink-0 rounded bg-bg-input p-0.5"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-text">{connection.name}</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {connection.app_name} explorer
              {connection.app_slug === "bunny-stream" && (
                <span className="ml-2 rounded bg-bg-hover px-1.5 py-0.5 text-text-dim">
                  configured library
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-xl leading-none text-text-muted hover:text-text"
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && <div className="p-6 text-sm text-text-muted">Loading explorer...</div>}
          {!loading && error && (
            <div className="mx-6 mt-4 rounded border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
              {error}
            </div>
          )}
          {!loading && resources.length === 0 && (
            <div className="p-6 text-sm text-text-muted">No explorer is declared for this integration.</div>
          )}
          {!loading && resources.length > 0 && activeResource && (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <nav className="border-b border-border px-5 py-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-text-dim">Resources</div>
                <div className="flex gap-2 overflow-x-auto">
                  {resources.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setActiveResourceId(r.id)}
                      className={`shrink-0 rounded px-3 py-1.5 text-sm transition-colors ${
                        activeResource.id === r.id
                          ? "bg-accent text-bg"
                          : "text-text-muted hover:bg-bg-hover hover:text-text"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </nav>

              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <div className="border-b border-border px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-text">{activeResource.label}</h3>
                      {activeResource.description && (
                        <p className="mt-1 text-sm text-text-muted">{activeResource.description}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => runResource(activeResource)}
                      disabled={resourceLoading}
                      className="rounded border border-border px-3 py-2 text-sm text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-50"
                    >
                      {resourceLoading ? "Loading..." : "Refresh"}
                    </button>
                  </div>

                  {listTool?.input_schema && (
                    <form
                      className="mt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        runResource(activeResource);
                      }}
                    >
                      <SchemaFields
                        schema={listTool.input_schema}
                        value={resourceInput[activeResource.id] || {}}
                        onChange={(next) =>
                          setResourceInput((prev) => ({ ...prev, [activeResource.id]: next }))
                        }
                        compact
                      />
                      <button
                        type="submit"
                        className="mt-3 rounded bg-accent px-3 py-2 text-sm font-bold text-bg hover:opacity-80"
                      >
                        Apply
                      </button>
                    </form>
                  )}
                </div>

                <div className="grid min-h-0 grid-rows-[minmax(180px,42%)_minmax(0,1fr)]">
                  <div className="min-h-0 overflow-y-auto border-b border-border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="text-xs uppercase tracking-wide text-text-dim">
                        {rows.length} items
                      </span>
                      <div className="flex gap-2">
                        {(activeResource.actions || []).map((a) => (
                          <button
                            key={a.label}
                            type="button"
                            disabled={actionRequiresItem(a) && !selectedItem}
                            onClick={() => openAction(a)}
                            className={`rounded border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                              a.destructive
                                ? "border-red/50 text-red hover:bg-red/10"
                                : "border-border text-text-muted hover:bg-bg-hover hover:text-text"
                            }`}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {resourceLoading && <div className="text-sm text-text-muted">Loading...</div>}
                    {!resourceLoading && rows.length === 0 && (
                      <div className="rounded border border-border bg-bg-input p-3 text-sm text-text-muted">
                        No rows returned.
                      </div>
                    )}
                    <div className="space-y-2">
                      {rows.map((item, index) => {
                        const id = readPath(item, activeResource.item_id_path) ?? index;
                        const label =
                          readPath(item, activeResource.item_label_path) ??
                          readPath(item, activeResource.item_id_path) ??
                          `Item ${index + 1}`;
                        const subtitle = readPath(item, activeResource.item_subtitle_path);
                        const selected = selectedItem === item;
                        return (
                          <button
                            key={`${String(id)}-${index}`}
                            type="button"
                            onClick={() => loadDetail(item)}
                            className={`w-full rounded border p-3 text-left transition-colors ${
                              selected
                                ? "border-accent bg-accent/10"
                                : "border-border bg-bg-input hover:border-accent"
                            }`}
                          >
                            <div className="truncate text-sm font-bold text-text">{String(label)}</div>
                            {subtitle !== undefined && (
                              <div className="mt-1 truncate text-xs text-text-muted">{String(subtitle)}</div>
                            )}
                            {id !== undefined && (
                              <div className="mt-1 truncate font-mono text-[11px] text-text-dim">{String(id)}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto p-4">
                    {activeAction ? (
                      <form onSubmit={submitAction} className="space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-text">{activeAction.label}</h4>
                          {activeAction.description && (
                            <p className="mt-1 text-sm text-text-muted">{activeAction.description}</p>
                          )}
                        </div>
                        <SchemaFields
                          schema={activeActionTool?.input_schema || { type: "object", properties: {} }}
                          value={actionInput}
                          onChange={setActionInput}
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={actionBusy}
                            className={`rounded px-3 py-2 text-sm font-bold disabled:opacity-50 ${
                              activeAction.destructive
                                ? "border border-red text-red hover:bg-red/10"
                                : "bg-accent text-bg hover:opacity-80"
                            }`}
                          >
                            {actionBusy ? "Running..." : "Run"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveAction(null)}
                            className="rounded border border-border px-3 py-2 text-sm text-text-muted hover:bg-bg-hover hover:text-text"
                          >
                            Cancel
                          </button>
                        </div>
                        {actionResult !== null && <JsonBlock title="Result" value={actionResult} />}
                      </form>
                    ) : selectedItem ? (
                      <div className="space-y-4">
                        <JsonBlock title="Selected" value={selectedItem} />
                        {detailLoading && <div className="text-sm text-text-muted">Loading details...</div>}
                        {detail !== null && <JsonBlock title="Details" value={detail} />}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded border border-border bg-bg-input p-3 text-sm text-text-muted">
                          Select an item to inspect it, or run an action from the list.
                        </div>
                        {rawData !== null && <JsonBlock title="Raw response" value={rawData} />}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function SchemaFields({
  schema,
  value,
  onChange,
  compact = false,
}: {
  schema: Record<string, any>;
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  compact?: boolean;
}) {
  const props = (schema?.properties || {}) as Record<string, any>;
  const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
  const entries = Object.entries(props);
  if (entries.length === 0) return null;
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
      {entries.map(([name, field]) => (
        <label key={name} className="block">
          <span className="mb-1 block text-xs font-bold text-text-muted">
            {field?.description || name}
            {required.has(name) && <span className="text-red"> *</span>}
          </span>
          <FieldInput
            field={field || {}}
            value={value[name]}
            placeholder={name}
            onChange={(next) => onChange({ ...value, [name]: next })}
          />
        </label>
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  placeholder,
  onChange,
}: {
  field: Record<string, any>;
  value: any;
  placeholder: string;
  onChange: (next: any) => void;
}) {
  const type = field.type || "string";
  if (type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
    );
  }
  if (Array.isArray(field.enum)) {
    return (
      <select
        value={value ?? field.default ?? ""}
        onChange={(e) => onChange(coerceValue(e.target.value, type))}
        className="w-full rounded border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
      >
        <option value="">Default</option>
        {field.enum.map((v: any) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }
  if (type === "object" || type === "array") {
    return (
      <textarea
        value={value === undefined ? "" : JSON.stringify(value, null, 2)}
        onChange={(e) => onChange(parseStructured(e.target.value, type))}
        rows={4}
        placeholder={placeholder}
        className="w-full rounded border border-border bg-bg-input px-3 py-2 font-mono text-xs text-text focus:border-accent focus:outline-none"
      />
    );
  }
  return (
    <input
      type={type === "integer" || type === "number" ? "number" : "text"}
      value={value ?? ""}
      onChange={(e) => onChange(coerceValue(e.target.value, type))}
      placeholder={field.default !== undefined ? String(field.default) : placeholder}
      className="w-full rounded border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
    />
  );
}

function JsonBlock({ title, value }: { title: string; value: any }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-text-dim">{title}</div>
      <pre className="max-h-[520px] overflow-auto rounded border border-border bg-bg-input p-3 font-mono text-xs leading-relaxed text-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function readPath(obj: any, path?: string): any {
  if (!path) return undefined;
  return path.split(".").reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

function extractRows(data: any, path?: string): any[] {
  const node = path ? readPath(data, path) : data?.Items ?? data?.items ?? data;
  if (Array.isArray(node)) return node;
  if (Array.isArray(node?.Items)) return node.Items;
  if (Array.isArray(node?.items)) return node.items;
  return node && typeof node === "object" ? [node] : [];
}

function resolveTemplates(input: Record<string, any>, item: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === "string"
      ? value.replace(/\{\{item\.([^}]+)\}\}/g, (_m, path) => String(readPath(item, path) ?? ""))
      : value;
  }
  return out;
}

function cleanInput(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

function coerceValue(value: string, type: string) {
  if (value === "") return "";
  if (type === "integer") return parseInt(value, 10);
  if (type === "number") return Number(value);
  return value;
}

function parseStructured(value: string, type: string) {
  if (value.trim() === "") return "";
  try {
    return JSON.parse(value);
  } catch {
    return type === "array" ? [] : {};
  }
}

function actionRequiresItem(action: IntegrationExplorerAction) {
  return JSON.stringify(action.input || {}).includes("{{item.");
}
