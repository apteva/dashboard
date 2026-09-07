import { apps, instances, type InterfaceLevel } from "../api";
import { contributionsFor } from "../components/apps/contributions";

export async function prepareOnboardingConversation(userId: number, projectId: string, audience: InterfaceLevel, starterAgentId?: number) {
  const rows = await apps.list(projectId);
  const conversationApp = contributionsFor(rows, "dashboard.build").find((item) =>
    item.app.name === "conversations" && item.spec.name === "agent-conversations" &&
    !(item.app as { project_id?: string }).project_id,
  );
  if (!conversationApp) throw new Error("Conversations is not ready yet. Please try again.");
  const agent = starterAgentId ? { id: starterAgentId } : await instances.create(
    audience === "personal" ? "My assistant" : "Business assistant",
    `Help the user with ${audience === "personal" ? "everyday tasks and personal projects" : "their business tasks"}. Start by understanding what they want to accomplish. Ask concise clarifying questions when needed, then help with the first useful step. Use Conversations for replies. Explain when a task needs a connection that is not yet available. Ask before consequential external actions.`,
    "learn", projectId, false,
    { idempotencyKey: `onboarding-starter:${userId}`, includeChannels: false, unconscious: false, boundAppInstallIDs: [conversationApp.app.install_id] },
  );
  // A retry may return the same stopped agent after a failed startup.
  let current = await instances.get(agent.id);
  if (current.status !== "running") current = await instances.start(agent.id);
  if (current.status !== "running") throw new Error("Your assistant could not start. Please try again.");

  const query = new URLSearchParams({ project_id: projectId, install_id: String(conversationApp.app.install_id) });
  const response = await fetch(`/api/apps/conversations/chats?${query}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agent.id, project_id: projectId, title: "Getting started", conversation_key: `onboarding:${userId}:${agent.id}`, audience: "operator" }),
  });
  if (!response.ok) throw new Error("Could not open your first conversation. Please try again.");
  const conversation = await response.json() as { id: string };
  if (!conversation.id) throw new Error("Your conversation is not ready yet. Please try again.");
  // The new Layout's ProjectProvider must open the workspace we prepared,
  // including when the browser retains a project from another account.
  window.sessionStorage.setItem("apteva_project_id", projectId);
  window.localStorage.setItem("apteva_project_id", projectId);
  return `/conversations?${new URLSearchParams({ agent: String(agent.id), chat: conversation.id })}`;
}
