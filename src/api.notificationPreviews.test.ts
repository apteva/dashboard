import {expect,test} from "bun:test";
import {userNotifications} from "./api";

test("preview settings use a separate endpoint and never replace channels",async()=>{
  const previous=globalThis.fetch;
  const calls:{url:string;method:string;body:unknown}[]=[];
  globalThis.fetch=(async(input:unknown,init?:RequestInit)=>{
    calls.push({url:String(input),method:init?.method||"GET",body:init?.body?JSON.parse(String(init.body)):null});
    return new Response(JSON.stringify({mobile_preview:init?.method==="PUT"?"content":"hidden"}),{headers:{"Content-Type":"application/json"}});
  }) as typeof fetch;
  try {
    expect((await userNotifications.previews()).mobile_preview).toBe("hidden");
    expect((await userNotifications.setPreviews({mobile_preview:"content"})).mobile_preview).toBe("content");
    expect(calls.map(c=>c.url)).toEqual(["/api/notifications/previews","/api/notifications/previews"]);
    expect(calls[1]?.body).toEqual({mobile_preview:"content"});
  } finally {globalThis.fetch=previous;}
});
