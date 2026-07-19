import { chat, type Agent, type ChatRow } from "../api";

export function latestDirectConversationForAgent(conversations: ChatRow[], agentId: number): ChatRow | null {
  return conversations.find((conversation) =>
    !conversation.id.startsWith("default-") &&
    conversation.kind === "direct" &&
    conversation.agent_ids.length === 1 &&
    conversation.agent_ids[0] === agentId,
  ) || null;
}

// Called only from an explicit user action such as an agent card's Chat
// command. Reuse the latest direct conversation, or create a normal deletable
// conv-* conversation when none exists.
export async function openAgentConversation(projectId: string, agent: Pick<Agent, "id" | "name">): Promise<ChatRow> {
  const existing = latestDirectConversationForAgent(await chat.listConversations(projectId), agent.id);
  return existing || chat.createConversation(projectId, [agent.id], agent.name, agent.id);
}
