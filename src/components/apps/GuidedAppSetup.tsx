import { useEffect, useRef, useState } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { apps, appSetup, type AppPreflight, type AppSetupFeature, type AppSetupState, type AppSetupNode, type AppBindingValue, type PreflightRole } from "../../api";
import { RolePicker, InlineConnectIntegration, ConfigFieldInput, bindingIDs, addBindingSelection, type RoleIntent } from "./SetupFields";

type Frame = { key: number; label?: string; installId?: number; manifestURL?: string; preflight?: AppPreflight; projectId: string; feature?: string; parentRole?: string; onCreated?: (id: number) => void };
type Props = { onExitGuard?: (guard: () => boolean) => void; installId?: number; preflight?: AppPreflight; manifestURL?: string; projectId?: string; onInstalled?: () => void; onDone?: () => void };
const button = "min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-50";
async function jsonRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {method, credentials:"same-origin", headers:body ? {"Content-Type":"application/json"} : undefined, body:body ? JSON.stringify(body) : undefined});
  if (!res.ok) throw new Error((await res.text()).slice(0, 240) || `Request failed (${res.status})`);
  return res.json();
}
function featuresFor(pf: AppPreflight): AppSetupFeature[] {
  return pf.setup_features || pf.manifest.setup?.features || [{id:"essentials", label:"Basic setup", default:true, requires:pf.roles.filter(r=>r.required).map(r=>({role:r.role})), fields:(pf.manifest.config_schema || []).filter(f=>f.required).map(f=>f.name)}];
}
const statusLabels: Record<string,string> = {ready:"Ready",configured:"Configured · not verified",needs_setup:"Needs setup",pending:"Pending",error:"Check failed",not_enabled:"Not enabled"};
function StatusTree({nodes,onOpen,depth=0}:{nodes:AppSetupNode[];onOpen:(id:number,feature?:string)=>void;depth?:number}) {
  return <ul className={`space-y-2 ${depth ? "mt-2 border-l border-border pl-3" : ""}`}>
    {nodes.map((n,i)=><li key={`${n.install_id}:${n.feature_id}:${n.role}:${i}`} className="min-w-0 text-sm">
      <div className="flex flex-wrap items-center gap-x-2"><span className="font-medium">{n.label}</span><span className={`text-xs ${n.status==="ready" ? "text-success" : n.status==="needs_setup" || n.status==="error" ? "text-warn" : "text-text-muted"}`}>{statusLabels[n.status] || n.status}</span>
      {depth>0 && n.install_id && <button type="button" onClick={()=>onOpen(n.install_id!,n.feature_id)} className="min-h-9 text-xs text-accent">Configure →</button>}</div>
      {n.message && <p className="break-words text-xs text-text-muted">{n.message}</p>}
      {n.children?.length ? <StatusTree nodes={n.children} onOpen={onOpen} depth={depth+1}/> : null}
    </li>)}
  </ul>;
}

