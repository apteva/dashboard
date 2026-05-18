// AppDiscoverySelect — type=select_from_app config field renderer.
//
// Fetches options from a sibling app's HTTP route over the dashboard's
// same-origin session, then renders a <select>. Used at install time
// (InstallModal's renderConfigField in Apps.tsx) AND post-install
// (SettingsSection's FieldRow). Lived inline in Apps.tsx originally;
// extracted so both call sites can share it without duplication.
//
// Failure semantics mirror IntegrationDiscoverySelect: on any error
// AND field.fallback === "text", collapse to a plain text input
// with a one-line warning explaining what went wrong. The common
// failure mode is the named sibling app not being installed yet
// (404 from the fetch) — surfaced explicitly so the operator knows
// what to install.
//
// The fetch goes to /api/apps/{field.app}{field.discovery.route}.
// The route must be something the app exposes on its HTTPRoutes()
// surface — typically a list endpoint already used by the app's own
// panel.

import { useEffect, useState } from "react";

export interface AppDiscoveryField {
  name?: string;
  app?: string;
  fallback?: "text" | "";
  discovery?: {
    route?: string;
    response_path?: string;
    value_field?: string;
    label_field?: string;
  };
}

export function AppDiscoverySelect({
  field,
  value,
  onChange,
}: {
  field: AppDiscoveryField;
  value: string;
  onChange: (v: string) => void;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    setOptions(null);
    setErr("");
    if (!field.app || !field.discovery?.route) return;
    setLoading(true);
    const url = `/api/apps/${field.app}${field.discovery.route}`;
    fetch(url, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) {
          let body = "";
          try {
            body = await r.text();
          } catch {
            /* ignore */
          }
          if (r.status === 404) {
            throw new Error(
              `${field.app} app not installed — install it first to populate this list`,
            );
          }
          const trim = body.length > 120 ? body.slice(0, 120) + "…" : body;
          throw new Error(`HTTP ${r.status}: ${trim}`);
        }
        const data = await r.json();
        const items = pluckList(data, field.discovery?.response_path || "");
        const opts = items
          .map((it) => {
            const v = pluckField(it, field.discovery?.value_field || "");
            const l = pluckField(it, field.discovery?.label_field || "");
            return { value: v, label: l || v };
          })
          .filter((o) => o.value !== "");
        setOptions(opts);
      })
      .catch((e) => {
        setErr(e?.message || "discovery failed");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.app, field.discovery?.route]);

  if (loading) {
    return <div className="text-text-dim text-[11px]">Loading options…</div>;
  }

  const hasOptions = options && options.length > 0;
  const showFallback = !hasOptions && field.fallback === "text";

  if (showFallback) {
    return (
      <>
        <div className="text-yellow text-[11px] leading-snug">
          {err
            ? `Couldn't auto-list options: ${err}.`
            : `No options returned by ${field.app} — enter the value manually.`}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="value"
          className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        />
      </>
    );
  }

  if (!hasOptions) {
    return (
      <div className="text-red text-[11px]">
        {err || "No options returned by discovery."}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
    >
      <option value="">(choose…)</option>
      {options!.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// pluckList walks a JSON path through `data`, returning whatever's
// at the end as an array. Path uses "." to descend object keys;
// missing keys → []. Empty path = use `data` itself.
export function pluckList(data: unknown, path: string): unknown[] {
  if (!path) {
    return Array.isArray(data) ? data : [];
  }
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return [];
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur == null) return [];
  return Array.isArray(cur) ? cur : [cur];
}

// pluckField extracts one named field from an item; empty path
// returns the item itself if it's a string. Coerces numbers/booleans
// to string so the dropdown value can round-trip through the config
// store (which is string-keyed).
export function pluckField(item: unknown, field: string): string {
  if (!field) {
    return typeof item === "string" ? item : "";
  }
  if (item == null || typeof item !== "object") return "";
  const v = (item as Record<string, unknown>)[field];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
