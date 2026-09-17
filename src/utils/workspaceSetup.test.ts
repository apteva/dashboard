import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { apps, auth, platformHelper, instances, type WorkspaceSetupDraft } from "../api";
import { openWorkspaceHelper } from "./workspaceSetup";

const originals = [apps, auth, platformHelper, instances].map((target) => ({ target, values: { ...target } }));
const originalFetch = globalThis.fetch;
const draft: WorkspaceSetupDraft = { category: "business", preset_id: "business-leads", description: "Qualify clinic leads", mode: "ai" };
let calls: Array<{ path: string; body: any }>;
let activated: boolean;
beforeEach(() => {
  calls = []; activated = false;
  auth.prepareOnboarding = mock(async () => ({ status: "ready" }));
  auth.onboardingStatus = mock(async () => ({project_id:"p", provider_configured:true, can_manage_provider:true}));
  platformHelper.status = mock(async () => ({ activated, state: activated ? "running" as const : "inactive" as const, provider_configured: true, conversations_installed: true }));
  platformHelper.activate = mock(async () => { activated = true; return platformHelper.status(); });
  platformHelper.get = mock(async () => ({ id: 99, status: "running", name: "Apteva Helper" }) as any);
  instances.create = mock(async () => { throw new Error("No starter should be created"); });
  apps.list = mock(async () => [{ install_id: 7, name: "conversations", project_id: "", status: "running", ui_components: [{ name: "agent-conversations", entry: "/ui/Chat.mjs", slots: ["dashboard.build"] }] }] as any);
  globalThis.fetch = mock(async (url, init) => {
    const path = String(url); const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    if (path.includes("/ui/contributions")) return Response.json({ contributions: [{ app: "conversations", component: "agent-conversations", eligible: true }] });
    if (path.includes("/chats?")) return Response.json({ id: "setup-chat" });
    return Response.json({ id: "first-message" });
  }) as unknown as typeof fetch;
});
afterEach(() => { for (const { target, values } of originals) Object.assign(target, values); globalThis.fetch = originalFetch; });

test("AI opens an empty durable operator conversation for Helper-led proactivity", async () => {
  const result = await openWorkspaceHelper(1, "project-a", draft);
  expect(platformHelper.activate).toHaveBeenCalledWith(false);
  expect(auth.prepareOnboarding).not.toHaveBeenCalled();
  expect(result.helper.id).toBe(99);
  expect(result.conversationId).toBe("setup-chat");
  const chat = calls.find((call) => call.path.includes("/chats?"))!;
  expect(chat.body.agent_id).toBe(99);
  expect(chat.body.audience).toBe("operator");
  expect(chat.body.project_id).toBe("project-a");
  expect(calls.some((call) => call.path.includes("/messages?"))).toBe(false);
  expect(instances.create).not.toHaveBeenCalled();
});

test("reloads reuse the same empty conversation identity", async () => {
  await openWorkspaceHelper(1, "p", draft);
  await openWorkspaceHelper(1, "p", draft);
  const chats = calls.filter((call) => call.path.includes("/chats?"));
  expect(chats[0]!.body.conversation_key).toBe(chats[1]!.body.conversation_key);
  expect(calls.filter((call) => call.path.includes("/messages?")).length).toBe(0);
  expect(platformHelper.activate).toHaveBeenCalledTimes(1);
  await openWorkspaceHelper(2, "p", draft);
  expect(calls.filter((call) => call.path.includes("/chats?"))[2]!.body.conversation_key).not.toBe(chats[0]!.body.conversation_key);
});

test("changing setup draft does not inject a user message", async () => {
  await openWorkspaceHelper(1, "p", draft);
  await openWorkspaceHelper(1, "p", { ...draft, description: "Manage support" });
  expect(calls.filter((call) => call.path.includes("/messages?")).length).toBe(0);
});

test("failed Helper activation never creates a conversation or starter", async () => {
  platformHelper.activate = mock(async () => { throw new Error("Provider unavailable"); });
  await expect(openWorkspaceHelper(1, "p", draft)).rejects.toThrow("Provider unavailable");
  expect(calls).toHaveLength(0);
  expect(instances.create).not.toHaveBeenCalled();
});

test("AI prepares missing Conversations before activating Helper", async () => {
  const order: string[] = [];
  platformHelper.status = mock(async () => ({activated:false, state:"inactive" as const, provider_configured:true, conversations_installed:false}));
  auth.prepareOnboarding = mock(async () => { order.push("prepare"); return {status:"ready"}; });
  platformHelper.activate = mock(async () => { order.push("activate"); return platformHelper.status(); });
  const progress = mock((_message: string) => {});
  await openWorkspaceHelper(1, "p", draft, progress);
  expect(auth.prepareOnboarding).toHaveBeenCalledWith("ai");
  expect(order).toEqual(["prepare", "activate"]);
  expect(progress).toHaveBeenCalledWith("Preparing Conversations for AI setup…");
});

test("failed AI preparation stops activation and can be retried", async () => {
  platformHelper.status = mock(async () => ({activated:false, state:"inactive" as const, provider_configured:true, conversations_installed:false}));
  auth.prepareOnboarding = mock(async () => { throw new Error("Download failed"); });
  await expect(openWorkspaceHelper(1,"p",draft)).rejects.toThrow("Download failed");
  expect(platformHelper.activate).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
  auth.prepareOnboarding = mock(async () => ({status:"ready"}));
  await openWorkspaceHelper(1,"p",draft);
  expect(platformHelper.activate).toHaveBeenCalledTimes(1);
});
