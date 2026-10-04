import { useEffect, useId, useState } from "react";
import { integrations, type AgentBuiltinOverrides, type BuiltinOption, type BuiltinSetting, type RuntimeConnection } from "../api";

export const builtinLabel = (name: string) => ({ web_search: "Web search", code_execution: "Code execution", file_search: "File search", image_generation: "Image generation" }[name] || name.replaceAll("_", " "));
const optionLabel = (name: string) => name.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export type BuiltinValues = Record<string, BuiltinSetting | null>;

export function agentBuiltins(config?: string): AgentBuiltinOverrides {
  try {
    const saved = JSON.parse(config || "{}");
    const values: AgentBuiltinOverrides = {};
    for (const provider of saved.providers || []) if (provider.builtins) values[provider.name] = provider.builtins;
    for (const [provider, entries] of Object.entries(saved.builtin_overrides || {})) values[provider] = { ...values[provider], ...(entries as BuiltinValues) };
    return values;
  } catch { return {}; }
}
export function builtinPatch(before: BuiltinValues = {}, after: BuiltinValues = {}): BuiltinValues {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => [key, after[key] ?? null]));
}
export function agentBuiltinPatch(config: string | undefined, values: AgentBuiltinOverrides): AgentBuiltinOverrides {
  const saved = agentBuiltins(config);
  return Object.fromEntries(Object.keys(values).map((provider) => [provider, builtinPatch(saved[provider], values[provider])]).filter(([, entries]) => Object.keys(entries!).length));
}
function defaultBuiltins(connection?: RuntimeConnection): BuiltinValues {
  const config = connection?.runtime_config || {};
  const values: BuiltinValues = {};
  let names = config.builtin_tools || [];
  if (typeof names === "string") { try { names = JSON.parse(names); } catch { names = []; } }
  for (const name of Array.isArray(names) ? names : []) {
    const canonical = ({ code_interpreter: "code_execution", google_search: "web_search", web_search_preview: "web_search" } as Record<string, string>)[name] || name;
    if (canonical !== "image_generation") values[canonical] = { enabled: true };
  }
  if (config.image_generation) {
    const { enabled, ...options } = config.image_generation;
    values.image_generation = { enabled: !!enabled, options };
  }
  return { ...values, ...config.builtins };
}

export function BuiltinGlyph({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "web_search" ? <><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="3.5" ry="8" /><path d="M4 12h16M6 7h12M6 17h12" /></>
      : name === "code_execution" ? <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" /></>
      : name === "file_search" ? <><path d="M12 21H5V3h9l4 4v4M14 3v5h4" /><circle cx="16" cy="16" r="4" /><path d="m19 19 3 3" /></>
      : <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m4 18 5-5 4 3 4-6 4 7" /></>}
  </svg>;
}

function OptionField({ name, schema, value, onChange, disabled, onError }: {
  name: string; schema: BuiltinOption; value: unknown; onChange: (value: unknown) => void; disabled?: boolean; onError: (error: boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const structured = ["object", "object_or_string"].includes(schema.type);
  useEffect(() => { setDraft(value === undefined ? "" : Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : JSON.stringify(value, null, 2)); setError(""); onError(false); }, [JSON.stringify(value)]);
  const cls = "w-full min-w-0 rounded-md border border-border bg-bg-input px-2.5 py-2 text-xs text-text focus:border-accent focus:outline-none disabled:opacity-50";
  const change = (raw: string) => {
    setDraft(raw);
    try {
      let next: unknown = undefined;
      if (raw.trim()) {
        if (structured) {
          if (schema.type === "object_or_string" && !raw.trim().startsWith("{") && !raw.trim().startsWith("[")) next = raw.trim();
          else { next = JSON.parse(raw); if (!next || Array.isArray(next) || typeof next !== "object") throw new Error("Enter a JSON object."); }
        } else if (schema.type === "integer") { next = Number(raw); if (!Number.isInteger(next) || Number(next) < 1) throw new Error("Enter a positive whole number."); }
        else next = raw;
      }
      setError(""); onError(false); onChange(next);
    } catch (e: any) { setError(e.message || "Invalid value"); onError(true); }
  };
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="block text-xs text-text-muted">{optionLabel(name)}{schema.required && " (required)"}</label>
    {schema.enum ? <select id={id} disabled={disabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} className={cls}>
      <option value="">Provider default</option>{schema.enum.map((v) => <option key={v} value={v}>{v}</option>)}
    </select> : schema.type === "boolean" ? <select id={id} disabled={disabled} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")} className={cls}>
      <option value="">Provider default</option><option value="true">Yes</option><option value="false">No</option>
    </select> : schema.type === "string_array" ? <textarea id={id} disabled={disabled} value={draft} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean)); }} rows={2} placeholder="One per line" className={cls} />
      : structured ? <textarea id={id} disabled={disabled} value={draft} onChange={(e) => change(e.target.value)} rows={3} placeholder={schema.default ? JSON.stringify(schema.default) : schema.type === "object_or_string" ? "Container ID or JSON object" : "JSON object"} className={`${cls} font-mono`} aria-invalid={!!error} />
        : <input id={id} disabled={disabled} type={schema.type === "integer" ? "number" : "text"} min={schema.type === "integer" ? 1 : undefined} step={schema.type === "integer" ? 1 : undefined} value={draft} onChange={(e) => change(e.target.value)} placeholder="Provider default" className={cls} aria-invalid={!!error} />}
    {error && <p role="alert" className="text-xs text-red">{error}</p>}
  </div>;
}

