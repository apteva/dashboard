import type { Agent, ProviderRestartResult } from "../api";

// A core gets provider credentials only when it starts. The server restarts an
// agent when a provider switch needs credentials its core doesn't have, and
// flags a running agent whose credentials changed after it started.

export interface ProviderSaveNotice {
  tone: "success" | "error";
  message: string;
}

/** What saving a provider change did to the running agent, if anything. */
export function providerSaveNotice(
  agentName: string,
  result: ProviderRestartResult | null | undefined,
): ProviderSaveNotice | null {
  if (!result) return null;
  if (result.restarted) {
    return { tone: "success", message: `Restarted ${agentName} so it can use its new provider.` };
  }
  if (result.restart_error) {
    return {
      tone: "error",
      message: `Saved, but ${agentName} couldn't restart to use its new provider: ${result.restart_error}. Restart it to apply the change.`,
    };
  }
  return null;
}

/** Why a running agent needs a restart, or "" when it doesn't. */
export function restartNeededMessage(agent: Agent): string {
  if (agent.status !== "running" || !agent.needs_restart) return "";
  if (agent.provider_unavailable) {
    return `It can't run ${agent.provider_unavailable.name} until it restarts, and it isn't using another provider in its place.`;
  }
  return "Its provider credentials changed after it started. It keeps using the old ones until it restarts.";
}
