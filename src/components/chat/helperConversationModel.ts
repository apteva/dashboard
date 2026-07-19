import type { ChatRow } from "../../api";

const HELPER_CONVERSATION_STORAGE_PREFIX = "context-agent-chat:helper-conversation:";

export function helperConversationStorageKey(projectId: string): string {
  return `${HELPER_CONVERSATION_STORAGE_PREFIX}${projectId}`;
}

export function helperDirectConversations(conversations: ChatRow[], helperAgentId: number): ChatRow[] {
  return conversations
    .filter((conversation) =>
      conversation.kind === "direct"
      && conversation.agent_ids.length === 1
      && conversation.agent_ids[0] === helperAgentId,
    )
    .slice()
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export function conversationsWithoutHelper(conversations: ChatRow[], helperAgentId: number): ChatRow[] {
  return conversations.filter((conversation) =>
    conversation.instance_id !== helperAgentId
    && !conversation.agent_ids.includes(helperAgentId),
  );
}

export function selectHelperConversation(
  conversations: ChatRow[],
  helperAgentId: number,
  storedConversationId: string | null,
): ChatRow | null {
  const helperConversations = helperDirectConversations(conversations, helperAgentId);
  if (storedConversationId) {
    const stored = helperConversations.find((conversation) => conversation.id === storedConversationId);
    if (stored) return stored;
  }
  return helperConversations[0] || null;
}
