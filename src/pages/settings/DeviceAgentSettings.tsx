import { useCallback, useEffect, useState } from "react";
import { devices, type AccountDevice, type Agent, type Project, type DeviceToolGrant, type DeviceEventBinding, type DeviceEventDelivery } from "../../api";

const input = "min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text";
const button = "min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-text hover:border-accent disabled:opacity-50";

export function DeviceAgentSettings({ device, agents, projects }: {device: AccountDevice; agents: Agent[]; projects: Project[]}) {
  const [grants, setGrants] = useState<DeviceToolGrant[]>([]);
  const [bindings, setBindings] = useState<DeviceEventBinding[]>([]);
  const [deliveries, setDeliveries] = useState<DeviceEventDelivery[]>([]);
  const [agent, setAgent] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [eventIndex, setEventIndex] = useState("");
  const [target, setTarget] = useState("");
  const [thread, setThread] = useState("main");
  const [instruction, setInstruction] = useState("");
  const [cooldown, setCooldown] = useState(5);
  const [maxAge, setMaxAge] = useState(300);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const [g,b,d] = await Promise.all([devices.grants(device.id), devices.bindings(device.id), devices.deliveries(device.id)]);
    setGrants(g.grants); setBindings(b.bindings); setDeliveries(d.deliveries);
  }, [device.id]);
  useEffect(() => { let active=true; const load=()=>{ if (active) void reload().catch(err => { if(active) setError(err.message); }); }; load(); const timer=window.setInterval(load,5000); return ()=>{active=false;window.clearInterval(timer);}; }, [reload]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true);setError("");try{await fn();await reload();}catch(err){setError(err instanceof Error?err.message:"Device settings could not be saved.");}finally{setBusy(false);} };
  const label = (id: number) => {const a=agents.find(row=>row.id===id);const p=projects.find(row=>row.id===a?.project_id);return a ? `${a.name}${p ? " · "+p.name : ""}` : `Agent ${id}`;};
  const agentOptions = <><option value="">Choose an agent</option>{agents.map(a=><option key={a.id} value={a.id}>{label(a.id)}</option>)}</>;
  const selectAgent = (value: string) => {setAgent(value);setTools(grants.find(g=>g.agent_id===Number(value))?.tools || []);};
  const subscribe = () => act(async () => {const e=device.events?.[Number(eventIndex)];if(!e||!target)return;await devices.subscribe(device.id,{agent_id:Number(target),capability:e.capability,kind:e.kind,thread_id:thread.trim()||"main",instruction,enabled:true,cooldown_seconds:cooldown,max_age_seconds:maxAge});});
  return <div className="mt-4 space-y-6">
    <section className="space-y-3"><h4 className="text-sm font-semibold text-text">Agent hardware tools</h4>
      <p className="text-xs text-text-muted">Choose which agents can use this Node and which tools they receive. Device confirmation still applies. New tools need a new grant.</p>
      {grants.map(g=><div key={g.agent_id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{label(g.agent_id)} · {g.tools.join(", ")}</span><button type="button" className={button} disabled={busy} onClick={()=>void act(()=>devices.revokeGrant(device.id,g.agent_id))}>Revoke tools for {label(g.agent_id)}</button></div>)}
      {!device.tools?.length ? <p className="text-xs text-text-muted">Connect the Node to discover its tools.</p> : <form className="space-y-3" onSubmit={e=>{e.preventDefault();void act(()=>devices.grant(device.id,Number(agent),tools));}}>
        <label className="block text-xs text-text-muted">Agent for hardware tools<select className={input} value={agent} onChange={e=>selectAgent(e.target.value)}>{agentOptions}</select></label>
        <div className="space-y-2">{device.tools.map(t=><label key={t.name} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={tools.includes(t.name)} onChange={e=>setTools(current=>e.target.checked?[...current,t.name]:current.filter(name=>name!==t.name))}/><span>{t.description || t.name} <span className="text-text-dim">({t.name}{t.confirm&&t.confirm!=="none"?" · confirms on device":""})</span></span></label>)}</div>
        <button className={button} disabled={busy||!agent||!tools.length}>Save agent tools</button>
      </form>}
    </section>
    <section className="space-y-3 border-t border-border pt-4"><h4 className="text-sm font-semibold text-text">Button &amp; sensor events</h4>
      <p className="text-xs text-text-muted">Each subscription keeps its chosen agent and thread when someone switches agents on the Node. Stopped agents wait until the event expires.</p>
      {bindings.map(b=><div key={b.id} className="space-y-2 rounded border border-border p-3 text-sm"><p>{b.capability}.{b.kind} → {label(b.agent_id)} · {b.thread_id} · {b.enabled?"Enabled":"Paused"}</p>{b.instruction&&<p className="text-xs text-text-muted">{b.instruction}</p>}<p className="text-xs text-text-muted">Cooldown {b.cooldown_seconds}s · expires after {b.max_age_seconds}s</p><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void act(()=>devices.toggleBinding(device.id,b.id,!b.enabled))}>{b.enabled?"Pause":"Enable"} subscription</button><button type="button" className={button} disabled={busy} onClick={()=>void act(()=>devices.removeBinding(device.id,b.id))}>Delete subscription</button></div></div>)}
      {!device.events?.length ? <p className="text-xs text-text-muted">This device has not advertised any events.</p> : <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void subscribe();}}>
        <label className="text-xs text-text-muted">Device event<select className={input} value={eventIndex} onChange={e=>setEventIndex(e.target.value)}><option value="">Choose an event</option>{device.events.map((e,i)=><option key={e.capability+":"+e.kind} value={i}>{e.description||e.capability+"."+e.kind}</option>)}</select></label>
        <label className="text-xs text-text-muted">Agent to trigger<select className={input} value={target} onChange={e=>setTarget(e.target.value)}>{agentOptions}</select></label>
        <label className="text-xs text-text-muted">Thread ID<input className={input} value={thread} maxLength={256} onChange={e=>setThread(e.target.value)} required/></label>
        <label className="text-xs text-text-muted">Cooldown (seconds)<input className={input} type="number" min={0} max={86400} value={cooldown} onChange={e=>setCooldown(Number(e.target.value))}/></label>
        <label className="text-xs text-text-muted">Event expiry (seconds)<input className={input} type="number" min={1} max={86400} value={maxAge} onChange={e=>setMaxAge(Number(e.target.value))}/></label>
        <label className="text-xs text-text-muted sm:col-span-2">What should the agent do?<textarea className={input} value={instruction} maxLength={4000} onChange={e=>setInstruction(e.target.value)}/></label>
        <button className={button} disabled={busy||eventIndex===""||!target}>Add event subscription</button>
      </form>}
    </section>
    <section className="space-y-2 border-t border-border pt-4"><h4 className="text-sm font-semibold text-text">Recent event deliveries</h4>{!deliveries.length?<p className="text-xs text-text-muted">No event deliveries yet.</p>:<ul className="max-h-64 space-y-2 overflow-auto text-xs text-text-muted">{deliveries.map(d=><li key={d.event_id+":"+d.binding_id} className="break-words">{d.event_id} · {d.status} · {d.attempts} attempts{d.error?" · "+d.error:""}{d.execution_id?" · execution "+d.execution_id:""}</li>)}</ul>}</section>
    {error&&<p role="alert" className="text-sm text-red">{error}</p>}
  </div>;
}
