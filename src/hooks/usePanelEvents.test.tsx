import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePanelEvents } from "./usePanelEvents";
import { __testHelpers } from "./useAppEvents";
const original = globalThis.EventSource;
const sources: FakeSource[] = [];
class FakeSource {
 onopen: (()=>void)|null=null; onmessage: ((e: {data:string})=>void)|null=null; onerror: (()=>void)|null=null;
 closed=false; readyState=1;
 constructor(public url:string) {sources.push(this)}
 close(){this.closed=true}
 send(seq:number,install=77,project="p",topic="task.updated") {this.onmessage?.({data:JSON.stringify({seq,install_id:install,project_id:project,app:"processes",topic,data:{task_id:String(seq)}})})}
}
afterEach(()=>{cleanup();for(const c of __testHelpers.channels.values()){c.es?.close();if(c.reconnectTimer)clearTimeout(c.reconnectTimer)}__testHelpers.channels.clear();sources.length=0;globalThis.EventSource=original});
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,240))});
test("pages share a stream, batch all IDs, isolate installations, and recover on reconnect",async()=>{
 globalThis.EventSource=FakeSource as unknown as typeof EventSource;
 const a=renderHook(()=>usePanelEvents("processes","p",77));
 const b=renderHook(()=>usePanelEvents("processes","p",88));
 expect(sources).toHaveLength(1);
 act(()=>{sources[0].send(1);sources[0].send(2);sources[0].send(3,88);sources[0].send(4,77,"wrong");sources[0].send(4,77,"wrong")});
 await settle();
 expect(a.result.current.eventRevision).toBe(1);
 expect(a.result.current.appEvents.map(e=>e.seq)).toEqual([1,2]);
 expect(b.result.current.appEvents.map(e=>e.seq)).toEqual([3]);
 act(()=>{sources[0].onopen?.()});await settle();
 expect(a.result.current.eventRevision).toBe(2);expect(a.result.current.appEvents).toEqual([]);
 a.unmount();expect(sources[0].closed).toBe(false);b.unmount();expect(sources[0].closed).toBe(true);
});
test("topic filtering, hidden tab recovery, and cleanup cancel pending refreshes",async()=>{
 globalThis.EventSource=FakeSource as unknown as typeof EventSource;
 const hook=renderHook(()=>usePanelEvents("processes","p",77,["run.*"]));
 act(()=>{sources[0].send(1);sources[0].send(2,77,"p","run.updated")});await settle();
 expect(hook.result.current.appEvents.map(e=>e.seq)).toEqual([2]);
 act(()=>{document.dispatchEvent(new Event("visibilitychange"))});await settle();
 expect(hook.result.current.appEvents).toEqual([]);
 act(()=>{sources[0].send(3,77,"p","run.updated")});hook.unmount();await settle();expect(sources[0].closed).toBe(true);
});
