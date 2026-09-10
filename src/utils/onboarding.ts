import { apps, instances, integrations, invites, type ConnectionInfo, type InterfaceLevel } from "../api";
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

// Use the same verification as the provider form on every onboarding entry,
// including a reload after a saved connection failed its model check.
export async function verifyOnboardingConnection(connectionId: number) {
  const test = await integrations.testConnection(connectionId);
  if (!test.ok) throw new Error(test.error || test.reason || "The connection did not work. Please check your key.");
  if (test.skipped) {
    const models = await integrations.connectionModels(connectionId, true);
    if (!models.length) throw new Error("No models are available through this connection. Please check your provider account.");
  }
}

export async function onboardingProviderConnection(projectId: string) {
  const [rows, preference] = await Promise.all([
    integrations.runtimeConnections(projectId), integrations.newAgentProvider(projectId),
  ]);
  // Runtime rows are ordered by project, primary credential, then ID, just
  // like the server's pool. Managed access may have no user-owned row.
  return rows.find((row) => row.role === "llm" && row.provider_key === preference.effective_provider);
}

export async function replaceOnboardingCredentials(connection: Pick<ConnectionInfo, "id" | "app_slug">, credentials: Record<string, string>) {
  // Credential replacement already exists through connection-bound access
  // links. Fulfill a short-lived token internally; never display or persist
  // it, and preserve the connection's identity, scope, and attachments.
  const invite = await invites.create({ app_slug: connection.app_slug, connection_id: connection.id, ttl_seconds: 60 });
  const result = await invites.fulfill(invite.token, { credentials });
  if (result.status !== "updated" || result.connection_id !== connection.id) throw new Error("Could not update the connection. Please try again.");
}
