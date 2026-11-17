import { useState, useEffect } from "react";
import { integrations, type AppDetail, type AppManifestV2, type AppConfigField, type PreflightRole, type PreflightConnectionCandidate, type PreflightAppCandidate, type AppBindingValue } from "../../api";
import { AppDiscoverySelect } from "./AppDiscoverySelect";
import { CredentialValueInput } from "../integrations/CredentialFields";
export type RoleIntent =
  | { kind: "connect"; slug: string; name: string; creds: Record<string, string>; authType: string }
  | { kind: "install_app"; manifestUrl: string; appName: string }
  // "connect_integration" is the placeholder optedIn state for an
  // optional kind=integration role with no existing candidates. We
  // can't set a value yet (the connection doesn't exist) and there's
  // no work to defer to the parent Install handler — the inline
  // <InlineConnectIntegration> form below creates the connection
  // synchronously and replaces this with a real value via onChange.
  // Without this kind, the checkbox visually toggles but the
  // controlled `checked={optedIn}` snaps it right back to false.
  | { kind: "connect_integration" };

export function bindingIDs(value: AppBindingValue | undefined): number[] {
  if (value == null) return [];
  if (typeof value === "number") return value > 0 ? [value] : [];
  return Array.isArray(value.ids) ? value.ids.filter((id) => id > 0) : [];
}

export function bindingDefaultID(value: AppBindingValue | undefined): number | undefined {
  const ids = bindingIDs(value);
  if (ids.length === 0) return undefined;
  if (value && typeof value === "object" && value.default_id && ids.includes(value.default_id)) {
    return value.default_id;
  }
  return ids[0];
}

export function hasBindingSelection(value: AppBindingValue | undefined): boolean {
  return bindingIDs(value).length > 0;
}

export function multiBinding(ids: number[], defaultID?: number): AppBindingValue {
  const unique = Array.from(new Set(ids.filter((id) => id > 0)));
  if (unique.length === 0) return null;
  const chosenDefault = defaultID && unique.includes(defaultID) ? defaultID : unique[0];
  return { ids: unique, default_id: chosenDefault };
}

export function addBindingSelection(value: AppBindingValue | undefined, id: number, multiple: boolean): AppBindingValue {
  if (!multiple) return id;
  return multiBinding([...bindingIDs(value), id], bindingDefaultID(value) || id);
}

