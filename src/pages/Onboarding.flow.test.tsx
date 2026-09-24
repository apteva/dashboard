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
  return <div>{user && !user.onboarded ? "Setup options ready" : "Prematurely completed onboarding"}</div>;
}
async function mount() {
  render(<MemoryRouter initialEntries={["/onboarding"]}><AuthProvider><AudienceProvider><Routes>
    <Route path="/onboarding" element={<Onboarding />} />
    <Route path="/onboarding/setup" element={<Landing />} />
    <Route path="/agents/new" element={<div>Agent wizard ready</div>} />
  </Routes></AudienceProvider></AuthProvider></MemoryRouter>);
  await waitFor(() => expect(auth.me).toHaveBeenCalled());
}
async function fillKey() {
  await waitFor(() => {
    if (screen.queryByRole("button", { name: "Connect and get started" })) return;
    fireEvent.click(screen.getByRole("button", { name: /Test provider.*Choose/ }));
  });
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
  auth.prepareOnboarding = mock(async () => ({status:"ready"}));
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

for (const audience of ["personal", "business"] as const) test(`${audience} skips an existing provider and opens presets without creating an agent`, async () => {
  configured = true;
  level = audience;
  await mount();
  await screen.findByText("Setup options ready");
  expect(auth.updatePreferences).not.toHaveBeenCalled();
  expect(integrations.connect).not.toHaveBeenCalled();
  expect(instances.create).not.toHaveBeenCalled();
  expect(instances.start).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("apteva_project_id")).toBe("p");
});

