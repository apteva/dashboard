import { useEffect, useRef, useState } from "react";
import { appDeployments, type DeploymentBackend, type DeploymentPlacement, type DeploymentPreflight, type DeploymentTarget } from "../../api";
import { useAuth } from "../../hooks/useAuth";

const input = "min-h-10 w-full rounded border border-border bg-bg-input px-3 py-2 text-sm";
export function deploymentSelectionReady(p?: DeploymentPlacement): boolean { return !p || p.type === "local" || !!(p.backend?.app_install_id && p.backend.backend_id && p.target?.resource_id && p.target.resource_type); }
export function BackendOptions({ schema, value, onChange }: { schema?: Record<string, any>; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const properties = schema?.properties || {};
  return <>{Object.entries(properties).filter(([key]) => !["artifact_id", "gateway_url", "endpoints", "browser_endpoint", "ingress"].includes(key)).map(([key, raw]) => {
    const f = raw as Record<string, any>, current = value[key] ?? f.default ?? "";
    if (f.type === "object" || f.type === "array") return <label key={key} className="block space-y-1 text-sm"><span>{f.title || key} (JSON)</span><textarea className={input} defaultValue={JSON.stringify(current || (f.type === "array" ? [] : {}), null, 2)} onBlur={e => { try { const parsed = JSON.parse(e.target.value); e.target.setCustomValidity(""); onChange({ ...value, [key]: parsed }); } catch { e.target.setCustomValidity("Enter valid JSON"); e.target.reportValidity(); } }} /></label>;
    return <label key={key} className="block space-y-1 text-sm"><span>{f.title || key}{schema?.required?.includes(key) ? " (required)" : ""}</span>{f.enum ? <select className={input} value={String(current)} onChange={e => onChange({ ...value, [key]: f.enum.find((v:unknown)=>String(v)===e.target.value) })}><option value="">Default</option>{f.enum.map((v: unknown) => <option key={String(v)}>{String(v)}</option>)}</select> : f.type === "boolean" ? <input type="checkbox" checked={Boolean(current)} onChange={e => onChange({ ...value, [key]: e.target.checked })} /> : <input className={input} type={f.type === "integer" || f.type === "number" ? "number" : "text"} min={f.minimum} max={f.maximum} value={String(current)} onChange={e => onChange({ ...value, [key]: f.type === "integer" || f.type === "number" ? Number(e.target.value) : e.target.value })} />}{f.description && <span className="block text-xs text-text-muted">{f.description}</span>}</label>;
  })}</>;
}
export function DeploymentPlacementEditor({ value, onChange, projectId = "", installId, manifestUrl, manifestYaml, runtimeKind, publicRoutes, onValidation }: {
  value?: DeploymentPlacement; onChange: (p: DeploymentPlacement) => void; projectId?: string; installId?: number; manifestUrl?: string; manifestYaml?: string; runtimeKind?: string; publicRoutes?: boolean; onValidation?: (v: DeploymentPreflight | null) => void;
}) {
  const { user } = useAuth(); const role = user && user.role;
  const currentValue = useRef(value); currentValue.current = value;
  const [backends, setBackends] = useState<DeploymentBackend[]>([]), [targets, setTargets] = useState<DeploymentTarget[]>([]);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [search, setSearch] = useState(""), [next, setNext] = useState("");
  const [checking, setChecking] = useState(false), [validation, setValidation] = useState<DeploymentPreflight | null>(null), [revision, setRevision] = useState(0);
  const [mapping, setMapping] = useState({ path: "", items: "", id_field: "id", name_field: "name", status_field: "status", ready_value: "ready", resource_type: "" });
  const generation = useRef(0);
  const remote = value?.type === "backend";
  const selected = backends.find(b => b.app_install_id === value?.backend?.app_install_id && b.id === value?.backend?.backend_id);
  const update = (p: DeploymentPlacement) => { setValidation(null); onValidation?.(null); onChange(p); };
  useEffect(() => { let alive = true; if (role !== "admin") return; appDeployments.backends().then(r => { if (alive) setBackends(r.backends.filter(b => !runtimeKind || b.capabilities.runtime_kinds.includes(runtimeKind))); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [role, runtimeKind, revision]);
  useEffect(() => {
    const seq = ++generation.current; setTargets([]); setNext(""); setSearch(""); setError(""); setLoading(false);
    if (!selected) return;
    setMapping(old => ({ ...old, resource_type: selected.capabilities.target_schema?.properties?.resource_type?.const || "" }));
    if (!selected.capabilities.target_listing && !selected.target_discovery) return;
    setLoading(true);
    appDeployments.targets({ app_install_id: selected.app_install_id, backend_id: selected.id }, projectId).then(r => { if (seq === generation.current) { setTargets(r.targets); setNext(r.next_cursor || ""); } }).catch(e => { if (seq === generation.current) setError(e.message); }).finally(() => { if (seq === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [selected?.app_install_id, selected?.id, projectId, revision]);
  if (role !== "admin") return <p className="text-xs text-text-muted">A platform administrator manages deployment placement.</p>;
  const loadTargets = async (cursor = "") => { if (!selected) return; const seq = ++generation.current; setLoading(true); setError(""); try { const r = await appDeployments.targets({ app_install_id: selected.app_install_id, backend_id: selected.id }, projectId, search, cursor); if (seq === generation.current) { setTargets(old => cursor ? [...old, ...r.targets] : r.targets); setNext(r.next_cursor || ""); } } catch (e) { if (seq === generation.current) setError(e instanceof Error ? e.message : "Target discovery failed"); } finally { if (seq === generation.current) setLoading(false); } };
  const validate = async () => { const snapshot = JSON.stringify(value); setChecking(true); setError(""); try { const result = await appDeployments.preflight({ install_id: installId, manifest_url: manifestUrl, manifest_yaml: manifestYaml, project_id: projectId, placement: value || { type: "local" } }); if (snapshot === JSON.stringify(currentValue.current)) { setValidation(result); onValidation?.(result); } } catch (e) { setError(e instanceof Error ? e.message : "Preflight failed"); } finally { setChecking(false); } };
  return <section aria-label="Deployment placement" className="space-y-3 rounded-lg border border-border p-3">
    <h4 className="text-sm font-semibold">Deployment</h4>
    <label className="block text-sm">Run on<select aria-label="Run on" className={`${input} mt-1`} value={remote ? `${value?.backend?.app_install_id || ""}:${value?.backend?.backend_id || ""}` : "local"} onChange={e => { const b = backends.find(b => `${b.app_install_id}:${b.id}` === e.target.value); update(b ? { type: "backend", backend: { app_install_id: b.app_install_id, backend_id: b.id } } : { type: "local" }); }}>
      <option value="local">This Server</option>{backends.map(b => <option key={`${b.app_install_id}:${b.id}`} value={`${b.app_install_id}:${b.id}`}>{b.display_name || b.id} · #{b.app_install_id}</option>)}
    </select></label>
    {!backends.length && !error && <p className="text-xs text-text-muted">Install a compatible execution app to deploy remotely.</p>}
    {remote && selected && <>
      {selected.capabilities.target_listing || selected.target_discovery ? <>
        <div className="flex gap-2"><input aria-label="Search deployment targets" className={input} placeholder="Search hosts or resources…" value={search} onChange={e => setSearch(e.target.value)} /><button type="button" className="shrink-0 text-xs text-accent" disabled={loading} onClick={() => void loadTargets()}>Search</button></div>
        <label className="block text-sm">Target<select aria-label="Deployment target" className={`${input} mt-1`} value={value?.target ? `${value.target.resource_type}:${value.target.resource_id}` : ""} disabled={loading} onChange={e => { const t = targets.find(t => `${t.ref.resource_type}:${t.ref.resource_id}` === e.target.value); update({ ...value!, target: t?.ref }); }}><option value="">{loading ? "Loading targets…" : "Choose a target…"}</option>{value?.target && !targets.some(t => t.ref.resource_id === value.target?.resource_id && t.ref.resource_type === value.target?.resource_type) && <option value={`${value.target.resource_type}:${value.target.resource_id}`}>{value.target.resource_id} · current target</option>}{targets.map(t => <option key={`${t.ref.resource_type}:${t.ref.resource_id}`} value={`${t.ref.resource_type}:${t.ref.resource_id}`} disabled={!t.available}>{t.name}{t.region ? ` · ${t.region}` : ""}{t.platform ? ` · ${t.platform}` : ""}{!t.available ? ` · ${t.reason || t.status || "Unavailable"}` : ""}</option>)}</select></label>
        {!loading && !targets.length && !error && <p className="text-xs text-text-muted">No matching targets. Create a host in the execution app, then refresh this list.</p>}
        {next && <button type="button" disabled={loading} className="text-xs text-accent" onClick={() => void loadTargets(next)}>Load more targets</button>}
      </> : <details className="text-sm"><summary>Configure target discovery for this backend</summary><p className="my-2 text-xs text-text-muted">This backend predates target listing. Map its existing private inventory GET route once; all app deployments can reuse it.</p>{Object.entries(mapping).map(([key, v]) => <label key={key} className="my-2 block text-xs">{key}<input className={input} value={v} onChange={e => setMapping(old => ({ ...old, [key]: e.target.value }))} /></label>)}<button type="button" className="text-accent" onClick={async () => { try { await appDeployments.register({ ...selected, target_discovery: mapping }); setRevision(r => r + 1); } catch (e) { setError(e instanceof Error ? e.message : "Could not save discovery"); } }}>Save target discovery</button></details>}
      {selected.capabilities.managed_ingress && publicRoutes !== false && <label className="block text-sm">Public domain (optional)<input aria-label="Public domain" className={`${input} mt-1`} placeholder="app.example.com" value={value?.ingress?.hostname || ""} onChange={e => update({ ...value!, ingress: e.target.value.trim() ? { ...value?.ingress, hostname: e.target.value.trim() } : undefined })} /><span className="mt-1 block text-xs text-text-muted">Server coordinates DNS and backend HTTPS for the app’s declared public routes.</span></label>}
      <details className="space-y-3 text-sm"><summary className="cursor-pointer">Advanced deployment settings</summary><BackendOptions schema={selected.capabilities.options_schema} value={value?.options || {}} onChange={options => update({ ...value!, options })} /><label className="block text-xs">Management gateway (automatic when empty)<input className={input} value={value?.gateway_url || ""} onChange={e => update({ ...value!, gateway_url: e.target.value || undefined })} /></label>{value?.ingress && <label className="block text-xs">DNS provider installation (automatic when empty)<input className={input} type="number" value={value.ingress.dns_app_install_id || ""} onChange={e => update({ ...value, ingress: { ...value.ingress!, dns_app_install_id: Number(e.target.value) || undefined } })} /></label>}</details>
    </>}
    {error && <p role="alert" className="text-xs text-red">{error} <button type="button" onClick={() => setRevision(r => r + 1)} className="underline">Retry discovery</button></p>}
    <button type="button" className="min-h-10 rounded border border-border px-3 text-xs disabled:opacity-50" disabled={checking || !deploymentSelectionReady(value) || (!installId && !manifestUrl && !manifestYaml)} onClick={() => void validate()}>{checking ? "Checking deployment…" : "Check deployment"}</button>
    {validation && <ul className="space-y-1 text-xs">{validation.checks.map((c, i) => <li key={i} className={c.status === "blocked" ? "text-red" : "text-text-muted"}>{c.name}: {c.message || (c.status === "passed" ? "Ready" : "Needs attention")}</li>)}</ul>}
  </section>;
}