export function ProviderBuiltinsEditor({ connection, value, onChange, inherit = false, disabled = false, onValidityChange }: {
  connection?: RuntimeConnection | null; value: BuiltinValues; onChange: (value: BuiltinValues) => void; inherit?: boolean; disabled?: boolean; onValidityChange?: (valid: boolean) => void;
}) {
  const descriptors = connection?.builtin_capabilities || [];
  const defaults = defaultBuiltins(connection || undefined);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const effective = (name: string): BuiltinSetting => {
    const entry = value[name]; const base = defaults[name] || { enabled: false };
    if (inherit && !entry) return base;
    return entry ? { ...entry, options: entry.options ?? (inherit ? base.options : undefined) } : { enabled: false };
  };
  const missing = descriptors.flatMap((c) => {
    const entry = effective(c.name);
    return entry.enabled ? Object.entries(c.options || {}).filter(([key, schema]) => schema.required && (!entry.options?.[key] || (Array.isArray(entry.options[key]) && !entry.options[key].length))).map(([key]) => `${builtinLabel(c.name)}: add ${optionLabel(key).toLowerCase()}`) : [];
  });
  const valid = !missing.length && !descriptors.some((c) => effective(c.name).enabled && Object.keys(errors).some((key) => key.startsWith(`${c.name}.`) && errors[key]));
  useEffect(() => { onValidityChange?.(valid); }, [valid, onValidityChange]);
  useEffect(() => { setErrors({}); }, [connection?.id]);
  if (!connection) return null;
  if (connection.builtin_unavailable) return <p className="text-xs text-text-muted">{connection.builtin_unavailable}</p>;
  if (!descriptors.length) return null;
  return <section className="min-w-0 rounded-lg border border-border p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-text">{inherit ? "Model capabilities" : "Built-in capabilities"}</h3>
      {inherit && Object.values(value).some(Boolean) && <button type="button" disabled={disabled} className="text-xs text-accent hover:underline disabled:opacity-50" onClick={() => { setErrors({}); onChange(Object.fromEntries(Object.keys(value).map((key) => [key, null]))); }}>Reset to provider defaults</button>}
    </div>
    <p className="text-[11px] leading-relaxed text-text-dim">The model decides when to use enabled capabilities. Availability and charges depend on the model and account.</p>
    <div className="divide-y divide-border">
      {descriptors.map((capability) => {
        const entry = effective(capability.name);
        const inherited = inherit && !value[capability.name];
        return <div key={`${connection.id}:${capability.name}`} className="py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-accent"><BuiltinGlyph name={capability.name} /></span>
            <div className="min-w-0 flex-1"><span className="text-xs font-medium text-text">{builtinLabel(capability.name)}</span>{capability.experimental && <span className="ml-1 text-[10px] text-text-dim">Experimental</span>}
              {inherit && <p className="text-[10px] text-text-dim">{inherited ? `${connection.app_name} default` : "Agent override"} · {entry.enabled ? "On" : "Off"}</p>}
            </div>
            <select aria-label={`${builtinLabel(capability.name)} setting`} disabled={disabled} value={inherited ? "inherit" : entry.enabled ? "on" : "off"} className="max-w-full rounded-md border border-border bg-bg-input px-2 py-1.5 text-xs text-text disabled:opacity-50"
              onChange={(e) => { if (e.target.value === "on" && Object.values(capability.options || {}).some((option) => option.required)) setExpanded((old) => ({ ...old, [capability.name]: true })); setErrors((old) => Object.fromEntries(Object.entries(old).filter(([key]) => !key.startsWith(`${capability.name}.`)))); onChange({ ...value, [capability.name]: e.target.value === "inherit" ? null : { ...(value[capability.name] || {}), enabled: e.target.value === "on" } }); }}>
              {inherit && <option value="inherit">Inherit ({defaults[capability.name]?.enabled ? "On" : "Off"})</option>}<option value="on">On</option><option value="off">Off</option>
            </select>
          </div>
          {entry.enabled && Object.keys(capability.options || {}).length > 0 && <details className="ml-9" open={!!expanded[capability.name]} onToggle={(e) => { const open = e.currentTarget.open; setExpanded((old) => old[capability.name] === open ? old : { ...old, [capability.name]: open }); }}>
            <summary className="cursor-pointer text-[11px] text-text-muted hover:text-accent">Options{inherited || (inherit && !value[capability.name]?.options) ? " · inherited" : ""}</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">{Object.entries(capability.options || {}).map(([key, schema]) => <OptionField key={key} name={key} schema={schema} value={entry.options?.[key]} disabled={disabled}
              onError={(error) => setErrors((old) => old[`${capability.name}.${key}`] === error ? old : { ...old, [`${capability.name}.${key}`]: error })}
              onChange={(option) => { const options = { ...entry.options }; if (option === undefined) delete options[key]; else options[key] = option; onChange({ ...value, [capability.name]: { enabled: entry.enabled, options } }); }} />)}</div>
            {inherit && value[capability.name]?.options && <button type="button" disabled={disabled} className="mt-2 text-[11px] text-accent hover:underline" onClick={() => onChange({ ...value, [capability.name]: { enabled: entry.enabled } })}>Use provider options</button>}
          </details>}
        </div>;
      })}
    </div>
    {!!missing.length && <p role="alert" className="text-xs text-red">{missing.join(". ")}.</p>}
  </section>;
}