test("connects and verifies a provider with one action before offering presets", async () => {
  await mount(); await fillKey();
  expect(screen.queryByText(/Skip for now|Activate Helper|Create setup|Choose a theme/)).toBeNull();
  connect();
  await screen.findByText("Setup options ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
  expect(integrations.testConnection).toHaveBeenCalledWith(9);
  expect(instances.start).not.toHaveBeenCalled();
});

test("failed verification keeps setup open and retries the saved connection", async () => {
  integrations.testConnection = mock(async () => ({ ok: false, latency_ms: 1, error: "Invalid key" }));
  await mount(); await fillKey(); connect();
  await screen.findByText("Invalid key");
  expect(instances.create).not.toHaveBeenCalled();
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  integrations.testConnection = mock(async () => ({ ok: true, latency_ms: 1 }));
  connect();
  await screen.findByText("Setup options ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
});

test("requires live models when a provider has no health check", async () => {
  integrations.testConnection = mock(async () => ({ ok: true, latency_ms: 1, skipped: true }));
  integrations.connectionModels = mock(async () => []);
  await mount(); await fillKey(); connect();
  await screen.findByText(/No models are available/);
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  expect(integrations.connectionModels).toHaveBeenCalledWith(9, true);
});

test("provider success opens setup without preparing Conversations", async () => {
  configured = true;
  auth.prepareOnboarding = mock(async () => { throw new Error("Must not install during provider connection"); });
  await mount();
  await screen.findByText("Setup options ready");
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
  expect(auth.updatePreferences).not.toHaveBeenCalled();
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
});

test("restricted members can recheck administrator-provided AI access", async () => {
  canManage = false;
  await mount(); await screen.findByText(/workspace administrator needs to connect AI/);
  expect(screen.queryByRole("button", { name: "Connect and get started" })).toBeNull();
  configured = true;
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Setup options ready");
});

test("provider success leaves onboarding incomplete until workspace setup finishes", async () => {
  configured = true;
  await mount(); await screen.findByText("Setup options ready");
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  expect(onboarded).toBe(false);
});

test("starts with searchable AI providers, without an audience or developer fork", async () => {
  await mount();
  await screen.findByRole("searchbox", {name:"Search providers"});
  expect(screen.queryByText("For myself")).toBeNull();
  expect(screen.queryByText("For my business")).toBeNull();
  expect(screen.queryByText("Developer setup")).toBeNull();
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
});

 test("preserves an existing starter while offering presets", async () => {
  configured = true;
  auth.onboardingStatus = mock(async () => ({project_id: "p", provider_configured: true, can_manage_provider: false, starter_agent_id: 11}));
  await mount(); await screen.findByText("Setup options ready");
  expect(instances.create).not.toHaveBeenCalled();
  expect(instances.start).not.toHaveBeenCalled();
});


test("corrects saved credentials on the same connection before verification", async () => {
 integrations.testConnection = mock(async () => ({ok:true, skipped:true, latency_ms:1}));
 integrations.connectionModels = mock(async () => []);
 await mount(); await fillKey(); connect();
 await screen.findByText(/No models are available/);
 fireEvent.change(document.querySelector('input[type="password"]')!, {target:{value:"corrected-test-key"}});
 integrations.connectionModels = mock(async () => [{id:"model-a"}] as any);
 connect();
 await screen.findByText("Setup options ready");
 expect(integrations.connect).toHaveBeenCalledTimes(1);
 expect(invites.create).toHaveBeenCalledWith({app_slug:"test-provider",connection_id:9,ttl_seconds:60});
 expect(invites.fulfill).toHaveBeenCalledWith("fixture-replacement-token",{credentials:{api_key:"corrected-test-key"}});
});

test("Reload re-verifies a saved provider instead of bypassing failure", async () => {
 integrations.testConnection = mock(async () => ({ok:true, skipped:true, latency_ms:1}));
 integrations.connectionModels = mock(async () => []);
 await mount(); await fillKey(); connect();
 await screen.findByText(/No models are available/);
 cleanup();
 await mount();
 await screen.findByRole("heading",{name:"Connect your AI"});
 await screen.findByText(/No models are available/);
 expect(auth.completeOnboarding).not.toHaveBeenCalled();
 expect(instances.create).not.toHaveBeenCalled();
 expect(integrations.connectionModels).toHaveBeenCalledTimes(2);
});

test("reload checks existing credentials and lets the user repair them without duplicates", async () => {
 configured=true;
 integrations.testConnection=mock(async()=>({ok:false,error:"Expired key",latency_ms:1}));
 await mount(); await screen.findByText("Expired key");
 expect(auth.completeOnboarding).not.toHaveBeenCalled();
 await fillKey();
 integrations.testConnection=mock(async()=>({ok:true,latency_ms:1}));
 connect();
 await screen.findByText("Setup options ready");
 expect(integrations.connect).not.toHaveBeenCalled();
 expect(invites.fulfill).toHaveBeenCalledTimes(1);
});

test("replacement failure keeps the saved connection available for another correction",async()=>{
 integrations.testConnection=mock(async()=>({ok:false,error:"Invalid key",latency_ms:1}));
 await mount();await fillKey();connect();await screen.findByText("Invalid key");
 fireEvent.change(document.querySelector('input[type="password"]')!,{target:{value:"corrected"}});
 invites.fulfill=mock(async()=>{throw new Error("Temporary update failure");});
 connect();await screen.findByText("Temporary update failure");
 expect(auth.completeOnboarding).not.toHaveBeenCalled();
 invites.fulfill=mock(async()=>({status:"updated" as const,connection_id:9}));
 integrations.testConnection=mock(async()=>({ok:true,latency_ms:1}));
 connect();await screen.findByText("Setup options ready");
 expect(integrations.connect).toHaveBeenCalledTimes(1);
 expect(invites.fulfill).toHaveBeenCalledTimes(1);
});


test("switching from a failed provider uses the verified replacement for setup", async () => {
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
  await mount(); await screen.findByText("Expired key");
  await screen.findByRole("button", { name: "Connect and get started" });
  fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
  fireEvent.click(screen.getByRole("button", { name: /Other provider.*Choose/ }));
  await fillKey(); connect();
  await screen.findByText("Setup options ready");
  expect(integrations.setNewAgentProvider).toHaveBeenCalledWith("other", "p");
  expect(integrations.connect).toHaveBeenCalledWith("other-provider", "Other provider", { api_key: "test-key" }, "api_key", "", undefined, "integration", false);
  expect(invites.fulfill).not.toHaveBeenCalled();
});

test("managed AI without a user-owned connection can complete onboarding", async () => {
  configured = true;
  canManage = false;
  integrations.runtimeConnections = mock(async () => []);
  await mount(); await screen.findByText("Setup options ready");
  expect(integrations.testConnection).not.toHaveBeenCalled();
  expect(integrations.connect).not.toHaveBeenCalled();
});

test("a lost create response reuses the saved row when the user retries", async () => {
  integrations.connect = mock(async () => {
    configured = true;
    integrations.connections = mock(async () => [{ id: 9, app_slug: "test-provider", name: "Test provider", project_id: "" }] as any);
    throw new Error("Connection interrupted");
  });
  await mount(); await fillKey(); connect();
  await screen.findByText("Connection interrupted");
  connect();
  await screen.findByText("Setup options ready");
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
  await mount(); await screen.findByText("OAuth session expired");
  await fillKey(); connect();
  await screen.findByText("Setup options ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
  expect(integrations.setNewAgentProvider).toHaveBeenCalledWith("test", "p");
  expect(invites.fulfill).not.toHaveBeenCalled();
});


test("provider choice is searchable and never defaults to OpenAI", async () => {
  const [base] = await integrations.runtimeCatalog("llm");
  integrations.runtimeCatalog = mock(async () => [
    { ...base!, slug: "openai-api", name: "OpenAI", provider_key: "openai", description: "GPT models" },
    { ...base!, slug: "anthropic", name: "Anthropic", provider_key: "anthropic", description: "Claude models" },
    { ...base!, slug: "gemini", name: "Google Gemini", provider_key: "gemini", description: "Google AI" },
  ]);
  await mount(); const search = await screen.findByRole("searchbox", { name: "Search providers" });
  expect(screen.queryByRole("button", { name: "Connect and get started" })).toBeNull();
  expect(screen.getAllByRole("button", { name: /Choose$/ })).toHaveLength(3);
  fireEvent.change(search, { target: { value: "claude" } });
  expect(screen.queryByRole("button", { name: /OpenAI.*Choose/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Anthropic.*Choose/ }));
  expect(screen.getByRole("heading", { name: "Anthropic" })).toBeTruthy();
  const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  fireEvent.change(password, { target: { value: "anthropic-only-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Change provider" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing matches" } });
  expect(screen.getByText("No providers match your search.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  fireEvent.click(screen.getByRole("button", { name: /Google Gemini.*Choose/ }));
  expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  expect(integrations.connect).not.toHaveBeenCalled();
});

const codexEntry = { slug: "openai-codex", name: "OpenAI Codex", description: "Sign in with your ChatGPT account", logo: null, role: "llm" as const, provider_key: "openai-codex", auth_types: ["oauth_device_code"], credential_fields: [] };
const deviceSession = { session_id: "onboarding-device-session", provider: "openai-codex", method: "oauth_device_code", verification_uri: "https://auth.openai.com/codex/device", user_code: "TEST-CODE", expires_at: "2099-01-01T00:00:00Z", interval_seconds: 2 };
function mockCodex() {
  integrations.runtimeCatalog = mock(async () => [codexEntry]);
  integrations.connect = mock(async () => ({ connection: {id: 12, app_slug: "openai-codex", name: "OpenAI Codex"}, device_auth: deviceSession }) as any);
  integrations.reauth = mock(async () => ({ connection: {id: 12, app_slug: "openai-codex", name: "OpenAI Codex"}, device_auth: {...deviceSession,session_id:"retried-session"} }) as any);
  let preferred = "test";
  integrations.newAgentProvider = mock(async () => ({effective_provider:preferred}) as any);
  integrations.setNewAgentProvider = mock(async (next) => {preferred=next;return {effective_provider:next} as any;});
  integrations.runtimeConnections = mock(async () => configured ? [{id:12, role:"llm", provider_key:"openai-codex", app_slug:"openai-codex"}] as any : []);
}
async function pickCodex() {
  await mount(); fireEvent.click(await screen.findByRole("button", {name:"OpenAI Codex Choose"}));
  expect(document.querySelector('input[type="password"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"Sign in with OpenAI Codex"}));
  await screen.findByDisplayValue("TEST-CODE");
}

test("Codex sign-in waits for authorization and verification before offering presets", async () => {
  mockCodex();
  integrations.deviceAuthPoll = mock(async () => { configured=true; return {status:"connected"}; });
  await pickCodex();
  expect(screen.getByRole("link", {name:/Open sign-in page/}).getAttribute("href")).toBe(deviceSession.verification_uri);
  expect(integrations.connect).toHaveBeenCalledWith("openai-codex","OpenAI Codex",{},"oauth_device_code","",undefined,"integration",false);
  expect(integrations.testConnection).not.toHaveBeenCalled();
  expect(instances.create).not.toHaveBeenCalled();
  await screen.findByText("Setup options ready", {}, {timeout:5000});
  expect(integrations.deviceAuthPoll).toHaveBeenCalledWith(deviceSession.session_id);
  expect(integrations.testConnection).toHaveBeenCalledWith(12);
  expect(integrations.setNewAgentProvider).toHaveBeenCalledWith("openai-codex","p");
  expect(invites.fulfill).not.toHaveBeenCalled();
});

test("Codex copy uses a fallback and keeps sign-in open if copying is blocked", async () => {
  mockCodex();
  integrations.deviceAuthPoll = mock(async () => ({status:"pending"}));
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
  const writeText = mock(async () => { throw new Error("Clipboard access denied"); });
  const execCommand = mock(() => true);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  try {
    await pickCodex();
    fireEvent.click(screen.getByRole("button", {name:"Copy code"}));
    await screen.findByRole("button", {name:"Copied"});
    expect(writeText).toHaveBeenCalledWith("TEST-CODE");
    expect(execCommand).toHaveBeenCalledWith("copy");

    execCommand.mockImplementation(() => false);
    fireEvent.click(screen.getByRole("button", {name:"Copied"}));
    await screen.findByRole("alert");
    const code = screen.getByRole("textbox", {name:"Sign-in code"}) as HTMLInputElement;
    expect(code.value).toBe("TEST-CODE");
    expect(code.selectionStart).toBe(0);
    expect(code.selectionEnd).toBe(code.value.length);
    expect(screen.getByRole("link", {name:/Open sign-in page/})).toBeTruthy();
    expect(integrations.reauth).not.toHaveBeenCalled();
  } finally {
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (execCommandDescriptor) Object.defineProperty(document, "execCommand", execCommandDescriptor);
    else Reflect.deleteProperty(document, "execCommand");
  }
});

test("expired Codex authorization retries the same connection without advancing onboarding", async () => {
  mockCodex();
  integrations.deviceAuthPoll = mock(async () => ({status:"expired", error:"Sign-in code expired"}));
  await pickCodex();
  await screen.findByText("Sign-in code expired", {}, {timeout:5000});
  expect(instances.create).not.toHaveBeenCalled();
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", {name:"Sign in with OpenAI Codex"}));
  await screen.findByDisplayValue("TEST-CODE");
  expect(integrations.reauth).toHaveBeenCalledWith(12);
  expect(integrations.connect).toHaveBeenCalledTimes(1);
});

test("a saved Codex connection is reauthenticated in place", async () => {
  mockCodex(); configured=true;
  integrations.newAgentProvider=mock(async()=>({effective_provider:"openai-codex"}) as any);
  integrations.testConnection=mock(async()=>({ok:false,error:"Codex session expired",latency_ms:1}));
  integrations.deviceAuthPoll=mock(async()=>({status:"pending"}));
  await mount();await screen.findByText("Codex session expired");
  fireEvent.click(await screen.findByRole("button",{name:"Sign in with OpenAI Codex"}));
  await screen.findByDisplayValue("TEST-CODE");
  expect(integrations.reauth).toHaveBeenCalledWith(12);
  expect(integrations.connect).not.toHaveBeenCalled();
  expect(invites.fulfill).not.toHaveBeenCalled();
});

test("leaving Codex sign-in ignores a late session response", async () => {
  mockCodex();
  let resolve!: (result: any) => void;
  integrations.connect=mock(async()=>await new Promise<any>((done)=>{resolve=done;}));
  integrations.deviceAuthPoll=mock(async()=>({status:"connected"}));
  await mount();fireEvent.click(await screen.findByRole("button",{name:"OpenAI Codex Choose"}));
  fireEvent.click(screen.getByRole("button",{name:"Sign in with OpenAI Codex"}));
  await waitFor(()=>expect(integrations.connect).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button",{name:"Change provider"}));
  resolve({connection:{id:12,app_slug:"openai-codex"},device_auth:deviceSession});
  await screen.findByRole("searchbox");
  expect(screen.queryByDisplayValue("TEST-CODE")).toBeNull();
  expect(integrations.deviceAuthPoll).not.toHaveBeenCalled();
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
});

test("authorized Codex must pass verification and can retry without signing in again", async () => {
  mockCodex();
  integrations.deviceAuthPoll=mock(async()=>{configured=true;return {status:"connected"};});
  integrations.testConnection=mock(async()=>({ok:false,error:"Provider temporarily unavailable",latency_ms:1}));
  await pickCodex();
  await screen.findByText("Provider temporarily unavailable", {}, {timeout:5000});
  expect(auth.completeOnboarding).not.toHaveBeenCalled();
  expect(integrations.setNewAgentProvider).not.toHaveBeenCalled();
  integrations.testConnection=mock(async()=>({ok:true,latency_ms:1}));
  fireEvent.click(screen.getByRole("button",{name:"Continue with this provider"}));
  await screen.findByText("Setup options ready");
  expect(integrations.connect).toHaveBeenCalledTimes(1);
  expect(integrations.reauth).not.toHaveBeenCalled();
});