// RolePicker — one row per requires.integrations entry. Three states:
//
//   1. has candidates → select (auto-picked first one)
//   2. no candidates, kind=integration → inline credential form;
//      typing fields STORES an intent on the parent — the actual
//      /connections POST fires only when the main Install button
//      is clicked
//   3. no candidates, kind=app → opting in stores an install intent;
//      the dep app is installed before the parent on Install click
//
// Visual: subtle border in all states (no yellow highlight); the
// required/optional pill is the only emphasis on importance.
export function RolePicker({
  role,
  value,
  onChange,
  intent,
  setIntent,
  projectId,
  onConnected,
  compact = false,
  expanded = false,
  onToggleExpanded,
}: {
  role: PreflightRole;
  value: AppBindingValue;
  onChange: (v: AppBindingValue) => void;
  intent: RoleIntent | null;
  setIntent: (i: RoleIntent | null) => void;
  projectId?: string;
  onConnected: (connId: number) => void;
  compact?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const cands =
    role.kind === "integration" ? role.integration_candidates || [] : role.app_candidates || [];
  const multiple = role.mode === "multiple";
  const hasCands = cands.length > 0;
  const optedIn = !role.required && (hasBindingSelection(value) || intent != null);
  // kind=integration: synchronous Connect button before parent install
  // kind=app: stores an intent, parent install handler resolves it
  const showCredentialForm =
    role.kind === "integration" && !hasCands && (role.required || optedIn);
  const showAppOptInHint =
    role.kind === "app" && !hasCands && (role.required || optedIn);

  const label = role.label || role.role;
  const showDetails = !compact || expanded;
  const selectedCandidate = cands.find((c) =>
    ("connection_id" in c ? c.connection_id : c.install_id) === bindingDefaultID(value),
  );
  const summary = optedIn
    ? selectedCandidate
      ? ("connection_id" in selectedCandidate ? selectedCandidate.name : selectedCandidate.display_name)
      : hasBindingSelection(value)
        ? "Connected"
      : intent?.kind === "install_app"
        ? `${intent.appName} will be installed`
        : "Connection needed"
    : role.hint || "Available if you want to connect it";

  return (
    <div className={`border border-border rounded p-3 ${showDetails ? "space-y-2" : "space-y-1"}`}>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {!role.required && (
          <label className="flex min-h-10 min-w-8 shrink-0 cursor-pointer items-center justify-center">
            <input
              type="checkbox"
              aria-label={`Include ${label}`}
              checked={optedIn}
              onChange={(e) => {
                if (e.target.checked) {
                  if (hasCands) {
                    const c = cands[0] as PreflightConnectionCandidate | PreflightAppCandidate;
                    const id = "connection_id" in c ? c.connection_id : c.install_id;
                    onChange(multiple ? multiBinding([id], id) : id);
                  } else if (role.kind === "app") {
                    // App installs run just before the parent install.
                    setIntent({
                      kind: "install_app",
                      manifestUrl: "",
                      appName: (role.compatible || [])[0] || "",
                    });
                  } else {
                    // Show the inline connection form before install.
                    setIntent({ kind: "connect_integration" });
                  }
                } else {
                  onChange(null);
                  setIntent(null);
                }
              }}
              className="size-5 accent-accent"
            />
          </label>
        )}
        <span className="min-w-0 flex-1 truncate text-text font-medium" title={label}>{label}</span>
        <span className="shrink-0 text-text-dim text-[10px] uppercase tracking-wide">
          {role.required ? "required" : optedIn ? "selected" : "optional"}
        </span>
        {!compact && role.capabilities && role.capabilities.length > 0 && (
          <span className="ml-auto text-text-dim text-[10px] truncate" title={role.capabilities.join(", ")}>
            {role.capabilities.join(", ")}
          </span>
        )}
        {compact && (
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={`install-role-${role.role}`}
            aria-label={`${expanded ? "Hide" : "Show"} ${label} details`}
            className="min-h-10 shrink-0 rounded px-1.5 text-[11px] text-accent hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {expanded ? "Less" : "Details"}
          </button>
        )}
      </div>

      {compact && !expanded && (
        <p className="truncate text-[11px] text-text-muted" title={summary}>{summary}</p>
      )}

      <div id={`install-role-${role.role}`} hidden={!showDetails} className="space-y-2">
        {role.hint && !showCredentialForm && !showAppOptInHint && (
          <div className="break-words text-text-muted text-[11px]">{role.hint}</div>
        )}

        {hasCands && (role.required || optedIn) && !multiple && (
          <select
            value={typeof value === "number" ? value : 0}
            onChange={(e) => onChange(Number(e.target.value) || null)}
            className="min-h-10 w-full bg-bg-input border border-border rounded px-2 py-1 text-xs text-text"
          >
            {role.kind === "integration"
              ? (role.integration_candidates || []).map((c) => (
                  <option key={c.connection_id} value={c.connection_id}>
                    {c.name} ({c.app_slug})
                    {c.scope === "global" ? " · global" : ""}
                  </option>
                ))
              : (role.app_candidates || []).map((c) => (
                  <option key={c.install_id} value={c.install_id}>
                    {c.display_name}
                  </option>
                ))}
          </select>
        )}

        {hasCands && (role.required || optedIn) && multiple && (
          <div className="space-y-2">
            <div className="grid gap-1.5">
              {cands.map((c) => {
                const id = "connection_id" in c ? c.connection_id : c.install_id;
                const selected = bindingIDs(value).includes(id);
                return (
                  <label
                    key={id}
                    className="flex min-h-10 items-center gap-2 text-xs text-text border border-border rounded px-2 py-1.5 bg-bg-input"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const ids = bindingIDs(value);
                        const next = e.target.checked ? [...ids, id] : ids.filter((x) => x !== id);
                        onChange(multiBinding(next, bindingDefaultID(value)));
                      }}
                    />
                    <span className="truncate">
                      {"connection_id" in c
                        ? `${c.name} (${c.app_slug}${c.scope === "global" ? " · global" : ""})`
                        : c.display_name}
                    </span>
                  </label>
                );
              })}
            </div>
            {bindingIDs(value).length > 1 && (
              <label className="grid gap-1 text-[11px] text-text-muted">
                Default
                <select
                  value={bindingDefaultID(value) || bindingIDs(value)[0] || 0}
                  onChange={(e) => onChange(multiBinding(bindingIDs(value), Number(e.target.value)))}
                  className="min-h-10 w-full bg-bg-input border border-border rounded px-2 py-1 text-xs text-text"
                >
                  {cands
                    .filter((c) => bindingIDs(value).includes("connection_id" in c ? c.connection_id : c.install_id))
                    .map((c) => {
                      const id = "connection_id" in c ? c.connection_id : c.install_id;
                      return (
                        <option key={id} value={id}>
                          {"connection_id" in c ? `${c.name} (${c.app_slug})` : c.display_name}
                        </option>
                      );
                    })}
                </select>
              </label>
            )}
          </div>
        )}

        {/* No candidates, kind=integration → embedded form with a Connect
            button that fires before the main install. */}
        {showCredentialForm && (
          <InlineConnectIntegration
            slugs={role.compatible || []}
            projectId={projectId}
            onConnected={onConnected}
          />
        )}

        {/* No candidates, kind=app → opting in queues an install_app
            intent; resolved when the user clicks the main Install. */}
        {showAppOptInHint && (
          <div className="text-text-muted text-[11px]">
            {(role.compatible || [])[0]} will be installed when you click Install.
          </div>
        )}
      </div>
    </div>
  );
}