// Frames remain mounted while visiting a dependency. Credentials stay only in
// memory, and returning from app-owned setup refreshes readiness without
// replacing unsaved parent edits.
export function GuidedAppSetup(props: Props) {
  const [frames,setFrames]=useState<Frame[]>([{key:0,installId:props.installId,preflight:props.preflight,manifestURL:props.manifestURL,projectId:props.projectId || ""}]);
  const nextKey=useRef(1);
  const leaveStates=useRef(new Map<number,{busy:boolean;dirty:boolean}>());
  const [revision,setRevision]=useState(0);
  const [error,setError]=useState("");
  const current=frames[frames.length-1];
  const mayLeave=(keys:number[])=>{
    if(keys.some(key=>leaveStates.current.get(key)?.busy))return false;
    return !keys.some(key=>leaveStates.current.get(key)?.dirty) || window.confirm("Leave setup without saving your changes?");
  };
  useEffect(()=>{props.onExitGuard?.(()=>mayLeave(frames.map(f=>f.key)));return()=>props.onExitGuard?.(()=>true)},[frames,props.onExitGuard]);
  useEffect(()=>{
    const beforeUnload=(e:BeforeUnloadEvent)=>{if(frames.some(f=>leaveStates.current.get(f.key)?.dirty || leaveStates.current.get(f.key)?.busy)){e.preventDefault();e.returnValue=""}};
    window.addEventListener("beforeunload",beforeUnload);return()=>window.removeEventListener("beforeunload",beforeUnload);
  },[frames]);
  const push=async (frame:Omit<Frame,"key">) => {
    setError("");
    if (frames.length>=12 || frames.some(f=>frame.installId ? f.installId===frame.installId : !!frame.manifestURL && f.manifestURL===frame.manifestURL)) {setError("This setup would revisit an app already in the path. Finish its current setup first.");return}
    setFrames(old=>[...old,{...frame,key:nextKey.current++}]);
  };
  const back=()=>{if(!mayLeave([current.key]))return;leaveStates.current.delete(current.key);setFrames(old=>old.slice(0,-1));setRevision(r=>r+1);setError("")};
  return <div className="min-w-0 space-y-4">
    {frames.length>1 && <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3 text-xs text-text-muted"><button className="min-h-11 text-sm text-accent" onClick={back}>← Back to parent setup</button><span>{frames.map(f=>f.label || f.preflight?.manifest.display_name || "App setup").join(" → ")}</span></div>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {frames.map(frame=><div key={frame.key} hidden={frame.key!==current.key}>
      <SetupStep onLabel={label=>setFrames(old=>old.map(f=>f.key===frame.key && f.label!==label?{...f,label}:f))} reportState={state=>leaveStates.current.set(frame.key,state)} frame={frame} active={frame.key===current.key} revision={revision} onOpen={push}
        onCreated={id=>{setFrames(old=>old.map(f=>f.key===frame.key?{...f,installId:id}:f));frame.onCreated?.(id);props.onInstalled?.()}}
        onDone={()=>{if(frames.length>1){leaveStates.current.delete(current.key);setFrames(old=>old.slice(0,-1));setRevision(r=>r+1)}else props.onDone?.()}} />
    </div>)}
  </div>;
}

