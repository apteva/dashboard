import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { devices, type AccountDevice, type Agent, type DeviceEventBinding } from "../../api";
import { DeviceAgentSettings } from "./DeviceAgentSettings";
const original = {...devices};
afterEach(()=>{cleanup();Object.assign(devices,original);});
const device={id:"node_desk",tools:[{name:"lamp_set",description:"Switch lamp",confirm:"hold"},{name:"lamp_get",description:"Read lamp"}],events:[{capability:"button",kind:"pressed"}]} as AccountDevice;
const agents=[{id:1,name:"Home agent",project_id:"home"},{id:2,name:"Work agent",project_id:"work"}] as Agent[];
function fixture(bindings:DeviceEventBinding[]=[]){devices.grants=mock(async()=>({grants:[]}));devices.bindings=mock(async()=>({bindings}));devices.deliveries=mock(async()=>({deliveries:[]}));return render(<DeviceAgentSettings device={device} agents={agents} projects={[]}/>);}
test("hardware grants select explicit tools for an agent across projects",async()=>{
 devices.grant=mock(async()=>({agent_id:2,project_id:"work",tools:["lamp_get"]}));fixture();
 fireEvent.change(screen.getByLabelText("Agent for hardware tools"),{target:{value:"2"}});
 fireEvent.click(screen.getByLabelText(/Read lamp/));fireEvent.click(screen.getByRole("button",{name:"Save agent tools"}));
 await waitFor(()=>expect(devices.grant).toHaveBeenCalledWith("node_desk",2,["lamp_get"]));
});
test("event subscription captures a distinct target with cooldown and expiry",async()=>{
 devices.subscribe=mock(async()=>({id:"binding"} as DeviceEventBinding));fixture();
 fireEvent.change(screen.getByLabelText("Device event"),{target:{value:"0"}});fireEvent.change(screen.getByLabelText("Agent to trigger"),{target:{value:"1"}});fireEvent.change(screen.getByLabelText("What should the agent do?"),{target:{value:"Check the front door"}});
 fireEvent.click(screen.getByRole("button",{name:"Add event subscription"}));await waitFor(()=>expect(devices.subscribe).toHaveBeenCalledWith("node_desk",{agent_id:1,capability:"button",kind:"pressed",thread_id:"main",instruction:"Check the front door",enabled:true,cooldown_seconds:5,max_age_seconds:300}));
});
test("paused subscriptions can be enabled",async()=>{
 const binding={id:"b1",agent_id:2,capability:"button",kind:"pressed",thread_id:"main",enabled:false,cooldown_seconds:5,max_age_seconds:300} as DeviceEventBinding;
 devices.toggleBinding=mock(async()=>({...binding,enabled:true}));fixture([binding]);
 await screen.findByText(/button.pressed → Work agent/);expect(screen.getByText(/Paused/)).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Enable subscription"}));await waitFor(()=>expect(devices.toggleBinding).toHaveBeenCalledWith("node_desk","b1",true));
});
test("server errors remain visible when a hardware grant fails",async()=>{
 devices.grant=mock(async()=>{throw new Error("Editor access required");});fixture();fireEvent.change(screen.getByLabelText("Agent for hardware tools"),{target:{value:"2"}});fireEvent.click(screen.getByLabelText(/Switch lamp/));fireEvent.click(screen.getByRole("button",{name:"Save agent tools"}));expect((await screen.findByRole("alert")).textContent).toContain("Editor access required");
});
