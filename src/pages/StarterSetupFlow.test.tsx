import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupFlow } from "./WorkspaceSetup";
import { apps, auth, projectPresets, workspaceSetup, type ProjectPreset, type WorkspaceSetupDraft } from "../api";

const starter: ProjectPreset = { id:"personal-assistant", category:"personal", name:"Personal assistant", description:"One assistant for everyday work.", recommended:true,
 agents:[{key:"assistant",name:"Personal Assistant",directive:"Help the user.",mode:"cautious",apps:["conversations","a2a","tasks","notes"],capabilities:[{name:"apteva-server",allowed_tools:["agents_create","agents_get"]}]}] };
const work: ProjectPreset = {...starter,id:"work-executive",category:"work",name:"Work assistant"};
const specialist: ProjectPreset = {...starter,id:"personal-household",name:"Household",recommended:false};
const targets=[auth,projectPresets,workspaceSetup,apps];
const originals=targets.map(target=>({target,values:{...target}}));
const realList = projectPresets.list;
const originalFetch = globalThis.fetch;
let draft: WorkspaceSetupDraft;
beforeEach(()=>{
 draft={mode:"browse",category:"personal",preset_id:"",description:""};
 auth.onboardingStatus=mock(async()=>({project_id:"p",provider_configured:true,can_manage_provider:true}));
 workspaceSetup.get=mock(async()=>draft);
 workspaceSetup.save=mock(async(_,next)=>{draft=next;return next});
 workspaceSetup.proposal=mock(async()=>({revision:0,status:"empty" as const}));
 projectPresets.list=mock(async()=>({schema_version:2,presets:[starter,work,specialist]}));
 projectPresets.preview=mock(async()=>({preset:starter,planner:"selected" as const,confidence:1,project:{name:"New workspace",description:"Everyday planning",color:""},apps:[],agents:[{...starter.agents[0]!,unconscious:false,apps:starter.agents[0]!.apps || [],app_install_ids:[]}],layout:[],warnings:[]}));
 projectPresets.apply=mock(async()=>({status:"applied" as const,project_id:"p",preset_id:starter.id,created_agents:[{id:42,name:"Personal Assistant",status:"running"}],existing_agents:[],warnings:[]}));
 apps.list=mock(async()=>[]);
 apps.marketplace=mock(async()=>({apps:[],total:0,page_size:100} as any));
});
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;for(const {target,values} of originals)Object.assign(target,values)});
const mount=(finish=mock(async(_:string)=>{}))=>{render(<MemoryRouter><SetupFlow userId={1} projectId="p" onFinish={finish}/></MemoryRouter>);return finish};

test("recommendations stay small, More templates and search retain the alternatives",async()=>{
 mount();await screen.findByRole("button",{name:/Personal assistant/});
 expect(screen.queryByRole("button",{name:/Household/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/More templates/}));
 expect(screen.getByRole("button",{name:/Household/})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Show recommended presets"}));
 fireEvent.change(screen.getByRole("searchbox",{name:"Search presets"}),{target:{value:"Household"}});
 expect(screen.getByRole("button",{name:/Household/})).toBeTruthy();
 expect(projectPresets.apply).not.toHaveBeenCalled();
});

test("choose, review permissions, confirm once, and open the starter conversation",async()=>{
 const finish=mount();fireEvent.click(await screen.findByRole("button",{name:/Personal assistant/}));
 fireEvent.click(screen.getByRole("button",{name:"Use this preset"}));
 await screen.findByRole("heading",{name:"Personalize and confirm"});
 expect(screen.getByRole("region",{name:"Agent permissions"})).toBeTruthy();
 expect(screen.getByText(/New agents do not inherit/)).toBeTruthy();
 expect(projectPresets.apply).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole("textbox",{name:/What would you like help/}),{target:{value:"Everyday planning"}});
 fireEvent.click(screen.getByRole("button",{name:"Confirm and create workspace"}));
 fireEvent.click(await screen.findByRole("button",{name:"Talk to Personal Assistant"}));
 await waitFor(()=>expect(finish).toHaveBeenCalledWith("/conversations?agent=42",expect.anything()));
 expect(projectPresets.apply).toHaveBeenCalledTimes(1);
});

test("canceling before confirmation creates nothing",async()=>{
 mount();fireEvent.click(await screen.findByRole("button",{name:/Personal assistant/}));
 fireEvent.click(screen.getByRole("button",{name:"Use this preset"}));
 await screen.findByRole("heading",{name:"Personalize and confirm"});
 fireEvent.click(screen.getByRole("button",{name:"← Choose another preset"}));
 await screen.findByRole("searchbox",{name:"Search presets"});
 expect(projectPresets.apply).not.toHaveBeenCalled();
});


test("the real catalog adapter preserves recommendations and capability grants",async()=>{
 globalThis.fetch=mock(async()=>Response.json({templates:[{id:starter.id,kind:"project_setup",scope:"system",source:"system",schema_version:1,name:starter.name,description:starter.description,definition:{category:starter.category,recommended:true,agents:starter.agents}}]})) as unknown as typeof fetch;
 const catalog=await realList();
 expect(catalog.presets[0]!.recommended).toBe(true);
 expect(catalog.presets[0]!.agents[0]!.capabilities).toEqual(starter.agents[0]!.capabilities);
});
