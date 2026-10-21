import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AuthProvider } from "../../hooks/useAuth";
import { appDeployments, auth, type AppRow, type DeploymentPlacement } from "../../api";
import { DeploymentBadge, deploymentLabel, deploymentMatches } from "./DeploymentBadge";
import { DeploymentPlacementEditor, deploymentSelectionReady } from "./DeploymentPlacementEditor";
import { AppDeploymentPanel } from "./AppDeploymentPanel";

const remote = {install_id:10,deployment:{type:"backend",managed:true,backend:{app_install_id:4,backend_id:"worker"},backend_name:"Compute",target:{app_install_id:4,resource_type:"compute.slot",resource_id:"host-a"},target_name:"Trial host",state:"unavailable"}} as AppRow;
const restore: (()=>void)[]=[];
function replace(object:any,key:string,value:any) { const old=object[key];object[key]=value;restore.push(()=>{object[key]=old}); }
afterEach(()=>{cleanup();restore.splice(0).reverse().forEach(f=>f());});
function admin(){replace(auth,"me",async()=>({user_id:1,email:"test@local",role:"admin",onboarded:true}));}
test("badges identify remote backend and target, filter, and open its deployment",()=>{
 expect(deploymentLabel(remote)).toBe("Compute · Trial host");
 expect(deploymentLabel({install_id:11} as AppRow)).toBe("This Server");
 expect(deploymentMatches(remote,"remote","4:worker","4:compute.slot:host-a")).toBe(true);
 expect(deploymentMatches(remote,"local","","")).toBe(false);
 expect(deploymentMatches(remote,"remote","9:worker","")).toBe(false);
 let opened=0;const handler=(e:Event)=>opened=(e as CustomEvent).detail.installId;
 window.addEventListener("apteva:open-deployment",handler);
 try {const view=render(<DeploymentBadge app={remote}/>);fireEvent.click(view.getByRole("button"));expect(opened).toBe(10);expect(view.getByRole("button").textContent).toContain("unavailable");}
 finally {window.removeEventListener("apteva:open-deployment",handler);}
});
test("generic placement chooses advertised resources and disables unavailable targets",async()=>{
 admin();replace(appDeployments,"backends",async()=>({backends:[{app_install_id:4,id:"worker",display_name:"Compute",endpoint:"/private",capabilities:{target_listing:true,runtime_kinds:["source"],managed_ingress:true}}]}));
 replace(appDeployments,"targets",async()=>({targets:[{ref:remote.deployment!.target,name:"Trial host",available:true,status:"ready"},{ref:{...remote.deployment!.target,resource_id:"offline"},name:"Offline",available:false,status:"stopped"}]}));
 let chosen:DeploymentPlacement|undefined;
 function Picker(){const [p,setP]=useState<DeploymentPlacement>({type:"local"});chosen=p;return <DeploymentPlacementEditor value={p} onChange={setP} manifestYaml="schema: test"/>;}
 const view=render(<AuthProvider><Picker/></AuthProvider>);
 await waitFor(()=>expect(view.getByRole("option",{name:"Compute · #4"})).toBeTruthy());
 fireEvent.change(view.getByLabelText("Run on"),{target:{value:"4:worker"}});
 await waitFor(()=>expect(view.getByRole("option",{name:"Trial host"})).toBeTruthy());
 expect((view.getByRole("option",{name:/Offline/}) as HTMLOptionElement).disabled).toBe(true);
 expect(deploymentSelectionReady(chosen)).toBe(false);
 fireEvent.change(view.getByLabelText("Deployment target"),{target:{value:"compute.slot:host-a"}});
 expect(deploymentSelectionReady(chosen)).toBe(true);expect(chosen!.target).toEqual(remote.deployment!.target);
 expect(view.getByLabelText("Public domain")).toBeTruthy();
});
test("deployment panel resumes persisted progress after reopening and does not deploy on mount",async()=>{
 admin();let writes=0;replace(appDeployments,"action",async()=>{writes++;});
 replace(appDeployments,"get",async()=>({placement:{type:"backend"},active_deployment_id:"",pending_deployment_id:"candidate",summary:remote.deployment,deployments:[],operations:[{id:"op",kind:"deploy",status:"running",phase:"preparing",updated_at:new Date().toISOString()}]}));
 let view=render(<AuthProvider><AppDeploymentPanel installId={10}/></AuthProvider>);
 await waitFor(()=>expect(view.getByRole("status").textContent).toContain("Preparing"));
 expect(view.getByText(/Compute · Trial host/)).toBeTruthy();expect(writes).toBe(0);
 view.unmount();view=render(<AuthProvider><AppDeploymentPanel installId={10}/></AuthProvider>);
 await waitFor(()=>expect(view.getByRole("status")).toBeTruthy());expect(writes).toBe(0);
 expect(view.queryByText("Scale replicas")).toBeNull();
});
