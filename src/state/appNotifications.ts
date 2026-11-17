import { userNotifications, type NotificationSnapshot, type UserNotification } from "../api";
import { notifications, type Notification as TrayNotification } from "./notifications";

let activeRefresh: (()=>void) | undefined;
let activeLoadMore: (()=>Promise<void>) | undefined;
export function refreshAppNotifications() { activeRefresh?.(); }
export async function loadMoreAppNotifications() { await activeLoadMore?.(); }

export function appNotificationItems(items: UserNotification[]): TrayNotification[] {
  const groups = new Map<string, TrayNotification>();
  for (const item of items) {
    // Desktop/tab-only alerts remain discoverable in the tray when it is
    // opened; only the in-app channel contributes to the bell badge.
    if (!item.channels.in_app && !item.channels.tab && !item.channels.desktop) continue;
    // Read entries remain separate from unread entries so a new arrival never
    // looks acknowledged merely because an older entry in the group was read.
    const key = `${item.install_id}:${item.project_id}:${item.group}:${item.read}`;
    const existing=groups.get(key);
    if(existing) {existing.count++;continue;}
    groups.set(key,{id:`app:${item.id}`,source:"app",sourceLabel:item.app_name||item.app,icon:item.icon,iconStyle:item.icon_style,
      title:item.title,preview:item.body,ts:item.created_at,count:1,unread:!item.read,latestId:item.id,
      ref:{kind:"app-notification",notificationId:item.id,url:item.url}});
  }
  return [...groups.values()];
}

export function startAppNotifications(userID: number): ()=>void {
  let stopped=false;let source:EventSource|null=null;let timer:ReturnType<typeof setTimeout>|undefined;let retry=1000;
  let snapshot: NotificationSnapshot={items:[],unread_count:0,tab_count:0,next_before:0};let more:UserNotification[]=[];
  let requestRevision=0;
  const seenKey=`apteva.notifications.desktop.${userID}`;
  function render(){const combined=new Map<number,UserNotification>();for(const n of [...snapshot.items,...more])if(!combined.has(n.id))combined.set(n.id,n);notifications.replaceApps(appNotificationItems([...combined.values()].sort((a,b)=>b.id-a.id)),snapshot.unread_count,snapshot.tab_count,snapshot.next_before);}
  async function desktop(items:UserNotification[]) {
    if(stopped||typeof Notification==="undefined"||Notification.permission!=="granted")return;
    const show=()=>{
      if(stopped)return;
      let seen=0;try{seen=Number(localStorage.getItem(seenKey))||0;}catch{}
      const newest=Math.max(0,...items.map(n=>n.id));
      // First visit seeds a watermark; historical notifications stay in the bell.
      const fresh=items.filter(n=>n.id>seen&&!n.read&&n.channels.desktop&&Date.now()-Date.parse(n.created_at)<60000);
      try{localStorage.setItem(seenKey,String(Math.max(seen,newest)));}catch{}
      const grouped=new Set<string>();
      for(const n of fresh){if(grouped.has(n.group))continue;grouped.add(n.group);
        try{const alert=new Notification(n.title,{body:n.body,icon:n.icon||undefined,tag:`apteva:${userID}:${n.group}`});alert.onclick=()=>{window.focus();window.dispatchEvent(new CustomEvent("apteva.openAppNotification",{detail:n}));alert.close();};}catch{}
      }
    };
    if(navigator.locks) await navigator.locks.request(seenKey,show);else show();
  }
  function apply(value:NotificationSnapshot){if(stopped)return;snapshot=value;render();void desktop(value.items);}
  async function refresh(){const revision=++requestRevision;try{const value=await userNotifications.list();if(!stopped&&revision===requestRevision){more=[];apply(value);}}catch{/* SSE retries and the bell retain their last successful snapshot. */}}
  async function loadMore(){if(!snapshot.next_before)return;const revision=requestRevision;const value=await userNotifications.list(snapshot.next_before);if(stopped||revision!==requestRevision)return;more.push(...value.items);snapshot={...snapshot,next_before:value.next_before};render();}
  function connect(){if(stopped)return;source=new EventSource("/api/notifications/stream",{withCredentials:true});
    source.onopen=()=>{retry=1000;};
    source.onmessage=e=>{try{requestRevision++;more=[];apply(JSON.parse(e.data));}catch{}};
    source.onerror=()=>{source?.close();source=null;if(!stopped){timer=setTimeout(connect,retry);retry=Math.min(retry*2,30000);}};
  }
  const changed=()=>void refresh();
  const focus=()=>{if(document.visibilityState==="visible")void refresh();};
  activeRefresh=changed;activeLoadMore=loadMore;connect();
  window.addEventListener("apteva.notificationsChanged",changed);document.addEventListener("visibilitychange",focus);
  return ()=>{stopped=true;requestRevision++;clearTimeout(timer);source?.close();activeRefresh=undefined;activeLoadMore=undefined;notifications.reset();window.removeEventListener("apteva.notificationsChanged",changed);document.removeEventListener("visibilitychange",focus);};
}
