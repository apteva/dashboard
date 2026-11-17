import { AppResourcesPanel } from "./AppResourcesPanel";
import { useEffect, useRef, useState } from "react";
import { appDeployments, type DeploymentDetail, type DeploymentPlacement } from "../../api";
import { useAuth } from "../../hooks/useAuth";
import { DeploymentPlacementEditor, deploymentSelectionReady } from "./DeploymentPlacementEditor";

export const deploymentPhaseLabel: Record<string, string> = { preparing:"Preparing package and target", building_package:"Building app package", delivering_package:"Uploading app package", inspecting_target:"Checking target", draining:"Waiting for active work to finish", stopping_previous:"Stopping previous execution", transferring_state:"Transferring app data", starting_candidate:"Starting replacement", committing:"Publishing deployment", retiring_previous:"Stopping previous execution", rolling_back:"Restoring previous execution", queued: "Queued", prepare: "Checking target and preparing package", package: "Preparing package", delivery: "Uploading package", prepared: "Package ready", starting: "Starting app", readiness: "Checking readiness", activate: "Activating app", commit: "Publishing deployment", retire: "Stopping previous execution", complete: "Complete", rollback: "Restoring previous execution", drain: "Waiting for active work to finish" };
const button = "min-h-10 rounded border border-border px-3 py-2 text-xs hover:border-accent disabled:opacity-50";
export function AppDeploymentPanel({ installId, projectId = "" }: { installId: number; projectId?: string }) {
  const { user } = useAuth(); const admin = !!user && user.role === "admin";
  const [detail, setDetail] = useState<DeploymentDetail | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [placement, setPlacement] = useState<DeploymentPlacement>({ type: "local" }), [logs, setLogs] = useState<string[] | null>(null), [logError, setLogError] = useState("");
  const [replicas,setReplicas]=useState(1);
  const pending = useRef(false), actionKey = useRef<{ action: string; payload: string; key: string } | null>(null), epoch = useRef(0);
  useEffect(() => {
    const seq = ++epoch.current; let timer: ReturnType<typeof setTimeout>, alive = true; let failures = 0;
    setDetail(null); setError(""); setEditing(false); setLogs(null); actionKey.current = null;
    const load = async () => { try { const r = await appDeployments.get(installId); if (alive && seq === epoch.current) { setDetail(r); setError(""); failures = 0; } } catch (e) { if (alive) { failures++; setError(e instanceof Error ? e.message : "Could not load deployment"); } } finally { if (alive) timer = setTimeout(load, Math.min(30000, 4000 * (failures + 1))); } };
    void load(); return () => { alive = false; clearTimeout(timer); epoch.current++; };
  }, [installId]);
  const refresh = async () => { const seq = epoch.current; const r = await appDeployments.get(installId); if (seq === epoch.current) { setDetail(r); window.dispatchEvent(new Event("apteva:apps-changed")); } };
  const action = async (kind: "deploy" | "activate" | "restart" | "stop" | "delete" | "discard") => {
    if (pending.current) return;
    if ((kind === "stop" || kind === "delete") && !window.confirm(kind === "stop" ? "Stop this app? Active work will drain before it stops. App data is retained." : "Remove this installation’s runtime resources? Persistent app data is retained. The host and unrelated apps are not removed.")) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (kind === "deploy") { const check = await appDeployments.preflight({ install_id: installId, project_id: projectId, placement }); if (!check.compatible) throw new Error(check.checks.filter(c => c.status === "blocked").map(c => `${c.name}: ${c.message}`).join("; ")); }
      const payload = kind === "deploy" ? JSON.stringify(placement) : "";
      if (actionKey.current?.action !== kind || actionKey.current.payload !== payload) actionKey.current = { action: kind, payload, key: crypto.randomUUID() };
      await appDeployments.action(installId, kind, kind === "deploy" ? placement : undefined, actionKey.current.key);
      actionKey.current = null; setEditing(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Deployment action failed"); } finally { setBusy(false); pending.current = false; }
  };
  const operationAction = async (op: string, retry: boolean) => { if (pending.current) return; pending.current = true; setBusy(true); try { if (retry) await appDeployments.retry(installId, op); else await appDeployments.cancel(installId, op); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); } finally { pending.current = false; setBusy(false); } };
  const activeOp = detail?.operations.find(o => o.status === "running" || o.status === "queued");
  const active = detail?.deployments.find(d => d.id === detail.active_deployment_id), summary = detail?.summary;
  return <section aria-label="App deployment" className="space-y-4">
    {error && <p role="alert" className="text-sm text-red">{error}</p>}
    {!detail && <p className="text-sm text-text-muted">Loading deployment…</p>}
    {detail && <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">Runs on</dt><dd>{summary?.type === "backend" ? `${summary.backend_name || summary.backend?.backend_id} · ${summary.target_name || summary.target.resource_id}` : "This Server"}</dd>
        <dt className="text-text-muted">Status</dt><dd>{summary?.state || "Unknown"}{summary?.message && <p className="mt-1 text-xs text-text-muted">{summary.message}</p>}</dd>
        {active && <><dt className="text-text-muted">Release</dt><dd>{active.manifest.version} · generation {active.generation}</dd></>}
        {summary?.checked_at && <><dt className="text-text-muted">Last checked</dt><dd>{new Date(summary.checked_at).toLocaleString()}</dd></>}
        {summary?.public_url && <><dt className="text-text-muted">Public URL</dt><dd><a className="break-all text-accent underline" href={summary.public_url} target="_blank" rel="noreferrer">{summary.public_url}</a></dd></>}
      </dl>
      {activeOp && <div role="status" className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm"><p>{deploymentPhaseLabel[activeOp.phase] || activeOp.phase} · {activeOp.kind}</p><p className="mt-1 text-xs text-text-muted">This operation continues if you leave this page.</p>{admin && <button type="button" disabled={busy} className={`${button} mt-2`} onClick={() => void operationAction(activeOp.id, false)}>Cancel operation</button>}</div>}
      {admin && <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || !!activeOp} onClick={() => { setPlacement(detail.placement || { type: "local" }); setEditing(v => !v); }}>{summary?.managed ? "Change deployment" : "Configure deployment"}</button>
        {summary?.managed && <><button type="button" className={button} disabled={busy || !!activeOp} onClick={() => void action("restart")}>{summary.state === "stopped" ? "Start" : "Restart / recover"}</button><button type="button" className={button} disabled={busy || !!activeOp || summary.state === "stopped"} onClick={() => void action("stop")}>Stop</button><button type="button" className={button} disabled={busy || !!activeOp} onClick={() => void action("delete")}>Remove runtime</button></>}
        {detail.pending_deployment_id && !activeOp && <><button type="button" className={button} disabled={busy} onClick={() => void action("activate")}>Activate prepared deployment</button><button type="button" className={button} disabled={busy} onClick={() => void action("discard")}>Discard candidate</button></>}
      </div>}
      {admin && detail.can_scale && <div className="flex flex-wrap items-center gap-2"><label className="text-xs">Replicas <input aria-label="Replica count" type="number" min={1} max={32} value={replicas} onChange={e=>setReplicas(Number(e.target.value))} className="w-16 rounded border border-border bg-bg-input p-2" /></label><button type="button" disabled={busy || !!activeOp || replicas<1 || replicas>32 || !Number.isInteger(replicas)} className={button} onClick={async()=>{setBusy(true);try{await appDeployments.scale(installId,replicas);await refresh()}catch(e){setError(e instanceof Error?e.message:"Scaling failed")}finally{setBusy(false)}}}>Scale replicas</button></div>}
      {editing && <><DeploymentPlacementEditor installId={installId} projectId={projectId} value={placement} onChange={setPlacement} runtimeKind={active?.manifest.runtime?.kind} publicRoutes={active ? !!active.manifest.runtime?.ingress : undefined} /><p className="text-xs text-text-muted">Placement changes use the existing deployment controller. Moving persistent state requires supported transfer capabilities. Exclusive updates temporarily interrupt service.</p><button type="button" className={button} disabled={busy || !!activeOp || !deploymentSelectionReady(placement)} onClick={() => void action("deploy")}>{busy ? "Checking…" : "Deploy"}</button></>}
      {admin && <AppResourcesPanel key={installId} installId={installId} />}
      <section aria-label="Deployment activity" className="space-y-2">
        <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Deployment activity</h4><span className="text-[10px] text-text-dim">UTC · newest first</span></div>
        <div className="max-h-96 overflow-auto rounded border border-border bg-bg-input font-mono text-[11px] leading-5" tabIndex={0} aria-label="Deployment activity log">
          {!detail.operations.length ? <p className="px-3 py-2 text-text-muted">No deployment activity yet.</p> : <div className="min-w-[580px]">
            <div className="sticky top-0 z-10 grid grid-cols-[8.5rem_4.5rem_5rem_minmax(0,1fr)_auto] gap-x-3 border-b border-border bg-bg-input px-3 py-1 text-[10px] uppercase tracking-wide text-text-dim"><span>Timestamp</span><span>Operation</span><span>Status</span><span>Phase / message</span><span /></div>
            <ol>{detail.operations.map(op => <li key={op.id} className="grid grid-cols-[8.5rem_4.5rem_5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border/40 px-3 py-1.5 last:border-b-0 hover:bg-bg-hover">
              <time dateTime={op.updated_at} title={new Date(op.updated_at).toLocaleString()} className="whitespace-nowrap text-text-dim">{Number.isNaN(Date.parse(op.updated_at)) ? "—" : new Date(op.updated_at).toISOString().slice(0,19).replace("T"," ")}</time>
              <span className="text-text">{op.kind}</span>
              <span className={op.status === "failed" ? "text-red" : op.status === "succeeded" ? "text-green" : op.status === "running" || op.status === "queued" ? "text-accent" : "text-text-dim"}>{op.status}</span>
              <span className="break-words text-text-muted">{deploymentPhaseLabel[op.phase] || op.phase}</span>
              {admin && op.status === "failed" && !activeOp ? <button type="button" disabled={busy} className="min-h-6 px-1 text-accent hover:underline disabled:opacity-50" aria-label={`Retry ${op.kind} operation`} onClick={() => void operationAction(op.id,true)}>Retry</button> : <span />}
              {op.error && <p className="col-span-4 col-start-2 whitespace-pre-wrap break-words text-red">{op.error}</p>}
            </li>)}</ol>
          </div>}
        </div>
      </section>
      {summary?.type === "backend" && <details onToggle={async e => { if (!e.currentTarget.open) return; try { const r = await appDeployments.logs(installId); setLogs(r.lines || []); setLogError(""); } catch (e) { setLogError(e instanceof Error ? e.message : "Logs unavailable"); } }}><summary className="cursor-pointer text-sm">Deployment logs</summary>{logError && <p className="mt-2 text-xs text-red">{logError}</p>}<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-bg-input p-3 text-xs">{logs?.join("\n") || "No log lines loaded."}</pre></details>}
    </>}
  </section>;
}
