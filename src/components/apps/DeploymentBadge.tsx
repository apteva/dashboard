import type { AppRow, DeploymentSummary } from "../../api";
export function deploymentLabel(app: AppRow): string {
 const d=app.deployment; return d?.type==="backend" ? `${d.backend_name || d.backend?.backend_id || "Remote"} · ${d.target_name || d.target.resource_id}` : "This Server";
}
export function deploymentMatches(app: AppRow, location: string, backend: string, target: string): boolean {
 const d=app.deployment,remote=d?.type==="backend";
 return (!location || (location==="remote" ? remote : !remote)) && (!backend || !!(d?.backend && `${d.backend.app_install_id}:${d.backend.backend_id}`===backend)) && (!target || !!(d?.target && `${d.target.app_install_id}:${d.target.resource_type}:${d.target.resource_id}`===target));
}
// Process health and work admission are separate facts: "running" is a live
// process whose app does not report admission, "healthy" is admitting work.
export function deploymentStatusText(d: DeploymentSummary): string {
 const a=d.admission_state;
 return (d.state==="running" || d.state==="degraded") && a && a!=="active" ? `${d.state} · admission ${a}` : d.state;
}
export function deploymentAdmissionLabel(d?: DeploymentSummary): string {
 const a=d?.admission_state;
 if (!d?.managed || !a || d.state==="deploying" || d.state==="stopped") return "";
 if (d.state==="healthy" && a==="active") return "Accepting new work";
 if (d.state==="running" && a==="unknown") return "Not reported by the app";
 if (a==="unknown" || d.state==="unknown" || d.state==="unavailable") return "Unknown";
 return `Not accepting new work (${a})`;
}
export function DeploymentBadge({app,onClick}:{app:AppRow;onClick?:()=>void}) {
 const d=app.deployment, state=d?.state || "";
 const tone=["unavailable","degraded","fenced","error"].includes(state) ? "border-red/40 text-red" : state==="unknown" ? "border-yellow/40 text-yellow" : "border-border text-text-muted hover:border-accent";
 return <button type="button" title={[deploymentLabel(app),d?.message,d?.checked_at ? `Last checked ${new Date(d.checked_at).toLocaleString()}` : ""].filter(Boolean).join(" · ")} onClick={e=>{e.stopPropagation();if(onClick)onClick();else window.dispatchEvent(new CustomEvent("apteva:open-deployment",{detail:{installId:app.install_id}}));}} className={`w-fit max-w-56 truncate rounded border px-1.5 py-0.5 text-left text-[10px] ${tone}`} aria-label={`Deployment: ${deploymentLabel(app)}`}>
  {deploymentLabel(app)}{d?.managed && d.state ? ` · ${deploymentStatusText(d)}` : ""}
 </button>;
}
