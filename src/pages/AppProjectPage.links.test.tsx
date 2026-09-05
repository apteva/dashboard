import { afterEach, expect, test } from "bun:test";
import { render, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppProjectPage } from "./AppProjectPage";
import { ProjectProvider } from "../hooks/useProjects";
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup();globalThis.fetch=originalFetch;window.sessionStorage.clear();window.localStorage.clear(); });
test("app deep links select their project before loading an install", async () => {
 const requested:string[]=[];
 window.sessionStorage.setItem("apteva_project_id","project-a");
 globalThis.fetch=(async (input:any)=>{const url=String(input);requested.push(url);return new Response(JSON.stringify(url.includes("/projects")?[{id:"project-a",name:"A"},{id:"project-b",name:"B"}]:[]),{status:200,headers:{"Content-Type":"application/json"}});}) as typeof fetch;
 const ui=render(<ProjectProvider><MemoryRouter initialEntries={["/apps/tables/page?project_id=project-b&table=books&row=17"]}><Routes><Route path="/apps/:name/page" element={<AppProjectPage/>}/></Routes></MemoryRouter></ProjectProvider>);
 await waitFor(()=>expect(ui.container.textContent).toContain("not installed"));
 expect(window.sessionStorage.getItem("apteva_project_id")).toBe("project-b");
 expect(requested.filter(url=>url.includes("/apps")).every(url=>url.includes("project-b"))).toBe(true);
});
test("unknown linked projects never fall back to another project's app",async()=>{
 const requested:string[]=[];
 globalThis.fetch=(async(input:any)=>{const url=String(input);requested.push(url);return new Response(JSON.stringify([{id:"project-a",name:"A"}]),{status:200});}) as typeof fetch;
 const ui=render(<ProjectProvider><MemoryRouter initialEntries={["/apps/tables/page?project_id=missing&table=books"]}><Routes><Route path="/apps/:name/page" element={<AppProjectPage/>}/></Routes></MemoryRouter></ProjectProvider>);
 await waitFor(()=>expect(ui.container.textContent).toContain("linked project is unavailable"));expect(requested.some(url=>url.includes("/apps"))).toBe(false);
});
