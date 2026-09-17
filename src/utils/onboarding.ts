import { integrations, invites, type ConnectionInfo } from "../api";

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

// Both pasted credentials and browser sign-in must pass the same checks before
// becoming the default used by the starter agent in this workspace.
export async function verifyOnboardingProvider(connectionId: number, providerKey: string, projectId: string) {
  await verifyOnboardingConnection(connectionId);
  const preference = await integrations.newAgentProvider(projectId);
  if (preference.effective_provider !== providerKey) {
    await integrations.setNewAgentProvider(providerKey, projectId);
  }
}
