import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { agentResources, type AgentResourceStatus } from "../api";
import { AgentResourcesPanel } from "./AgentResourcesPanel";
afterEach(cleanup);
const record:AgentResourceStatus={revision:4,policy:{},resolved:{},apply:"next_restart",state:"pending_restart",supported:true,observed:{"cpu.weight":"100"},capabilities:{},note:"Saving does not restart this agent."};
test("CPU-only shared editor saves an explicit revision without restart",async()=>{
 const get=agentResources.get,save=agentResources.save;let writes=0;
 agentResources.get=async()=>record;
 agentResources.save=async(id,revision,policy)=>{expect(id).toBe(42);expect(revision).toBe(4);expect(policy.process?.cpu_weight).toBe(200);writes++;return {...record,revision:5,policy}};
 try{const v=render(<AgentResourcesPanel agentId={42}/>);await waitFor(()=>expect(v.getByLabelText("CPU weight")).toBeTruthy());expect(v.queryByLabelText("CPU quota (%)")).toBeNull();expect(writes).toBe(0);fireEvent.change(v.getByLabelText("CPU weight"),{target:{value:"200"}});fireEvent.click(v.getByText("Save for next restart"));await waitFor(()=>expect(writes).toBe(1));expect(v.getByText(/Saving does not restart/)).toBeTruthy();}finally{agentResources.get=get;agentResources.save=save}
});
test("unsupported host is explicit and never presents requested weight as effective",async()=>{
 const get=agentResources.get;agentResources.get=async()=>({...record,supported:false,state:"unsupported",observed:{},policy:{process:{cpu_weight:200}}});
 try{const v=render(<AgentResourcesPanel agentId={1}/>);await waitFor(()=>expect(v.getByLabelText("CPU weight")).toBeTruthy());expect((v.getByLabelText("CPU weight") as HTMLInputElement).disabled).toBe(true);expect(v.getByText(/Unsupported on this host.*Observed: Unknown/)).toBeTruthy();fireEvent.click(v.getByText("Use host default"));expect((v.getByLabelText("CPU weight") as HTMLInputElement).value).toBe("");}finally{agentResources.get=get}
});
test("refresh does not bypass conflict detection for an edited draft",async()=>{
 const get=agentResources.get,save=agentResources.save;let reads=0;
 agentResources.get=async()=>({...record,revision:reads++===0?4:7});
 agentResources.save=async(_,revision)=>{expect(revision).toBe(4);throw new Error("policy changed; reload before saving")};
 try{const v=render(<AgentResourcesPanel agentId={1}/>);await waitFor(()=>expect(v.getByLabelText("CPU weight")).toBeTruthy());fireEvent.change(v.getByLabelText("CPU weight"),{target:{value:"200"}});fireEvent.click(v.getByText("Refresh observed settings"));await waitFor(()=>expect(reads).toBe(2));fireEvent.click(v.getByText("Save for next restart"));await waitFor(()=>expect(v.getByRole("alert").textContent).toContain("policy changed"));expect((v.getByLabelText("CPU weight") as HTMLInputElement).value).toBe("200");}finally{agentResources.get=get;agentResources.save=save}
});
test("switching agents discards the previous draft",async()=>{
 const get=agentResources.get;agentResources.get=async(id)=>({...record,policy:{process:{cpu_weight:id===1?200:100}}});
 try{const v=render(<AgentResourcesPanel agentId={1}/>);await waitFor(()=>expect((v.getByLabelText("CPU weight") as HTMLInputElement).value).toBe("200"));fireEvent.change(v.getByLabelText("CPU weight"),{target:{value:"300"}});v.rerender(<AgentResourcesPanel agentId={2}/>);await waitFor(()=>expect((v.getByLabelText("CPU weight") as HTMLInputElement).value).toBe("100"));}finally{agentResources.get=get}
});
