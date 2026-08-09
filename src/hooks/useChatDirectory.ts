import { useCallback, useEffect, useState } from "react";
import { chat, instances, platformHelper, type Agent, type ChatRow, type UnreadSummaryRow } from "../api";
import { conversationsWithoutHelper } from "../components/chat/helperConversationModel";

const REFRESH_MS = 8000;

// The conversation directory is scoped only by project. Keeping it separate
// from the selected URL means switching conversations never clears and
// refetches the sidebar before the next thread can render.
export function useChatDirectory(projectId: string) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<ChatRow[]>([]);
  const [summary, setSummary] = useState<UnreadSummaryRow[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAgents([]);
    setConversations([]);
    setSummary([]);
    setLoadedProjectId(null);
    if (!projectId) return () => { cancelled = true; };

    const load = () => Promise.all([
      instances.list(projectId).catch(() => [] as Agent[]),
      // The API only returns explicit conv-* conversations. Internal
      // default-* inbox/status records never become dashboard chats.
      chat.listConversations(projectId).catch(() => [] as ChatRow[]),
      chat.unreadSummary().catch(() => [] as UnreadSummaryRow[]),
      platformHelper.get(),
    ]).then(([nextAgents, allConversations, nextSummary, helper]) => {
      if (cancelled) return;
      // Platform Helper owns the floating meta-assistant surface. Keep its
      // private threads out of the regular agent conversation manager.
      const visibleAgents = nextAgents.filter((agent) => agent.id !== helper.id && agent.kind !== "platform_helper");
      const visibleConversations = conversationsWithoutHelper(allConversations, helper.id);
      setAgents(visibleAgents);
      setConversations(visibleConversations);
      setSummary(nextSummary.filter((row) => visibleConversations.some((conversation) => conversation.id === row.chat_id)));
      setLoadedProjectId(projectId);
    }).catch(() => {
      // Fail closed: do not briefly expose helper threads if helper identity
      // cannot be resolved. The next polling pass retries the complete load.
    });

    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId]);

  const addConversation = useCallback((conversation: ChatRow) => {
    setConversations((current) => [conversation, ...current.filter((row) => row.id !== conversation.id)]);
  }, []);
  const updateConversation = useCallback((conversation: ChatRow) => {
    setConversations((current) => current.map((row) => row.id === conversation.id ? conversation : row));
  }, []);
  const removeConversation = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((row) => row.id !== conversationId));
  }, []);

  return {
    agents,
    conversations,
    summary,
    loadedProjectId,
    addConversation,
    updateConversation,
    removeConversation,
  };
}
