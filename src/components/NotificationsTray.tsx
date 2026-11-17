import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppIcon } from "@apteva/ui-kit";
import { useNotifications, type Notification } from "../state/notifications";
import { startAppNotifications, refreshAppNotifications, loadMoreAppNotifications } from "../state/appNotifications";
import { setUnreadTitleCount } from "../state/documentTitle";
import { userNotifications, type UserNotification } from "../api";
import { useAuth } from "../hooks/useAuth";

function relative(iso:string){const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(iso))/60000));return minutes<1?"Just now":minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:`${Math.floor(minutes/1440)}d ago`;}
function safeAppURL(value:string){return value.startsWith("/apps/")&&!value.includes("\\") ? value : "/settings?tab=notifications";}
export function NotificationsTray(){
  const {user}=useAuth();const navigate=useNavigate();const {items,unreadCount,tabCount,nextBefore,markRead,remove}=useNotifications();
  const [open,setOpen]=useState(false);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const root=useRef<HTMLDivElement>(null);
  const uid=user?user.id:0;
  useEffect(()=>{if(uid)return startAppNotifications(uid);},[uid]);
  useEffect(()=>{setUnreadTitleCount(tabCount);return()=>setUnreadTitleCount(0);},[tabCount]);
  useEffect(()=>{if(!open)return;const outside=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);};document.addEventListener("mousedown",outside);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",escape);};},[open]);
  useEffect(()=>{const go=(e:Event)=>{const n=(e as CustomEvent<UserNotification>).detail;if(!n)return;void userNotifications.update(n.id,{read:true}).then(refreshAppNotifications).catch(()=>{});navigate(safeAppURL(n.url));};window.addEventListener("apteva.openAppNotification",go);return()=>window.removeEventListener("apteva.openAppNotification",go);},[navigate]);
  async function acknowledge(n:Notification){setError("");try{if(n.ref?.kind==="app-notification"){await userNotifications.update(n.ref.notificationId,{read:true});refreshAppNotifications();navigate(safeAppURL(n.ref.url));}else{markRead(n.id);}setOpen(false);}catch(e){setError(e instanceof Error?e.message:"Could not open notification");}}
  async function dismiss(n:Notification){if(n.ref?.kind==="app-notification"){await userNotifications.update(n.ref.notificationId,{dismiss:true});refreshAppNotifications();}else remove(n.id);}
  async function dismissAll(){setBusy(true);setError("");try{await Promise.all(items.map(dismiss));}catch(e){setError(e instanceof Error?e.message:"Could not dismiss notifications");}finally{setBusy(false);}}
  return <div ref={root} className="relative shrink-0">
    <button type="button" aria-label={unreadCount?`Notifications, ${unreadCount} unread`:"Notifications"} aria-expanded={open} onClick={()=>setOpen(!open)} className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors md:h-9 md:w-9"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>{unreadCount>0&&<span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[10px] font-bold">{unreadCount>99?"99+":unreadCount}</span>}</button>
    {open&&<section aria-label="Notifications" className="absolute right-0 mt-2 w-[min(400px,calc(100vw-1rem))] max-h-[min(560px,75dvh)] overflow-hidden rounded-xl border border-border bg-bg-card shadow-xl z-50 flex flex-col">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between gap-3"><h2 className="font-medium text-sm">Notifications</h2><Link to="/settings?tab=notifications" onClick={()=>setOpen(false)} className="text-xs text-accent hover:underline">Settings</Link></header>
      {error&&<p role="alert" className="text-sm text-red px-4 py-2">{error}</p>}
      <div className="overflow-y-auto flex-1">{!items.length?<p className="p-8 text-center text-sm text-text-muted">You’re all caught up.</p>:items.map(n=><article key={n.id} className={`flex items-start gap-2 px-3 py-3 border-b border-border/40 hover:bg-bg-hover ${n.unread?"":"opacity-60"}`}>
        <button onClick={()=>void acknowledge(n)} className="flex gap-3 min-w-0 flex-1 text-left cursor-pointer">
          <AppIcon src={n.icon||""} iconStyle={n.iconStyle} name={n.sourceLabel||n.source} size="sm" />
          <span className="min-w-0 flex-1"><span className="flex justify-between gap-2 text-[11px] text-text-dim"><span className="truncate">{n.sourceLabel||n.source}</span><time className="shrink-0" dateTime={n.ts}>{relative(n.ts)}</time></span><span className="block text-sm font-medium truncate">{n.title}{n.count>1?` ×${n.count}`:""}</span>{n.preview&&<span className="block text-xs text-text-muted line-clamp-2 mt-0.5">{n.preview}</span>}</span>
        </button><button aria-label={`Dismiss ${n.title}`} onClick={()=>void dismiss(n).catch(e=>setError(e.message))} className="text-text-dim hover:text-text px-1">×</button>
      </article>)}</div>
      {(items.length>0||nextBefore>0)&&<footer className="flex items-center justify-between px-4 py-2 border-t border-border text-xs"><button disabled={busy} className="text-text-muted hover:text-text disabled:opacity-40" onClick={()=>void dismissAll()}>Dismiss shown</button>{nextBefore>0&&<button className="text-accent" disabled={busy} onClick={async()=>{setBusy(true);try{await loadMoreAppNotifications();}catch(e){setError(e instanceof Error?e.message:"Could not load more");}finally{setBusy(false);}}}>Older notifications</button>}</footer>}
    </section>}
  </div>;
}
