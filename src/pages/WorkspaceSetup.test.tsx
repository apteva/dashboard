import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { apps, auth, integrations, projectPresets, skills, workspaceSetup, platformHelper, instances, type WorkspaceSetupDraft } from "../api";
import { SetupFlow, workspaceSetupConversationSettings } from "./WorkspaceSetup";

const originalFetch = globalThis.fetch;
const originalEventSource = globalThis.EventSource;
const originals = [apps, auth, integrations, projectPresets, skills, workspaceSetup, platformHelper, instances].map((target) => ({ target, values: { ...target } }));
const business = { id: "business-preset", category: "business" as const, name: "Lead generation", description: "Research and qualify prospects", agents: [{ key: "leads", name: "Lead assistant", directive: "Research leads for {{description}}", mode: "cautious" as const, apps: ["conversations", "crm"] }], dashboard: [] };
const personal = { ...business, id: "personal-preset", category: "personal" as const, name: "Personal assistant" };
let saved: WorkspaceSetupDraft;
function mount(onFinish = mock(async (_destination: string) => {})) {
  return render(<MemoryRouter><Routes><Route path="/" element={<SetupFlow userId={1} projectId="p" onFinish={onFinish} />} /><Route path="/agents/new" element={<p>Manual agent wizard</p>} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  auth.prepareOnboarding = mock(async () => { throw new Error("Must not prepare while browsing"); });
  saved = { category: "business", preset_id: "", description: "", mode: "browse" };
  auth.onboardingStatus = mock(async () => ({ project_id: "p", provider_configured: true, can_manage_provider: true }));
  workspaceSetup.get = mock(async () => saved);
  workspaceSetup.save = mock(async (_, draft) => { saved = draft; return draft; });
  workspaceSetup.proposal = mock(async () => ({ revision: 0, status: "empty" as const }));
  workspaceSetup.confirm = mock(async () => ({ status: "confirmed", project_id: "p", agents: [], warnings: [] }));
  integrations.connections = mock(async () => []);
  skills.list = mock(async () => []);
  projectPresets.list = mock(async () => ({ schema_version: 2, presets: [business, personal] }));
  projectPresets.preview = mock(async () => ({ preset: business, planner: "selected" as const, confidence: 1, project: { name: "My workspace", description: "Research clinics", color: "" }, apps: [], agents: [{ ...business.agents[0]!, unconscious: false, app_install_ids: [], directive: "Research clinics" }], layout: [], warnings: [] }));
  projectPresets.apply = mock(async () => ({ status: "applied" as const, project_id: "p", preset_id: business.id, created_agents: [{ id: 11, name: "Lead assistant", status: "running" }], existing_agents: [], warnings: [] }));
  platformHelper.activate = mock(async () => { throw new Error("Should not activate while browsing"); });
  instances.create = mock(async () => { throw new Error("Should not create a starter"); });
});
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; globalThis.EventSource = originalEventSource; for (const { target, values } of originals) Object.assign(target, values); });

test("the dedicated setup conversation hides page context presentation only", () => {
  expect(workspaceSetupConversationSettings).toMatchObject({
    display_mode: "single",
    show_page_context: false,
  });
});

