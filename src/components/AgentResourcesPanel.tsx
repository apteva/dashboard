import { useEffect, useState } from "react";
import { agentResources, type AgentResourceStatus, type AppResourcePolicy } from "../api";
import { ProcessResourceEditor } from "./apps/AppResourcesPanel";

export function AgentResourcesPanel({agentId}:{agentId:number}) { return <AgentResourceEditor key={agentId} agentId={agentId}/>; }
function AgentResourceEditor({agentId}:{agentId:number}) {
 const [status,setStatus]=useState<AgentResourceStatus|null>(null);
 const [policy,setPolicy]=useState<AppResourcePolicy>({});
 const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;agentResources.get(agentId).then(next=>{if(active){setStatus(next);setPolicy(next.policy)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[agentId]);
 const save=async()=>{if(!status||busy)return;setBusy(true);setError("");try{const next=await agentResources.save(agentId,status.revision,policy);setStatus(next);setPolicy(next.policy)}catch(e){setError(e instanceof Error?e.message:"Could not save CPU priority")}finally{setBusy(false)}};
 const inspect=async()=>{setError("");try{const next=await agentResources.get(agentId);setStatus(current=>current?{...current,observed:next.observed,state:next.state,supported:next.supported,capabilities:next.capabilities}:next)}catch(e){setError(e instanceof Error?e.message:"Could not inspect resources")}};
 const labels:Record<string,string>={unsupported:"Unsupported on this host",stopped:"Agent stopped",unavailable:"Effective settings unavailable",inherited_shared:"Shared inherited group",pending_restart:"Pending restart",applied:"Matches requested weight"};
 return <details className="rounded border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">CPU priority · advanced</summary>
 {error&&<p role="alert" className="mt-2 text-xs text-red">{error}</p>}
 {!status&&!error&&<p className="text-xs text-text-muted">Loading resource settings…</p>}
 {status&&<div className="mt-3 space-y-3">
 <p className="text-xs text-text-muted">Relative CPU share under contention for this agent and its subprocesses. Empty inherits the host default; 100 is ordinary, 200 is higher priority. This does not reserve CPU or accelerate the model provider.</p>
 <ProcessResourceEditor cpuOnly disabled={busy||!status.supported} value={policy} onChange={setPolicy}/>
 <p className="text-xs">{labels[status.state]||status.state}. Requested: {status.policy.process?.cpu_weight ?? "Inherited"}. Observed: {status.observed?.["cpu.weight"] ?? "Unknown"}.</p>
 <p className="text-xs text-text-muted">{status.note}</p>
 <div className="flex flex-wrap gap-3"><button type="button" className="text-xs text-accent" disabled={busy||(!status.supported&&!!policy.process?.cpu_weight)} onClick={()=>void save()}>{busy?"Saving…":"Save for next restart"}</button><button type="button" className="text-xs text-accent" disabled={busy} onClick={()=>setPolicy({})}>Use host default</button><button type="button" className="text-xs text-accent" disabled={busy} onClick={()=>void inspect()}>Refresh observed settings</button></div>
 <details className="text-xs"><summary>Host limits and diagnostics</summary><p className="text-text-muted">Pressure and throttling are cumulative counters, not audio-delay measurements. Ancestor CPU quotas can still constrain this process.</p><pre className="overflow-auto">{JSON.stringify({observed:status.observed,capabilities:status.capabilities},null,2)}</pre></details>
 </div>}</details>;
}
