import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { apps, auth, instances, integrations, invites, type InterfaceLevel } from "../api";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import { AudienceProvider } from "../hooks/useAudience";
import { Onboarding } from "./Onboarding";

const originals = [auth, apps, instances, integrations, invites].map((target) => ({ target, values: { ...target } }));
const originalFetch = globalThis.fetch;
let onboarded = false;
let configured = false;
let canManage = true;
let level: InterfaceLevel = "business";
const profile = () => ({ user_id: 1, email: "new@test.local", role: "admin" as const, created_at: "", onboarded, interface_level: level });
function Landing() {
  const { user } = useAuth();
  return <div>{user && user.onboarded ? "Conversation ready" : "Still needs onboarding"}</div>;
}
async function mount() {
  render(<MemoryRouter initialEntries={["/onboarding"]}><AuthProvider><AudienceProvider><Routes>
    <Route path="/onboarding" element={<Onboarding />} />
    <Route path="/conversations" element={<Landing />} />
    <Route path="/agents/new" element={<div>Agent wizard ready</div>} />
  </Routes></AudienceProvider></AuthProvider></MemoryRouter>);
  await waitFor(() => expect(auth.me).toHaveBeenCalled());
}
async function choose(mode: "personal" | "business" = "personal") {
  fireEvent.click(screen.getByRole("button", { name: mode === "personal" ? /For myself/ : /For my business/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
async function fillKey() {
  await screen.findByRole("button", { name: "Connect and get started" });
  fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: "test-key" } });
}
const connect = () => fireEvent.click(screen.getByRole("button", { name: "Connect and get started" }));
beforeEach(() => {
  onboarded = configured = false;
  canManage = true;
  level = "business";
  localStorage.clear();
  sessionStorage.clear();
  auth.me = mock(async () => profile());
  auth.updatePreferences = mock(async (prefs) => { level = prefs.interface_level!; return { language: "en", interface_level: level, ui_layout: {}, ui_layout_revision: 0 }; });
  auth.onboardingStatus = mock(async () => ({ project_id: "p", provider_configured: configured, can_manage_provider: canManage }));
  auth.completeOnboarding = mock(async () => { onboarded = true; return { status: "ok" }; });
  apps.list = mock(async () => [{ install_id: 7, name: "conversations", project_id: "", status: "running", ui_components: [{ name: "agent-conversations", entry: "/ui/Chat.mjs", slots: ["dashboard.build"] }] }] as Awaited<ReturnType<typeof apps.list>>);
  instances.create = mock(async () => ({ id: 11 }) as Awaited<ReturnType<typeof instances.create>>);
  instances.get = mock(async () => ({ id: 11, status: "stopped" }) as Awaited<ReturnType<typeof instances.get>>);
  instances.start = mock(async () => ({ id: 11, status: "running" }) as Awaited<ReturnType<typeof instances.start>>);
  integrations.runtimeCatalog = mock(async () => [{ slug: "test-provider", name: "Test provider", description: "", logo: null, role: "llm" as const, provider_key: "test", auth_types: ["api_key"], credential_fields: [{ name: "api_key", label: "API Key", required: true }] }]);
  integrations.connect = mock(async () => { configured = true; return { id: 9 } as Awaited<ReturnType<typeof integrations.connect>>; });
  integrations.testConnection = mock(async () => ({ ok: true, latency_ms: 1 }));
  integrations.connections = mock(async () => []);
  integrations.runtimeConnections = mock(async () => configured ? [{id:9,role:"llm",provider_key:"test",app_slug:"test-provider"}] as any : []);
  integrations.newAgentProvider = mock(async () => ({effective_provider:"test"}) as any);
  integrations.setNewAgentProvider = mock(async (provider) => ({effective_provider:provider}) as any);
  invites.create = mock(async () => ({token:"fixture-replacement-token"}) as any);
  invites.fulfill = mock(async () => ({status:"updated" as const,connection_id:9}));
  globalThis.fetch = mock(async () => Response.json({ id: "chat-first" })) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  for (const { target, values } of originals) Object.assign(target, values);
  globalThis.fetch = originalFetch;
});

for (const audience of ["personal", "business"] as const) test(`${audience} skips an existing provider and opens a real starter conversation`, async () => {
  configured = true;
  await mount();
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  await choose(audience);
  await screen.findByText("Conversation ready");
  expect(auth.updatePreferences).toHaveBeenCalledWith({ interface_level: audience });
  expect(integrations.connect).not.toHaveBeenCalled();
  expect(instances.create).toHaveBeenCalledWith(audience === "personal" ? "My assistant" : "Business assistant", expect.any(String), "learn", "p", false, expect.objectContaining({ idempotencyKey: "onboarding-starter:1", boundAppInstallIDs: [7], includeChannels: false, unconscious: false }));
  expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/apps/conversations/chats?"), expect.objectContaining({ body: expect.stringContaining('"audience":"operator"') }));
  expect(sessionStorage.getItem("apteva_project_id")).toBe("p");
});

test("connects and verifies a provider with one action before opening the assistant", async () => {
  await mount(); await choose(); await fillKey();
  expect(screen.queryByText(/Skip for now|Activate Helper|Create setup|Choose a theme/)).toBeNull();
  connect();
  await screen.findByText("Conversation ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
  expect(integrations.testConnection).toHaveBeenCalledWith(9);
  expect(instances.start).toHaveBeenCalledWith(11);
});

test("failed verification keeps setup open and retries the saved connection", async () => {
  integrations.testConnection = mock(async () => ({ ok: false, latency_ms: 1, error: "Invalid key" }));
  await mount(); await choose(); await fillKey(); connect();
  await screen.findByText("Invalid key");
  expect(instances.create).not.toHaveBeenCalled();
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  integrations.testConnection = mock(async () => ({ ok: true, latency_ms: 1 }));
  connect();
  await screen.findByText("Conversation ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
});

test("requires live models when a provider has no health check", async () => {
  integrations.testConnection = mock(async () => ({ ok: true, latency_ms: 1, skipped: true }));
  integrations.connectionModels = mock(async () => []);
  await mount(); await choose(); await fillKey(); connect();
  await screen.findByText(/No models are available/);
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  expect(integrations.connectionModels).toHaveBeenCalledWith(9, true);
});

test("waits for workspace preparation and blocks double submission", async () => {
  let resolve!: () => void;
  auth.updatePreferences = mock(async () => { await new Promise<void>((done) => { resolve = done; }); return { language: "en", interface_level: "personal" as const, ui_layout: {}, ui_layout_revision: 0 }; });
  await mount(); await choose();
  expect((screen.getByRole("button", { name: /Preparing your workspace/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(auth.onboardingStatus).not.toHaveBeenCalled();
  resolve();
  await screen.findByRole("heading", { name: "Connect your AI" });
  expect(auth.updatePreferences).toHaveBeenCalledTimes(1);
});

test("restricted members can recheck administrator-provided AI access", async () => {
  canManage = false;
  await mount(); await choose("business");
  await screen.findByText(/workspace administrator needs to connect AI/);
  expect(screen.queryByRole("button", { name: "Connect and get started" })).toBeNull();
  configured = true;
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Conversation ready");
});

for (const failure of ["start", "chat", "complete", "refresh"] as const) test(`allows safe retry after ${failure} fails`, async () => {
  configured = true;
  await mount();
  let fail = true;
  instances.start = mock(async () => { if (fail && failure === "start") throw new Error("Start failed"); return { id: 11, status: "running" } as Awaited<ReturnType<typeof instances.start>>; });
  globalThis.fetch = mock(async () => fail && failure === "chat" ? new Response("unavailable", { status: 503 }) : Response.json({ id: "chat-first" })) as unknown as typeof fetch;
  auth.completeOnboarding = mock(async () => { if (fail && failure === "complete") throw new Error("Completion failed"); onboarded = true; return { status: "ok" }; });
  auth.me = mock(async () => { if (fail && failure === "refresh" && onboarded) throw new Error("Profile failed"); return profile(); });
  await choose();
  await screen.findByRole("alert");
  expect(screen.queryByText("Conversation ready")).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Conversation ready");
  expect(instances.create).toHaveBeenCalledTimes(2);
  expect(instances.create).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), "learn", "p", false, expect.objectContaining({ idempotencyKey: "onboarding-starter:1" }));
});

test("developer setup keeps the optional AI path and agent wizard", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Developer setup" }));
  fireEvent.click(await screen.findByRole("button", { name: "Set up AI later" }));
  await screen.findByText("Agent wizard ready");
  expect(instances.create).not.toHaveBeenCalled();
});

 test("resumes an existing starter without creating another agent at the account quota", async () => {
  configured = true;
  auth.onboardingStatus = mock(async () => ({project_id: "p", provider_configured: true, can_manage_provider: false, starter_agent_id: 11}));
  await mount(); await choose();
  await screen.findByText("Conversation ready");
  expect(instances.create).not.toHaveBeenCalled();
  expect(instances.start).toHaveBeenCalledWith(11);
});


test("corrects saved credentials on the same connection before verification", async () => {
 integrations.testConnection = mock(async () => ({ok:true, skipped:true, latency_ms:1}));
 integrations.connectionModels = mock(async () => []);
 await mount(); await choose(); await fillKey(); connect();
 await screen.findByText(/No models are available/);
 fireEvent.change(document.querySelector('input[type="password"]')!, {target:{value:"corrected-test-key"}});
 integrations.connectionModels = mock(async () => [{id:"model-a"}] as any);
 connect();
 await screen.findByText("Conversation ready");
 expect(integrations.connect).toHaveBeenCalledTimes(1);
 expect(invites.create).toHaveBeenCalledWith({app_slug:"test-provider",connection_id:9,ttl_seconds:60});
 expect(invites.fulfill).toHaveBeenCalledWith("fixture-replacement-token",{credentials:{api_key:"corrected-test-key"}});
});

test("Back and Continue re-verifies a saved provider instead of bypassing failure", async () => {
 integrations.testConnection = mock(async () => ({ok:true, skipped:true, latency_ms:1}));
 integrations.connectionModels = mock(async () => []);
 await mount(); await choose(); await fillKey(); connect();
 await screen.findByText(/No models are available/);
 fireEvent.click(screen.getByRole("button",{name:"← Back"}));
 fireEvent.click(screen.getByRole("button",{name:"Continue"}));
 await screen.findByRole("heading",{name:"Connect your AI"});
 await screen.findByText(/No models are available/);
 expect(auth.completeOnboarding).not.toHaveBeenCalled();
 expect(instances.create).not.toHaveBeenCalled();
 expect(integrations.connectionModels).toHaveBeenCalledTimes(2);
});

test("reload checks existing credentials and lets the user repair them without duplicates", async () => {
 configured=true;
 integrations.testConnection=mock(async()=>({ok:false,error:"Expired key",latency_ms:1}));
 await mount(); await choose();
 await screen.findByText("Expired key");
 expect(auth.completeOnboarding).not.toHaveBeenCalled();
 await fillKey();
 integrations.testConnection=mock(async()=>({ok:true,latency_ms:1}));
 connect();
 await screen.findByText("Conversation ready");
 expect(integrations.connect).not.toHaveBeenCalled();
 expect(invites.fulfill).toHaveBeenCalledTimes(1);
});

test("replacement failure keeps the saved connection available for another correction",async()=>{
 integrations.testConnection=mock(async()=>({ok:false,error:"Invalid key",latency_ms:1}));
 await mount();await choose();await fillKey();connect();await screen.findByText("Invalid key");
 fireEvent.change(document.querySelector('input[type="password"]')!,{target:{value:"corrected"}});
 invites.fulfill=mock(async()=>{throw new Error("Temporary update failure");});
 connect();await screen.findByText("Temporary update failure");
 expect(auth.completeOnboarding).not.toHaveBeenCalled();
 invites.fulfill=mock(async()=>({status:"updated" as const,connection_id:9}));
 integrations.testConnection=mock(async()=>({ok:true,latency_ms:1}));
 connect();await screen.findByText("Conversation ready");
 expect(integrations.connect).toHaveBeenCalledTimes(1);
 expect(invites.fulfill).toHaveBeenCalledTimes(1);
});


test("switching from a failed provider uses the verified replacement for the starter", async () => {
  configured = true;
  let provider = "test";
  const catalog = await integrations.runtimeCatalog("llm");
  integrations.runtimeCatalog = mock(async () => [...catalog, { ...catalog[0]!, slug: "other-provider", name: "Other provider", provider_key: "other" }]);
  integrations.runtimeConnections = mock(async () => [
    { id: 9, role: "llm", provider_key: "test", app_slug: "test-provider" },
    { id: 10, role: "llm", provider_key: "other", app_slug: "other-provider" },
  ] as any);
  integrations.newAgentProvider = mock(async () => ({ effective_provider: provider }) as any);
  integrations.setNewAgentProvider = mock(async (next) => { provider = next; return { effective_provider: next } as any; });
  integrations.testConnection = mock(async (id) => ({ ok: id === 10, latency_ms: 1, error: id === 9 ? "Expired key" : undefined }));
  integrations.connect = mock(async () => ({ id: 10 }) as any);
  await mount(); await choose();
  await screen.findByText("Expired key");
  await screen.findByRole("button", { name: "Connect and get started" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "other-provider" } });
  await fillKey(); connect();
  await screen.findByText("Conversation ready");
  expect(integrations.setNewAgentProvider).toHaveBeenCalledWith("other", "p");
  expect(integrations.connect).toHaveBeenCalledWith("other-provider", "Other provider", { api_key: "test-key" }, "api_key", "", undefined, "integration", false);
  expect(invites.fulfill).not.toHaveBeenCalled();
});

test("managed AI without a user-owned connection can complete onboarding", async () => {
  configured = true;
  canManage = false;
  integrations.runtimeConnections = mock(async () => []);
  await mount(); await choose();
  await screen.findByText("Conversation ready");
  expect(integrations.testConnection).not.toHaveBeenCalled();
  expect(integrations.connect).not.toHaveBeenCalled();
});

test("a lost create response reuses the saved row when the user retries", async () => {
  integrations.connect = mock(async () => {
    configured = true;
    integrations.connections = mock(async () => [{ id: 9, app_slug: "test-provider", name: "Test provider", project_id: "" }] as any);
    throw new Error("Connection interrupted");
  });
  await mount(); await choose(); await fillKey(); connect();
  await screen.findByText("Connection interrupted");
  connect();
  await screen.findByText("Conversation ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
  expect(invites.create).toHaveBeenCalledWith({ app_slug: "test-provider", connection_id: 9, ttl_seconds: 60 });
});


test("an expired OAuth provider can be replaced without writing its connection", async () => {
  configured = true;
  let provider = "oauth";
  integrations.runtimeConnections = mock(async () => [
    { id: 8, role: "llm", provider_key: "oauth", app_slug: "oauth-provider" },
    { id: 9, role: "llm", provider_key: "test", app_slug: "test-provider" },
  ] as any);
  integrations.newAgentProvider = mock(async () => ({ effective_provider: provider }) as any);
  integrations.setNewAgentProvider = mock(async (next) => { provider = next; return { effective_provider: next } as any; });
  integrations.testConnection = mock(async (id) => ({ ok: id === 9, latency_ms: 1, error: id === 8 ? "OAuth session expired" : undefined }));
  await mount(); await choose();
  await screen.findByText("OAuth session expired");
  await fillKey(); connect();
  await screen.findByText("Conversation ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
  expect(integrations.setNewAgentProvider).toHaveBeenCalledWith("test", "p");
  expect(invites.fulfill).not.toHaveBeenCalled();
});
