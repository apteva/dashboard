import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppIcon } from "@apteva/ui-kit";
import { userNotifications, type NotificationChannels, type NotificationSource, type NotificationSubscription } from "../../api";
import { useProjects } from "../../hooks/useProjects";

const channels: {key: keyof NotificationChannels; label: string; description: string}[] = [
  {key:"in_app",label:"Notification bell",description:"Keep an inbox in Apteva."},
  {key:"tab",label:"Tab badge",description:"Show the unread count in the browser tab title."},
  {key:"desktop",label:"Desktop",description:"Show an operating system notification while Apteva is open."},
  {key:"mobile",label:"Mobile push",description:"Send to your connected phones, including while Apteva is closed."},
];
const permission = () => typeof Notification === "undefined" ? "unsupported" : Notification.permission;
function ChannelChoices({value,onChange,disabled,global}: {value:NotificationChannels;onChange:(next:NotificationChannels)=>void;disabled?:boolean;global?:NotificationChannels}) {
  return <div className="flex flex-wrap gap-x-5 gap-y-3">{channels.map(c=><label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer" title={global && !global[c.key] ? "Paused in your delivery preferences above" : c.description}>
    <input type="checkbox" checked={value[c.key]} disabled={disabled} onChange={e=>onChange({...value,[c.key]:e.target.checked})} className="accent-accent" />
    <span>{c.label}{global && !global[c.key] && value[c.key] && <span className="text-text-dim text-xs"> · paused</span>}</span>
  </label>)}</div>;
}
function Rule({source,sub,onSave,global,onReset}: {source:NotificationSource;sub:NotificationSubscription;onSave:(s:NotificationSubscription)=>Promise<void>;global:NotificationChannels;onReset:(s:NotificationSubscription)=>Promise<void>}) {
  const [draft,setDraft]=useState(sub); const [saving,setSaving]=useState(false);const [error,setError]=useState("");const [saved,setSaved]=useState(false);
  const baseline=useRef(sub);
  useEffect(()=>{const previous=baseline.current;baseline.current=sub;setDraft(current=>JSON.stringify(current)===JSON.stringify(previous)?sub:current);},[sub]);
  const dirty=JSON.stringify(sub)!==JSON.stringify(draft);
  async function save(reset=false){setSaving(true);setError("");setSaved(false);try{if(reset){setDraft(sub);await onReset(sub);}else await onSave(draft);setSaved(true);}catch(e){setError(e instanceof Error?e.message:"Could not save");}finally{setSaving(false);}}
  return <section className="rounded-xl border border-border p-4 space-y-4">
    <div><h4 className="font-medium text-sm">{sub.key ? `Following: ${sub.key}` : source.definition.name}</h4><p className="text-sm text-text-muted mt-1">{source.definition.description || `When ${source.definition.name.toLowerCase()}.`}</p>
    <p className="text-xs text-text-dim mt-1">{source.definition.audience==="recipients" ? "Only when this event is addressed to you." : "Events you can access in this project."}</p></div>
    <ChannelChoices value={draft.channels} global={global} disabled={saving} onChange={channels=>{setDraft({...draft,channels});setSaved(false);}} />
    {!!source.definition.filters?.length && <div className="grid gap-3 sm:grid-cols-2">{source.definition.filters.map(f=><label className="text-xs text-text-muted space-y-1" key={f.field}><span>{f.label}</span>{f.options?.length ?
      <select className="block w-full rounded-lg border border-border bg-bg p-2 text-sm text-text" value={draft.filters[f.field]||""} disabled={saving} onChange={e=>{const filters={...draft.filters};if(e.target.value)filters[f.field]=e.target.value;else delete filters[f.field];setDraft({...draft,filters});}}><option value="">Any</option>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select> :
      <input className="block w-full rounded-lg border border-border bg-bg p-2 text-sm text-text" placeholder="Any resource" value={draft.filters[f.field]||""} disabled={saving} onChange={e=>{const filters={...draft.filters};if(e.target.value)filters[f.field]=e.target.value;else delete filters[f.field];setDraft({...draft,filters});}} />}</label>)}</div>}
    <div className="flex flex-wrap items-center gap-3"><button className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40" disabled={saving||!dirty} onClick={()=>void save()}>{saving?"Saving…":"Save"}</button><button className="text-xs text-text-muted hover:text-text" disabled={saving} onClick={()=>void save(true)}>{sub.key ? "Remove follow rule" : "Reset to app defaults"}</button>{saved&&!dirty&&<span role="status" className="text-xs text-text-muted">Saved</span>}</div>
    {error&&<p role="alert" className="text-sm text-red">{error}</p>}
  </section>;
}
export function NotificationSettings() {
  const {currentProject,projects}=useProjects();const [search]=useSearchParams();
  const requestedProject=search.get("project_id");const projectID=requestedProject ?? currentProject?.id ?? "";
  const installID=Number(search.get("install_id"))||undefined;
  const scopeKey=`${projectID}:${installID||""}`; const scopeRef=useRef(scopeKey);scopeRef.current=scopeKey;
  const [delivery,setDelivery]=useState({pending:0,failed:0});
  const [prefs,setPrefs]=useState<NotificationChannels|null>(null);const [sources,setSources]=useState<NotificationSource[]>([]);const [devices,setDevices]=useState<{device_name:string;platform:string;status:string}[]>([]);
  const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [browser,setBrowser]=useState(permission);const [filter,setFilter]=useState("");const generation=useRef(0);
  useEffect(()=>{const id=++generation.current;setLoading(true);setError("");setSources([]);
    Promise.all([userNotifications.preferences(),userNotifications.sources(projectID,installID),userNotifications.devices(),userNotifications.deliveryStatus()]).then(([p,s,d,status])=>{if(id!==generation.current)return;setPrefs(p);setSources(s);setDevices(d.subscriptions);setDelivery(status);}).catch(e=>{if(id===generation.current)setError(e.message);}).finally(()=>{if(id===generation.current)setLoading(false);});
    return ()=>{generation.current++;};
  },[projectID,installID]);
  async function refresh(){if(scopeRef.current!==scopeKey)return;const id=generation.current;const rows=await userNotifications.sources(projectID,installID);if(id===generation.current&&scopeRef.current===scopeKey)setSources(rows);window.dispatchEvent(new Event("apteva.notificationsChanged"));}
  async function savePreferences(value:NotificationChannels){setSaving(true);setError("");try{await userNotifications.setPreferences(value);setPrefs(value);window.dispatchEvent(new Event("apteva.notificationsChanged"));}catch(e){setError(e instanceof Error?e.message:"Could not save preferences");}finally{setSaving(false);}}
  const matching=sources.filter(s=>`${s.name} ${s.definition.name} ${s.definition.description||""}`.toLowerCase().includes(filter.toLowerCase()));
  const apps=Array.from(new Set(matching.map(s=>s.install_id)));
  if(loading)return <p role="status" className="text-sm text-text-muted">Loading notification settings…</p>;
  return <div className="space-y-6">
    {error&&<p role="alert" className="text-sm text-red">{error}</p>}
    {prefs&&<section className="rounded-xl border border-border p-4 space-y-4"><div><h3 className="font-medium">Your delivery preferences</h3><p className="text-sm text-text-muted mt-1">Pause a delivery method across all apps. Your individual subscriptions stay saved.</p></div>
      <ChannelChoices value={prefs} disabled={saving} onChange={value=>void savePreferences(value)} />
      <div className="text-xs text-text-muted space-y-2">
        <p>Desktop: {browser==="granted" ? "permission granted on this browser" : browser==="denied" ? "blocked — allow notifications in your browser’s site settings" : browser==="unsupported" ? "not supported in this browser" : "permission needed on this browser"}.</p>
        {browser==="default"&&<button className="text-accent hover:underline" onClick={async()=>{setError("");try{setBrowser(await Notification.requestPermission());}catch{setError("Could not request desktop notification permission.");}}}>Allow desktop notifications</button>}
        <p>Mobile: {devices.filter(d=>d.status==="active").length ? devices.filter(d=>d.status==="active").map(d=>d.device_name||d.platform).join(", ") : "no connected device. Register this server from a push-capable Apteva mobile client."}</p>
        {delivery.pending>0&&<p>{delivery.pending} mobile deliveries are queued or retrying.</p>}
        {delivery.failed>0&&<p className="text-red">{delivery.failed} mobile deliveries failed. Check that your Push relay supports app notifications and its APNs/FCM connection is configured.</p>}
      </div>
    </section>}
    <div><h3 className="font-medium">App subscriptions</h3><p className="text-sm text-text-muted mt-1">{projectID ? `Project: ${projects.find(p=>p.id===projectID)?.name||projectID}` : "Global apps"}. Choose the events and delivery methods you want.</p></div>
    {!!sources.length&&<input aria-label="Find app notifications" type="search" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Find an app or notification…" className="w-full rounded-lg border border-border bg-bg p-3 text-sm" />}
    {!sources.length&&<div className="rounded-xl border border-dashed border-border p-6 text-sm text-text-muted">No installed app has declared user notifications in this scope yet. Apps can add notifications to their existing published events through the SDK.</div>}
    {!!sources.length&&!matching.length&&<p className="text-sm text-text-muted">No matching notifications.</p>}
    {prefs&&apps.map(id=>{const rows=matching.filter(s=>s.install_id===id);const first=rows[0]!;return <section key={id} className="space-y-3"><div className="flex items-center gap-3"><AppIcon src={first.icon} iconStyle={first.icon_style} name={first.name} size="sm" /><h3 className="font-medium">{first.name}</h3></div>{rows.map(s=><div key={s.definition.id} className="space-y-3"><Rule source={s} sub={s.subscription} global={prefs} onSave={async v=>{await userNotifications.subscribe(v);await refresh();}} onReset={async v=>{await userNotifications.reset(v);await refresh();}} />{s.follows.map(f=><Rule key={f.key} source={s} sub={f} global={prefs} onSave={async v=>{await userNotifications.subscribe(v);await refresh();}} onReset={async v=>{await userNotifications.reset(v);await refresh();}} />)}</div>)}</section>;})}
  </div>;
}