test("starts in the audience category, searches across categories, and has no provisioning side effects", async () => {
  mount();
  await screen.findByRole("button", { name: /Lead generation/ });
  expect(screen.queryByRole("button", { name: /Personal assistant/ })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search presets" }), { target: { value: "Personal assistant" } });
  expect(screen.getByRole("button", { name: /Personal assistant/ })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unknown" } });
  expect(screen.getByText(/No presets match/)).toBeTruthy();
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
  expect(projectPresets.apply).not.toHaveBeenCalled();
  expect(platformHelper.activate).not.toHaveBeenCalled();
  expect(instances.create).not.toHaveBeenCalled();
});

test("manual preset setup previews first and applies edited agent configuration", async () => {
  const finish = mock(async (_destination: string) => {});
  mount(finish);
  fireEvent.click(await screen.findByRole("button", { name: /Lead generation/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /What would you like help/ }), { target: { value: "Research clinics" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  const name = await screen.findByRole("textbox", { name: "Agent name" });
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
  expect(projectPresets.apply).not.toHaveBeenCalled();
  fireEvent.change(name, { target: { value: "Clinic assistant" } });
  fireEvent.click(screen.getByRole("button", { name: "Create setup" }));
  await screen.findByText("Your setup is ready");
  expect(projectPresets.apply).toHaveBeenCalledWith("p", { preset_id: business.id, description: "Research clinics", agent_overrides: [{ key: "leads", name: "Clinic assistant", directive: "Research clinics", mode: "cautious" }], interface_level: undefined });
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(finish).toHaveBeenCalledWith("/conversations?agent=11", "business"));
});

test("partial failures remain visible and retries reuse the same preset", async () => {
  saved = { category: "business", preset_id: business.id, description: "Research clinics", mode: "manual" };
  projectPresets.apply = mock(async () => ({ status: "applied" as const, project_id: "p", preset_id: business.id, created_agents: [], existing_agents: [{ id: 11, name: "Lead assistant", status: "stopped" }], warnings: ["CRM installation failed"] }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Create setup" }));
  await screen.findByText("Your setup needs attention");
  expect(screen.getByText("CRM installation failed")).toBeTruthy();
  expect(screen.queryByText("Your setup is ready")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
  await waitFor(() => expect(projectPresets.apply).toHaveBeenCalledTimes(2));
});

test("reload restores manual edits without applying them", async () => {
  saved = { category: "business", preset_id: business.id, description: "Research clinics", mode: "manual", agent_overrides: [{ key: "leads", name: "Saved name", directive: "Saved instructions", mode: "learn" }] };
  mount();
  expect((await screen.findByRole("textbox", { name: "Agent name" }) as HTMLInputElement).value).toBe("Saved name");
  expect((screen.getByRole("textbox", { name: "Instructions" }) as HTMLTextAreaElement).value).toBe("Saved instructions");
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
  expect(projectPresets.apply).not.toHaveBeenCalled();
});

test("saving failure blocks creation and allows retry", async () => {
  saved = { category: "business", preset_id: business.id, description: "Research clinics", mode: "manual" };
  workspaceSetup.save = mock(async () => { throw new Error("Save interrupted"); });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Create setup" }));
  await screen.findByText("Save interrupted");
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
  expect(projectPresets.apply).not.toHaveBeenCalled();
  workspaceSetup.save = mock(async (_, draft) => draft);
  fireEvent.click(screen.getByRole("button", { name: "Create setup" }));
  await screen.findByText("Your setup is ready");
});


test("setup begins with a mode choice and manual opens presets", async () => {
  saved.mode = "choice";
  mount();
  await screen.findByRole("button", { name: /Configure with AI/ });
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(platformHelper.activate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Explore presets/ }));
  await screen.findByRole("searchbox", { name: "Search presets" });
  expect(String(saved.mode)).toBe("browse");
  fireEvent.click(screen.getByRole("button", { name: "← Setup options" }));
  await screen.findByRole("button", { name: /Configure with AI/ });
  expect(String(saved.mode)).toBe("choice");
});

test("AI is offered only when connected", async () => {
  saved.mode = "choice";
  auth.onboardingStatus = mock(async () => ({ project_id: "p", provider_configured: false, can_manage_provider: true }));
  mount();
  await screen.findByRole("button", { name: /Explore presets/ });
  expect(screen.queryByRole("button", { name: /Configure with AI/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Connect AI" }).getAttribute("href")).toBe("/onboarding?provider=1");
});

test("AI failure stays on the conversation branch with retry and back", async () => {
  saved.mode = "choice";
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Configure with AI/ }));
  await screen.findByRole("alert");
  expect(String(saved.mode)).toBe("ai");
  expect(screen.queryByRole("searchbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "← Setup options" }));
  await screen.findByRole("button", { name: /Explore presets/ });
});


test("completion failure keeps the created setup available to retry", async () => {
  saved = { category: "business", preset_id: business.id, description: "Research clinics", mode: "manual" };
  const finish = mock(async (_destination: string) => { throw new Error("Completion interrupted"); });
  mount(finish);
  fireEvent.click(await screen.findByRole("button", { name: "Create setup" }));
  fireEvent.click(await screen.findByRole("button", { name: "Finish setup" }));
  await screen.findByText("Completion interrupted");
  expect(screen.getByText("Your setup is ready")).toBeTruthy();
  expect(projectPresets.apply).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(finish).toHaveBeenCalledTimes(2));
});


test("all categories are visible initially and category filtering does not choose an interface", async () => {
  saved.category = "";
  mount();
  await screen.findByRole("button", { name: /Personal assistant/ });
  expect(screen.getByRole("button", { name: /Lead generation/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:/^personal$/i}));
  expect(screen.queryByRole("button", {name:/Lead generation/})).toBeNull();
  expect(saved.interface_level).toBeUndefined();
});

test("preset recommendation is editable, persists, and only applies when finishing", async () => {
  projectPresets.list = mock(async () => ({ schema_version: 2, presets: [{...business, interface_level:"personal" as const}] }));
  const finish = mock(async (_destination: string, _level?: string) => {});
  mount(finish);
  fireEvent.click(await screen.findByRole("button", {name:/Lead generation/}));
  fireEvent.change(screen.getByRole("textbox", {name:/What would you like help/}), {target:{value:"Research clinics"}});
  fireEvent.click(screen.getByRole("button", {name:"Continue"}));
  const picker = await screen.findByRole("combobox", {name:"Your interface"});
  expect((picker as HTMLSelectElement).value).toBe("personal");
  fireEvent.change(picker, {target:{value:"developer"}});
  fireEvent.click(screen.getByRole("button", {name:"Create setup"}));
  await screen.findByRole("button", {name:"Finish setup"});
  expect(saved.interface_level).toBe("developer");
  expect(finish).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", {name:"Your interface"}), {target:{value:"business"}});
  fireEvent.click(screen.getByRole("button", {name:"Finish setup"}));
  await waitFor(() => expect(finish).toHaveBeenCalledWith("/conversations?agent=11", "business"));
  expect(projectPresets.apply).toHaveBeenCalledTimes(1);
});

test("reload preserves the chosen interface rather than taking the preset default again", async () => {
  saved = { category:"business", preset_id:business.id, description:"Research clinics", mode:"manual", interface_level:"developer" };
  mount();
  expect((await screen.findByRole("combobox", {name:"Your interface"}) as HTMLSelectElement).value).toBe("developer");
});


function mockHelperConversation() {
  globalThis.EventSource = class { onopen = null; onmessage = null; onerror = null; close() {} addEventListener() {} removeEventListener() {} } as unknown as typeof EventSource;
  saved.mode = "ai";
  platformHelper.status = mock(async () => ({activated:true, state:"running" as const, provider_configured:true, conversations_installed:true}));
  platformHelper.get = mock(async () => ({id:99, name:"Apteva Helper",status:"running"}) as any);
  apps.list = mock(async () => [{install_id:7,name:"conversations",display_name:"Conversations",description:"Agent conversations",icon:"/icons/conversations.svg",icon_style:"image",version:"1.0.0",project_id:"",status:"running",surfaces:{mcp_tool_count:2,mcp_tool_names:["conversation_list","conversation_send"],skill_count:1},ui_components:[{name:"agent-conversations",entry:"/ui/Chat.mjs",slots:["dashboard.build"]}]}] as any);
  apps.marketplace = mock(async () => ({registry_url:"local",apps:[{name:"conversations",display_name:"Conversations",description:"Agent conversations",icon:"/icons/conversations.svg",icon_style:"image",version:"1.0.0",author:"Apteva",repo:"",manifest_url:"",tags:[],official:true,category:"communication",installed:true,builtin:true,surfaces:{mcp_tool_count:2,mcp_tool_names:["conversation_list","conversation_send"],skill_count:1}}]}) as any);
  integrations.connections = mock(async () => [{id:4,app_slug:"fireworks",app_name:"Fireworks",name:"Fireworks",logo:"/icons/fireworks.svg",auth_type:"api_key",status:"active",source:"local",tool_count:3,created_at:"now"}] as any);
  skills.list = mock(async () => [{id:5,slug:"using-conversations",name:"Using Conversations",description:"Use conversation tools well",body:"Always preserve the conversation context.",source:"app",project_id:"p",enabled:true,version:"1.0.0",created_at:"now",updated_at:"now",app_name:"conversations"}] as any);
  let applied = false;
  projectPresets.apply = mock(async () => {
    applied = true;
    return { status: "applied" as const, project_id: "p", preset_id: business.id, created_agents: [{ id: 11, name: "Lead assistant", status: "running" }], existing_agents: [], warnings: [] };
  });
  workspaceSetup.proposal = mock(async () => ({
    revision: applied ? 2 : 1,
    status: applied ? "ready" as const : "proposed" as const,
    preview: {
      preset: business,
      planner: "selected" as const,
      confidence: 1,
      project: { name: "Lead research workspace", description: "Research clinics", color: "" },
      apps: [{name:"conversations",installed:true,install_id:7,scope:"global" as const}],
      agents: [{ ...business.agents[0]!, unconscious: false, app_install_ids: [], directive: "Research clinics" }],
      layout: [],
      warnings: applied ? [] : ["tasks is assigned by the preset but not installed for this project", "dashboard widget tasks:overview is unavailable until its app is installed"],
    },
    ...(applied ? { result: { agents: [{ id: 11, name: "Lead assistant", status: "running" }], warnings: [] } } : {}),
  }));
  globalThis.fetch = mock(async (url) => String(url).includes("/ui/contributions")
    ? Response.json({contributions:[{app:"conversations",component:"agent-conversations",eligible:true}]})
    : Response.json({id:"setup-chat"})) as unknown as typeof fetch;
}

test("AI review reads the real staged workspace and never completes before activation", async () => {
  mockHelperConversation();
  instances.list = mock(async () => [{id:11,name:"Planner",status:"stopped",mode:"cautious",directive:"Research clinics",config:JSON.stringify({onboarding_staged:true})}] as any);
  const finish = mock(async (_destination: string, _level?: string) => {});
  mount(finish);
  const reviewButton = await screen.findByRole("button", {name:"Review setup"}) as HTMLButtonElement;
  await waitFor(() => expect(reviewButton.disabled).toBe(false));
  // Helper's apply updates the server draft while the conversation is open.
  saved = {...saved, preset_id:personal.id, interface_level:"personal"};
  fireEvent.click(reviewButton);
  await screen.findByRole("heading", {name:"Review your workspace"});
  expect(screen.getByText("Planner")).toBeTruthy();
  expect(screen.queryByText(/not installed for this project/)).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"View Planner details"}));
  expect(screen.getByRole("dialog", {name:"Planner"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Close details"}));
  fireEvent.click(screen.getByRole("button", {name:"View Conversations details"}));
  expect(screen.getByRole("dialog", {name:"Conversations"})).toBeTruthy();
  expect(screen.getByText("Agent conversations")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Close details"}));
  expect((screen.getByRole("combobox", {name:"Your interface"}) as HTMLSelectElement).value).toBe("personal");
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Confirm and activate"}));
  await screen.findByRole("button", {name:"Finish setup"});
  expect(workspaceSetup.confirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", {name:"Finish setup"}));
  await waitFor(() => expect(finish).toHaveBeenCalledWith("/", "personal"));
});

test("AI review waits until Helper has created a real agent", async () => {
  mockHelperConversation();
  instances.list = mock(async () => []);
  const finish = mock(async (_destination: string) => {});
  mount(finish);
  const reviewButton = await screen.findByRole("button", {name:"Review setup"}) as HTMLButtonElement;
  await waitFor(() => expect(reviewButton.disabled).toBe(true));
  expect(screen.queryByRole("button", {name:"Confirm and activate"})).toBeNull();
  expect(finish).not.toHaveBeenCalled();
});