// InlineConnectIntegration — embedded credential form with an
// explicit Connect button. The connection is created BEFORE the
// parent install fires (vs. the kind=app path which waits and
// installs the dep alongside the parent).
//
// Why split the two: connections often involve sensitive creds the
// operator wants to verify land + work before committing to the
// rest of the install. Once the connection exists in the project,
// the parent install proceeds with a clean binding. Apps (kind=app)
// don't have that round-trip — registry → install is a deterministic
// sequence with no per-call surprises, so bundling it into the
// parent Install button is the right call.
export function InlineConnectIntegration({
  slugs,
  projectId,
  onConnected,
}: {
  slugs: string[];
  projectId?: string;
  onConnected: (connId: number) => void;
}) {
  const [chosenSlug, setChosenSlug] = useState(slugs[0] || "");
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!chosenSlug) return;
    setDetail(null);
    integrations.app(chosenSlug)
      .then((d) => {
        setDetail(d);
        if (!name) setName(d.name);
      })
      .catch((e) => setError(e?.message || "load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenSlug]);

  const submit = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const types = detail.auth?.types || [];
      const authType = types.find((t) => t !== "oauth2") || types[0] || "api_key";
      const result = await integrations.connect(
        detail.slug,
        name.trim() || detail.name,
        creds,
        authType,
        projectId,
        undefined,
        "app_install",
      );
      const conn = result as { id?: number; connection?: { id: number } };
      const id = conn.id || conn.connection?.id;
      if (!id) {
        setError("connection created but id missing in response");
        return;
      }
      onConnected(id);
    } catch (e: any) {
      setError(e?.message || "connect failed");
    } finally {
      setBusy(false);
    }
  };

  if (!detail) {
    return <div className="text-text-dim text-[11px]">Loading {chosenSlug}…</div>;
  }
  if (!detail.auth?.credential_fields?.length || detail.auth?.types?.some(t => t === "oauth2" || t === "oauth_device_code" || t.startsWith("oauth"))) {
    return (
      <div className="space-y-2 text-text-muted text-xs">
        {slugs.length > 1 && <select aria-label="Provider" value={chosenSlug} onChange={e => setChosenSlug(e.target.value)} className="min-h-11 w-full rounded border border-border bg-bg-input px-2">{slugs.map(slug => <option key={slug} value={slug}>{slug}</option>)}</select>}
        {detail.name} uses the guided connection flow. <a href={`/integrations?setup_connection=${encodeURIComponent(chosenSlug)}&setup_project=${encodeURIComponent(projectId || "")}`} target="_blank" rel="noreferrer" className="text-accent underline">Open Integrations ↗</a>, connect your account, then return here and refresh connections.
      </div>
    );
  }

  return (
    <div className="bg-bg-input border border-border rounded p-2 space-y-2">
      {slugs.length > 1 && (
        <select
          value={chosenSlug}
          onChange={(e) => setChosenSlug(e.target.value)}
          className="min-h-10 w-full bg-bg border border-border rounded px-2 py-1 text-xs"
        >
          {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <div className="text-[11px] text-text-muted">
        Credentials for {detail.name} — encrypted server-side, never sent to the app process.
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="connection name"
        className="min-h-10 w-full bg-bg border border-border rounded px-2 py-1 text-xs"
      />
      {detail.auth.credential_fields.map((f) => (
        <div key={f.name}>
          <label className="text-text-dim text-[10px]">{f.label || f.name}</label>
          <CredentialValueInput
            field={f}
            value={creds[f.name] || ""}
            onChange={(value) => setCreds({ ...creds, [f.name]: value })}
            className="min-h-10 w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
          />
          {f.description && <div className="text-text-dim text-[10px] mt-0.5">{f.description}</div>}
        </div>
      ))}
      {error && <div className="text-red text-[10px]">{error}</div>}
      <button
        onClick={submit}
        disabled={busy}
        className="min-h-11 w-full px-2 py-1 text-xs bg-accent text-bg rounded font-bold disabled:opacity-50"
      >
        {busy ? "Connecting…" : `Connect ${detail.name}`}
      </button>
    </div>
  );
}

export function requiredConfigFields(
  manifest: AppManifestV2,
  bindings: Record<string, AppBindingValue>,
): AppConfigField[] {
  const out: AppConfigField[] = [];
  for (const f of manifest.config_schema || []) {
    if (f.required) {
      out.push(f);
      continue;
    }
    if (f.required_if_role_bound) {
      const v = bindings[f.required_if_role_bound];
      if (hasBindingSelection(v)) out.push(f);
    }
  }
  return out;
}

export function RequiredConfigFields({
  manifest,
  bindings,
  config,
  setConfig,
}: {
  manifest: AppManifestV2;
  bindings: Record<string, AppBindingValue>;
  config: Record<string, string>;
  setConfig: (c: Record<string, string>) => void;
}) {
  const fields = requiredConfigFields(manifest, bindings);
  if (fields.length === 0) return null;

  const update = (name: string, val: string) =>
    setConfig({ ...config, [name]: val });

  return (
    <div className="border border-border rounded p-3 space-y-3">
      <div className="text-text-muted text-xs">Configuration</div>
      {fields.map((f) => {
        const value = config[f.name] ?? f.default ?? "";
        const label = f.label || f.name;
        return (
          <div key={f.name} className="space-y-1">
            <label className="text-text text-xs flex items-center gap-2">
              <span>{label}</span>
              <span className="text-red text-[10px]">required</span>
            </label>
            <ConfigFieldInput
              field={f}
              value={value}
              onChange={(v) => update(f.name, v)}
              bindings={bindings}
            />
            {f.description && (
              <div className="text-text-dim text-[11px]">{f.description}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ConfigFieldInput dispatches on f.type. Unknown types fall back to
// a plain text input so a future manifest with a new type doesn't
// hard-crash an older dashboard — it just downgrades to manual entry.
export function ConfigFieldInput({
  field,
  value,
  onChange,
  bindings,
  projectId,
  roles,
}: {
  field: AppConfigField;
  value: string;
  onChange: (v: string) => void;
  bindings: Record<string, AppBindingValue>;
  projectId?: string;
  roles?: PreflightRole[];
}) {
  const boundID = field.app_role ? bindingDefaultID(bindings[field.app_role]) : undefined;
  const boundName = field.app_role ? roles?.find(r => r.role === field.app_role)?.app_candidates?.find(c => c.install_id === boundID)?.app_name : undefined;
  switch (field.type) {
    case "secret":
    case "password":
      return (
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-10 w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        />
      );
    case "select":
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-10 w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        >
          <option value="">(choose…)</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "select_from_integration":
      return (
        <IntegrationDiscoverySelect
          field={field}
          value={value}
          onChange={onChange}
          connectionId={
            field.integration_role ? bindingDefaultID(bindings[field.integration_role]) ?? null : null
          }
        />
      );
    case "select_from_app":
      return (
        <AppDiscoverySelect
          field={{...field, app: boundName || field.app}}
          installId={boundID}
          projectId={projectId}
          requiresBinding={!!field.app_role}
          value={value}
          onChange={onChange}
        />
      );
    case "bool":
    case "boolean":
    case "toggle":
      return (
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
      );
    case "text":
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-10 w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        />
      );
  }
}

// IntegrationDiscoverySelect — type=select_from_integration. Reads
// the connection bound to field.integration_role, fires
// discovery.tool against it, parses the response per response_path,
// renders a <select>. On any failure (no binding, upstream 4xx/5xx,
// empty result) AND field.fallback === "text", collapses to a
// regular text input with an info banner so the operator can
// type the value manually. The most common failure mode in the
// wild is bucket-scoped tokens that can't list_buckets — we hit
// that against R2 in v0.13 — so the manual-fallback path is the
// expected branch, not the unhappy one.
function IntegrationDiscoverySelect({
  field,
  value,
  onChange,
  connectionId,
}: {
  field: AppConfigField;
  value: string;
  onChange: (v: string) => void;
  connectionId: number | null | undefined;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    setOptions(null);
    setErr("");
    if (!connectionId || !field.discovery?.tool) return;
    setLoading(true);
    integrations
      .execute(connectionId, field.discovery.tool, {})
      .then((res) => {
        if (!res.success) {
          // Pull the response body into a string for two purposes:
          //   1. Pattern-match S3-compat AccessDenied so we can show
          //      a friendly "your token is bucket-scoped" message
          //      instead of the raw "HTTP 403" the operator can't act
          //      on. This is the v0.13 health-check insight applied at
          //      install time — same Cloudflare R2 token that returns
          //      ✓ green on the connection Test button (because the
          //      catalog's auth_ok_when_body_contains absorbs it) will
          //      land here at install time too. Don't auto-pass;
          //      list_buckets actually CAN'T list, so the dropdown
          //      really does need to fall back to manual entry. Just
          //      make the explanation legible.
          //   2. Include the upstream's literal error in the
          //      tooltip when it isn't AccessDenied — operators
          //      shouldn't have to dig through server logs to
          //      learn it was, say, an InvalidAccessKeyId typo.
          const body = stringifyExecuteData(res.data);
          if (res.status === 403 && /AccessDenied|access[\s_-]?denied/i.test(body)) {
            throw new Error(
              "your token can't list (bucket-scoped) — type the bucket name below",
            );
          }
          if (res.status === 401) {
            throw new Error("auth rejected (HTTP 401) — check the connection's credentials");
          }
          const trim = body.length > 120 ? body.slice(0, 120) + "…" : body;
          throw new Error(`HTTP ${res.status}: ${trim}`);
        }
        const items = pluckList(res.data, field.discovery?.response_path || "");
        const opts = items.map((it) => {
          const v = pluckField(it, field.discovery?.value_field || "");
          const l = pluckField(it, field.discovery?.label_field || "");
          return { value: v, label: l || v };
        }).filter((o) => o.value !== "");
        setOptions(opts);
      })
      .catch((e) => {
        setErr(e?.message || "discovery failed");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, field.discovery?.tool]);

  // No binding yet: nudge the operator to bind first.
  if (!connectionId) {
    return (
      <div className="text-text-dim text-[11px] italic">
        Bind an integration above to populate this list.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-text-dim text-[11px]">Loading options…</div>
    );
  }

  // Discovery failed (auth scope, network, malformed response) —
  // fall back to text input if the catalog opted in.
  const hasOptions = options && options.length > 0;
  const showFallback = !hasOptions && field.fallback === "text";

  if (showFallback) {
    // Order: explain WHY first (so the operator reads context before
    // the empty input box), then the input, then a tiny secondary
    // hint. Pre-fix this rendered input-then-warning, which on a
    // freshly-bound R2 looked like an empty form with a yellow
    // line below — easy to miss the input field entirely.
    return (
      <>
        <div className="text-yellow text-[11px] leading-snug">
          {err
            ? `Couldn't auto-list options: ${err}.`
            : "No options returned — enter the value manually."}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            field.name === "s3_bucket"
              ? "my-bucket-name"
              : "value"
          }
          className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
          autoFocus
        />
      </>
    );
  }

  if (!hasOptions) {
    // No fallback declared. Show the error and disable.
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


// stringifyExecuteData renders the integration runner's response
// `data` field as a string we can substring-match for error
// patterns (AccessDenied, InvalidAccessKeyId, etc.). The runner
// returns either a parsed object (JSON APIs), a parsed map (XML
// → S3-style), or an already-stringified body. We coerce to
// string defensively so the discovery error path can pattern-
// match without caring about the upstream's content type.
function stringifyExecuteData(data: any): string {
  if (data == null) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

// pluckList walks a JSON path through `data`, returning whatever's
// at the end as an array. Path uses "." to descend object keys;
// missing keys → []. The runner's response shape is the integration
// tool's literal response (parsed JSON for REST, parsed XML for
// S3-style services), so we deliberately don't normalise — the
// catalog author writes the path matching the literal upstream
// response. Empty path = use `data` itself.
function pluckList(data: any, path: string): any[] {
  if (!path) {
    return Array.isArray(data) ? data : [];
  }
  let cur: any = data;
  for (const seg of path.split(".")) {
    if (cur == null) return [];
    cur = cur[seg];
  }
  if (cur == null) return [];
  return Array.isArray(cur) ? cur : [cur]; // single-item upstreams sometimes drop the array wrapper
}

// pluckField extracts one named field from an item; empty path
// returns the item itself if it's a string. Mirrors the lenient
// shape the catalog authors expect.
function pluckField(item: any, field: string): string {
  if (!field) {
    return typeof item === "string" ? item : "";
  }
  const v = item?.[field];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
