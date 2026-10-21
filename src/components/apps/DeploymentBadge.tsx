import type { AppRow } from "../../api";
export function deploymentLabel(app: AppRow): string {
 const d=app.deployment; return d?.type==="backend" ? `${d.backend_name || d.backend?.backend_id || "Remote"} · ${d.target_name || d.target.resource_id}` : "This Server";
}
export function deploymentMatches(app: AppRow, location: string, backend: string, target: string): boolean {
 const d=app.deployment,remote=d?.type==="backend";
 return (!location || (location==="remote" ? remote : !remote)) && (!backend || !!(d?.backend && `${d.backend.app_install_id}:${d.backend.backend_id}`===backend)) && (!target || !!(d?.target && `${d.target.app_install_id}:${d.target.resource_type}:${d.target.resource_id}`===target));
}
export function DeploymentBadge({app,onClick}:{app:AppRow;onClick?:()=>void}) {
 const d=app.deployment, bad=["unavailable","degraded","fenced","error"].includes(d?.state || "");
 return <button type="button" title={[deploymentLabel(app),d?.message,d?.checked_at ? `Last checked ${new Date(d.checked_at).toLocaleString()}` : ""].filter(Boolean).join(" · ")} onClick={e=>{e.stopPropagation();if(onClick)onClick();else window.dispatchEvent(new CustomEvent("apteva:open-deployment",{detail:{installId:app.install_id}}));}} className={`w-fit max-w-56 truncate rounded border px-1.5 py-0.5 text-left text-[10px] ${bad?"border-red/40 text-red":"border-border text-text-muted hover:border-accent"}`} aria-label={`Deployment: ${deploymentLabel(app)}`}>
  {deploymentLabel(app)}{d?.managed && d.state ? ` · ${d.state}` : ""}
 </button>;
}
