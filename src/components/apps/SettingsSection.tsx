// SettingsSection — editable settings form for an installed app, rendered
// inside the app detail side panel (and reusable from a future gear-icon
// shortcut on the app's project.page).
//
// Reads the schema + current values from
//   GET /api/apps/installs/:installId/config →
//     { config: {...current values...}, schema: [{name,type,...}] }
// and writes back via
//   PUT /api/apps/installs/:installId/config
//     Body: { config: {...partial or full update...} }
//
// Tracks dirty state per-field; "Save" PUTs the changed subset, then
// reloads to confirm the server-side merge took. Schema-driven render
// means each new ConfigField type is one switch arm here — no per-app
// settings UI to maintain.

import { useEffect, useState } from "react";

interface SchemaField {
  name: string;
  label?: string;
  type?: string;
  description?: string;
  required?: boolean;
  default?: string;
  options?: string[];
}

interface Props {
  installId: number;
  /** Optional callback fired on a successful save — useful for the
   *  hosting panel to refresh derived data without re-mounting. */
  onSaved?: (config: Record<string, unknown>) => void;
}

export function SettingsSection({ installId, onSaved }: Props) {
  const [schema, setSchema] = useState<SchemaField[] | null>(null);
  const [original, setOriginal] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/apps/installs/${installId}/config`, { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { config: Record<string, unknown>; schema: SchemaField[] }) => {
        if (cancelled) return;
        setSchema(Array.isArray(data.schema) ? data.schema : []);
        setOriginal(data.config || {});
        setDraft(data.config || {});
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [installId]);

  const dirty = Object.keys(draft).some(
    (k) => JSON.stringify(draft[k]) !== JSON.stringify(original[k]),
  );

  const save = () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    // PUT only the changed subset — the server merges with the
    // existing config so a missing key isn't interpreted as "delete
    // this setting", just "leave it as-is".
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(draft)) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) {
        patch[k] = draft[k];
      }
    }
    fetch(`/api/apps/installs/${installId}/config`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: patch }),
    })
      .then((r) => {
        if (!r.ok) return r.text().then((t) => Promise.reject(new Error(t || `HTTP ${r.status}`)));
        return r.json();
      })
      .then((data: { config: Record<string, unknown> }) => {
        setOriginal(data.config || {});
        setDraft(data.config || {});
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1500);
        onSaved?.(data.config || {});
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Settings</h3>
        <div className="text-text-dim text-xs">Loading…</div>
      </section>
    );
  }
  if (error && !schema) {
    return (
      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Settings</h3>
        <div className="text-error text-xs">{error}</div>
      </section>
    );
  }
  if (!schema || schema.length === 0) {
    // No fields → no section. Avoid rendering a header with empty body.
    return null;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-text-muted text-xs uppercase tracking-wide">Settings</h3>
        {savedFlash && <span className="text-success text-[10px]">saved</span>}
      </div>
      <div className="flex flex-col gap-3">
        {schema.map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            value={draft[field.name]}
            onChange={(v) => setDraft((d) => ({ ...d, [field.name]: v }))}
          />
        ))}
      </div>
      {error && <div className="text-error text-xs mt-2">{error}</div>}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-3 py-1 text-xs rounded bg-accent text-bg font-medium disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => setDraft(original)}
            disabled={saving}
            className="px-3 py-1 text-xs rounded text-text-muted hover:text-text"
          >
            Discard
          </button>
        )}
      </div>
    </section>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const valStr = typeof value === "string" ? value : value == null ? "" : String(value);
  const placeholder = field.default || "";

  return (
    <label className="flex flex-col gap-1">
      <span className="text-text text-xs font-medium">
        {field.label || field.name}
      </span>
      {field.description && (
        <span className="text-text-dim text-[11px] leading-snug">{field.description}</span>
      )}
      {field.type === "select" && Array.isArray(field.options) ? (
        <select
          value={valStr}
          onChange={(e) => onChange(e.target.value)}
          className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent"
        >
          {!valStr && <option value="">{placeholder ? `default: ${placeholder}` : "Choose…"}</option>}
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "toggle" ? (
        <input
          type="checkbox"
          checked={value === true || value === "true"}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 self-start"
        />
      ) : field.type === "password" ? (
        <input
          type="password"
          value={valStr}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent"
        />
      ) : (
        <input
          type="text"
          value={valStr}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent"
        />
      )}
    </label>
  );
}