function SetupStep({frame,active,revision,onOpen,onCreated,onDone,reportState,onLabel}:{onLabel:(label:string)=>void;reportState:(state:{busy:boolean;dirty:boolean})=>void;frame:Frame;active:boolean;revision:number;onOpen:(f:Omit<Frame,"key">)=>Promise<void>;onCreated:(id:number)=>void;onDone:()=>void}) {
  const [pf,setPF]=useState<AppPreflight|null>(frame.preflight || null);
  const [installId,setInstallId]=useState(frame.installId);
  const [scope,setScope]=useState(frame.projectId);
  const [selected,setSelected]=useState<string[]>(()=>frame.preflight ? featuresFor(frame.preflight).filter(f=>f.default || f.id===frame.feature).map(f=>f.id) : []);
  const [bindings,setBindings]=useState<Record<string,AppBindingValue>>({});
  const [originalBindings,setOriginalBindings]=useState<Record<string,AppBindingValue>>({});
  const [config,setConfig]=useState<Record<string,string>>({});
  const [originalConfig,setOriginalConfig]=useState<Record<string,string>>({});
  const [savedSelected,setSavedSelected]=useState<string[] | null>(null);
  const [intents,setIntents]=useState<Record<string,RoleIntent|null>>({});
  const [state,setState]=useState<AppSetupState|null>(null);
  const [step,setStep]=useState(0);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(!frame.preflight);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [advanced,setAdvanced]=useState(false);
  const [connectRole,setConnectRole]=useState("");
  const loaded=useRef(false);
  const generation=useRef(0);
  const refresh=async (initial=false) => {
    const seq=++generation.current;
    if (!installId && !frame.manifestURL) return;
    try {
      const data=installId ? await apps.preflightInstalled(installId) : await apps.preflight(frame.manifestURL,undefined,scope);
      if(seq!==generation.current)return;
      setPF(data);onLabel(data.manifest.display_name || data.manifest.name);
      if(installId) {
        const result=await appSetup.get(installId,frame.feature);
        if(seq!==generation.current)return;
        setState(result);setScope(result.project_id);
        if(initial && !loaded.current) {
          const cfg=await jsonRequest<{config:Record<string,unknown>}>(`/api/apps/installs/${installId}/config`);
          if(seq!==generation.current)return;
          const values=Object.fromEntries(Object.entries(cfg.config || {}).map(([k,v])=>[k,v==null?"":String(v)]));
          setConfig(values);setOriginalConfig(values);
          setBindings(data.current_bindings || {});setOriginalBindings(data.current_bindings || {});
          setSelected(Array.from(new Set([...result.selected_features,...(frame.feature?[frame.feature]:[])])));
          setSavedSelected(result.selected_features);
          loaded.current=true;
        }
      }
      setError("");
    } catch(e) {if(seq===generation.current)setError(e instanceof Error?e.message:"Could not load setup")} finally {if(seq===generation.current)setLoading(false)}
  };
  useEffect(()=>{if(active && !busy)void refresh(!loaded.current);return()=>{generation.current++}},[active,revision,installId,scope,busy]);
  useEffect(()=>{
    if(!active || busy)return;
    const focus=()=>void refresh(!loaded.current);
    window.addEventListener("focus",focus);
    return()=>window.removeEventListener("focus",focus);
  },[active,installId,scope,busy]);
  useEffect(() => {
    if (!active || busy || !installId || !state || !["pending", "starting", "installing"].includes(state.install_status)) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [active, busy, installId, state?.install_status]);
  const dirty = (!!installId && loaded.current && savedSelected === null) || JSON.stringify(config)!==JSON.stringify(originalConfig) || JSON.stringify(bindings)!==JSON.stringify(originalBindings) || (savedSelected !== null && JSON.stringify(selected)!==JSON.stringify(savedSelected)) || (!installId && !!pf && JSON.stringify(selected)!==JSON.stringify(featuresFor(pf).filter(f=>f.default || f.id===frame.feature).map(f=>f.id)));
  reportState({busy,dirty});
  if(loading || !pf)return <div className="space-y-3"><p role={error?"alert":"status"}>{error || "Loading setup…"}</p>{error&&<button className={button} onClick={()=>void refresh(true)}>Retry</button>}</div>;
  const m=pf.manifest;
  const finish = () => { if (!dirty || window.confirm("Leave setup without saving your changes?")) onDone(); };
  const features=featuresFor(pf);
  const wanted=features.filter(f=>selected.includes(f.id));
  const requiredRoles=new Set(wanted.flatMap(f=>(f.requires || []).map(r=>r.role)));
  const requiredFields=new Set(wanted.flatMap(f=>f.fields || []));
  const visibleRoles=pf.roles.filter(r=>advanced || r.required || requiredRoles.has(r.role) || bindingIDs(bindings[r.role]).length);
  const fields=(m.config_schema || []).filter(f=>advanced || f.required || requiredFields.has(f.name) || (f.required_if_role_bound && bindingIDs(bindings[f.required_if_role_bound]).length));
  const baseBlockers=[...pf.roles.filter(r=>r.required&&!bindingIDs(bindings[r.role]).length).map(r=>`Connect ${r.label || r.role}`),...(m.config_schema || []).filter(f=>(f.required || (f.required_if_role_bound && bindingIDs(bindings[f.required_if_role_bound]).length)) && !(config[f.name]??f.default??"").trim()).map(f=>`Complete ${f.label || f.name}`)];
  const missingFeatureRequirements=visibleRoles.some(r=>requiredRoles.has(r.role)&&!bindingIDs(bindings[r.role]).length) || fields.some(f=>requiredFields.has(f.name)&&!(config[f.name]??f.default??"").trim());
  const openInstalled=(id:number,feature?:string)=>onOpen({installId:id,projectId:scope,feature});
  const installDependency=async (role:PreflightRole,name:string) => {
    setBusy(true);setError("");
    try {
      const catalog=await apps.marketplace();
      const entry=catalog.apps.find(a=>a.name===name&&!a.deprecated);
      if(!entry)throw new Error("This app is not available in the marketplace.");
      const child=await apps.preflight(entry.manifest_url,undefined,scope);
      if(!child.manifest.scopes.includes(scope?"project":"global"))throw new Error("This dependency cannot be installed at this scope. Choose a compatible existing installation.");
      const feature=wanted.flatMap(f=>f.requires || []).find(r=>r.role===role.role)?.feature;
      if (feature && !child.manifest.setup?.features.some(f => f.id === feature)) throw new Error(`This version of ${name} does not declare the required ${feature} setup feature. Update it first.`);
      await onOpen({preflight:child,manifestURL:entry.manifest_url,projectId:scope,feature,parentRole:role.role,onCreated:id=>setBindings(old=>({...old,[role.role]:addBindingSelection(old[role.role],id,role.mode==="multiple")}))});
    } catch(e){setError(e instanceof Error?e.message:"Could not open dependency setup")}finally{setBusy(false)}
  };
  const save=async()=>{
    setBusy(true);setError("");setNotice("");
    let id=installId;
    try {
      if(!id) {
        const result=await apps.install({manifestUrl:frame.manifestURL,projectId:scope,config,bindings});
        id=result.install_id;setInstallId(id);loaded.current=true;
        setOriginalBindings({...bindings});setOriginalConfig({...config});setSavedSelected(null);
        onCreated(id);
      }else{
        const patch=Object.fromEntries(Object.entries(bindings).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(originalBindings[k])));
        if(Object.keys(patch).length){const result=await apps.setBindings(id,patch);setOriginalBindings({...bindings});if(!result.respawned)throw new Error(`Connections saved, but the app could not restart: ${result.respawn_err || "try starting the app again"}`)}
        const patchConfig=Object.fromEntries(Object.entries(config).filter(([k,v])=>v!==originalConfig[k]));
        if(Object.keys(patchConfig).length){await jsonRequest(`/api/apps/installs/${id}/config`,"PUT",{config:patchConfig});setOriginalConfig({...config})}
      }
      await appSetup.save(id,selected);
      setSavedSelected([...selected]);
      const result=await appSetup.get(id,frame.feature);
      setState(result);setStep(3);setNotice("Setup saved. You can finish any remaining steps later.");
    }catch(e){setError(e instanceof Error?e.message:"Could not save setup")}finally{setBusy(false)}
  };
  return <div className="space-y-4">
    <header className="flex items-start gap-3"><AppIcon name={m.display_name || m.name} src={installId && m.icon?.startsWith("/") ? `/api/apps/${encodeURIComponent(m.name)}${m.icon}?install_id=${installId}${scope?`&project_id=${encodeURIComponent(scope)}`:""}` : m.icon?.startsWith("https://") ? m.icon : undefined} size="md"/><div className="min-w-0"><h3 className="text-base font-semibold">{m.display_name || m.name} setup</h3><p className="mt-1 text-sm text-text-muted">Choose what you want to use, then connect and configure it.</p></div></header>
    {installId && state?.install_status !== "running" && <p className="text-sm text-warn">App status: {state?.install_status || "Checking…"}. <a href="/apps" target="_blank" rel="noreferrer" className="text-accent underline">Open apps to manage it ↗</a></p>}
    {installId && <p className="rounded-lg border border-border p-3 text-xs text-text-muted">{state?.shared ? "Shared installation. Changes can affect other projects and apps using it." : "Changes apply to this installation, including other apps linked to it."}</p>}
    {!installId && m.scopes.length>1 && <label className="block text-sm">Install in<select disabled={busy || !!Object.keys(bindings).length} value={scope?"project":"global"} onChange={e=>setScope(e.target.value==="global"?"":frame.projectId)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg-input px-3"><option value="project" disabled={!frame.projectId}>Current project</option><option value="global">Shared across projects</option></select></label>}
    <nav aria-label="Setup steps" className="grid grid-cols-4 gap-1 border-b border-border pb-2">{["Features","Connections","Configure","Review"].map((label,i)=><button key={label} type="button" onClick={()=>setStep(i)} aria-current={step===i?"step":undefined} className={`min-h-11 rounded px-1 text-xs sm:text-sm ${step===i?"bg-accent/10 text-accent":"text-text-muted hover:bg-bg-hover"}`}>{i+1}. {label}</button>)}</nav>
    {dirty&&<p className="text-xs text-warn">Unsaved setup changes</p>}
    {error&&<p role="alert" className="text-sm text-error">{error}</p>}{notice&&<p role="status" className="text-sm text-text-muted">{notice}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-4">
    {step===0 && <div className="space-y-2">{features.map(f=><label key={f.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3"><input type="checkbox" className="mt-1 size-4 accent-accent" disabled={f.id===frame.feature} checked={selected.includes(f.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,f.id]:old.filter(id=>id!==f.id))}/><span className="min-w-0"><span className="block text-sm font-medium">{f.label}</span>{state?.nodes.find(n=>n.feature_id===f.id)&&<span className="block text-xs text-text-muted">{statusLabels[state.nodes.find(n=>n.feature_id===f.id)!.status]}</span>}{f.description&&<span className="mt-1 block text-xs text-text-muted">{f.description}</span>}{f.id===frame.feature&&<span className="mt-1 block text-xs text-accent">Needed by the parent app</span>}</span></label>)}<p className="text-xs text-text-muted">Features describe your setup choices. Turning one off here does not disconnect services or disable app tools.</p></div>}
    {step===1 && <div className="space-y-3">
      {!visibleRoles.length&&<p className="text-sm text-text-muted">No connections needed for these features.</p>}
      {visibleRoles.map(role=>{
        const why=wanted.filter(f=>f.requires?.some(r=>r.role===role.role));
        const feature=why.flatMap(f=>f.requires || []).find(r=>r.role===role.role)?.feature;
        return <section key={role.role} className="space-y-2 rounded-lg border border-border p-3">
          <h4 className="text-sm font-semibold">{role.label || role.role}</h4><p className="text-xs text-text-muted">{why.length?`Needed for ${why.map(f=>f.label).join(", ")}.`:role.required?"Required to install this app.":"Optional connection."} {role.hint}</p>
          {role.kind==="integration" ? <>
            <RolePicker role={{...role,required:role.required || requiredRoles.has(role.role)}} value={bindings[role.role]??null} onChange={v=>setBindings(old=>({...old,[role.role]:v}))} intent={intents[role.role]??null} setIntent={v=>setIntents(old=>({...old,[role.role]:v}))} projectId={scope} onConnected={id=>{setBindings(old=>({...old,[role.role]:addBindingSelection(old[role.role],id,role.mode==="multiple")}));void refresh()}} />
            {!!role.integration_candidates?.length&&<button className="min-h-9 text-xs text-accent" onClick={()=>setConnectRole(connectRole===role.role?"":role.role)}>Connect another account</button>}
            {connectRole===role.role&&<InlineConnectIntegration slugs={role.compatible || []} projectId={scope} onConnected={id=>{setBindings(old=>({...old,[role.role]:addBindingSelection(old[role.role],id,role.mode==="multiple")}));setConnectRole("");void refresh()}}/>}
          </> : <>
            {role.mode==="multiple" ? (role.app_candidates || []).map(c=><label key={c.install_id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={bindingIDs(bindings[role.role]).includes(c.install_id)} onChange={e=>setBindings(old=>({...old,[role.role]:e.target.checked?addBindingSelection(old[role.role],c.install_id,true):{ids:bindingIDs(old[role.role]).filter(id=>id!==c.install_id)}}))}/>{c.display_name || c.app_name} · {c.project_id === "" ? "Shared" : "Project"}</label>) : <select aria-label={role.label || role.role} value={bindingIDs(bindings[role.role])[0] || ""} onChange={e=>setBindings(old=>({...old,[role.role]:Number(e.target.value)||null}))} className="min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 text-sm"><option value="">Choose an installed app…</option>{bindingIDs(bindings[role.role]).filter(id=>!role.app_candidates?.some(c=>c.install_id===id)).map(id=><option key={id} value={id}>App #{id} · starting or unavailable</option>)}{(role.app_candidates || []).map(c=><option key={c.install_id} value={c.install_id}>{c.display_name || c.app_name} · {c.project_id === "" ? "Shared" : "Project"}</option>)}</select>}
            <div className="flex flex-wrap gap-2">{bindingIDs(bindings[role.role]).map(id=><button key={id} className={button} onClick={()=>void openInstalled(id,feature)}>Configure {role.app_candidates?.find(c=>c.install_id===id)?.display_name || "linked app"} →</button>)}{(role.compatible || []).map(name=><button key={name} className={button} onClick={()=>void installDependency(role,name)}>Install {name}…</button>)}</div>
          </>}
        </section>;
      })}
      <label className="flex min-h-11 items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={advanced} onChange={e=>setAdvanced(e.target.checked)}/>Show all optional connections</label>
      <button className={button} onClick={()=>void refresh()}>Refresh connections</button>
    </div>}
    {step===2 && <div className="space-y-4">
      {fields.map(f=><div key={f.name} className="space-y-1"><label className="block text-sm font-medium">{f.label || f.name}{(f.required||requiredFields.has(f.name))&&<span className="ml-2 text-xs text-text-muted">Required for setup</span>}</label><ConfigFieldInput field={f} value={config[f.name]??f.default??""} onChange={v=>setConfig(old=>({...old,[f.name]:v}))} bindings={bindings} projectId={scope} roles={pf.roles}/>{f.description&&<p className="text-xs text-text-muted">{f.description}</p>}</div>)}
      {wanted.filter(f=>f.configure).map(f=><div key={f.id} className="rounded-lg border border-border p-3"><p className="mb-2 text-sm">{f.label}: complete the app’s own setup, then return here.</p>{installId?<a className="text-sm text-accent" target="_blank" rel="noreferrer" href={`/api/apps/${encodeURIComponent(m.name)}${f.configure!.entry}?install_id=${installId}${scope?`&project_id=${encodeURIComponent(scope)}`:""}`}>Open {f.label} setup ↗</a>:<p className="text-xs text-text-muted">Available after installation. Install now and continue here.</p>}</div>)}
      {!fields.length&&!wanted.some(f=>f.configure)&&<p className="text-sm text-text-muted">No additional settings for these features.</p>}
      <label className="flex min-h-11 items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={advanced} onChange={e=>setAdvanced(e.target.checked)}/>Show advanced settings</label>
    </div>}
    {step===3 && <div className="space-y-3">
      <p className="text-sm">{installId?"Last saved setup status":"Review your setup"}</p>
      {installId&&state?<StatusTree nodes={state.nodes} onOpen={(id,f)=>void openInstalled(id,f)}/>:<><p className="text-sm text-text-muted">{wanted.map(f=>f.label).join(", ") || "No optional features selected"}</p><ul className="space-y-2 text-sm">{visibleRoles.map(r=><li key={r.role}>{r.label||r.role}: {bindingIDs(bindings[r.role]).length?"Selected · readiness checked after saving":"Not connected"}</li>)}</ul><p className="text-xs text-text-muted">Live readiness checks run after installation. Installing an app does not mean its selected features are ready.</p></>}
      {!!baseBlockers.length&&<ul className="list-inside list-disc text-sm text-warn">{baseBlockers.map(b=><li key={b}>{b}</li>)}</ul>}
      {missingFeatureRequirements&&<p className="text-sm text-warn">Some selected features need more setup. You can save and finish them later.</p>}
      {installId&&<button className={button} onClick={()=>void refresh()}>Check readiness again</button>}
      <details className="text-xs text-text-muted"><summary className="cursor-pointer py-2">App permissions</summary><ul className="space-y-1 break-all">{m.requires.permissions.map(p=><li key={p}>{p}</li>)}</ul></details>
    </div>}
    </fieldset>
    <footer className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
      <button disabled={busy} className={button} onClick={()=>step>0?setStep(step-1):finish()}>{step>0?"Back":installId?"Finish later":"Cancel"}</button>
      {step<3?<button disabled={busy} className={`${button} text-accent`} onClick={()=>setStep(step+1)}>Continue →</button>:<div className="flex flex-wrap gap-2">{installId&&<button disabled={busy} className={button} onClick={finish}>Done</button>}<button disabled={busy||(!installId&&!!baseBlockers.length)} className={`${button} bg-accent text-bg`} onClick={()=>void save()}>{busy?"Saving…":installId?"Save setup":"Install & continue"}</button></div>}
    </footer>
  </div>;
}
