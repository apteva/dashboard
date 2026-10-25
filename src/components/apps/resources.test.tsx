import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { appResources, type AppResourcePolicy } from "../../api";
import { AppResourcesPanel, ResourcePolicyEditor } from "./AppResourcesPanel";
afterEach(cleanup);
test("DSCP zero is explicit and unset is inherited", () => {
 let policy:AppResourcePolicy={};function Editor(){const [v,set]=useState<AppResourcePolicy>({});policy=v;return <ResourcePolicyEditor value={v} onChange={set} trafficClasses={["media"]}/>}
 const view=render(<Editor/>);const field=view.getByLabelText("media DSCP (empty = unchanged)");fireEvent.change(field,{target:{value:"0"}});expect(policy.network?.media?.dscp).toBe(0);fireEvent.change(field,{target:{value:""}});expect(policy.network?.media?.dscp).toBeUndefined();
});
test("save is revision checked and does not apply or deploy implicitly",async()=>{
 const oldGet=appResources.get,oldSave=appResources.save,oldApply=appResources.apply;let writes=0,applies=0;
 const record={revision:4,policy:{},resolved:{},note:"Pending deployment",capabilities:{},declaration:{traffic_classes:["media"]}};
 appResources.get=async()=>record;appResources.save=async(id,revision,policy)=>{expect(id).toBe(17);expect(revision).toBe(4);expect(policy.process?.cpu_weight).toBe(200);writes++;return {...record,revision:5,policy}};appResources.apply=async()=>{applies++;return {}};
 try{const view=render(<AppResourcesPanel installId={17}/>);await waitFor(()=>expect(view.getByLabelText("CPU weight")).toBeTruthy());expect(writes).toBe(0);fireEvent.change(view.getByLabelText("CPU weight"),{target:{value:"200"}});fireEvent.click(view.getByText("Save for next deployment"));await waitFor(()=>expect(writes).toBe(1));expect(applies).toBe(0);}finally{appResources.get=oldGet;appResources.save=oldSave;appResources.apply=oldApply;}
});