export function ProviderBuiltinDefaults({ connection, onSaved, disabled }: { connection: RuntimeConnection; onSaved: () => void; disabled?: boolean }) {
  const [value, setValue] = useState<BuiltinValues>(defaultBuiltins(connection));
  const [valid, setValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = connection.runtime_config?.builtin_sync?.pending;
  useEffect(() => { setValue(defaultBuiltins(connection)); }, [connection.id, JSON.stringify(connection.runtime_config)]);
  const patch = builtinPatch(defaultBuiltins(connection), value);
  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await integrations.updateRuntimeConfig(connection.id, { builtins: Object.keys(patch).length ? patch : {} });
      if (result.builtin_sync?.pending) setError(`Defaults saved; some agents still need the update: ${result.builtin_sync.errors.join("; ")}`);
      else setNotice("Defaults saved and applied to running agents.");
      onSaved();
    } catch (err: any) { setError(err.message || "Could not save capabilities"); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <ProviderBuiltinsEditor connection={connection} value={value} onChange={setValue} disabled={disabled || busy} onValidityChange={setValid} />
    {(!!Object.keys(patch).length || pending) && <button type="button" disabled={disabled || busy || !valid} onClick={() => void save()} className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-50">{busy ? "Applying…" : Object.keys(patch).length ? "Save capabilities" : "Retry applying to agents"}</button>}
    {(error || pending) && <p role="alert" className="text-xs text-red">{error || `Defaults saved; updates pending: ${(connection.runtime_config.builtin_sync.errors || []).join("; ")}`}</p>}{notice && <p role="status" className="text-xs text-text-muted">{notice}</p>}
  </div>;
}
