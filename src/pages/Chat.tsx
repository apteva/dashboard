import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { chat, instances, platformHelper, type Agent, type ChatRow, type UnreadSummaryRow } from "../api";
import { AgentContextCard } from "../components/chat/AgentContextCard";
import { ChatMain } from "../components/chat/ChatMain";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { ConversationDetails } from "../components/chat/ConversationDetails";
import { conversationsWithoutHelper } from "../components/chat/helperConversationModel";
import { NewConversationModal } from "../components/chat/NewConversationModal";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";
import { notifications } from "../state/notifications";

const REFRESH_MS = 8000;

export function Chat() {
  const { t } = useTranslation();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const navigate = useNavigate();
  const { chatId: chatIdFromUrl } = useParams<{ chatId?: string }>();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const hasContextColumn = useMediaQuery("(min-width: 1024px)");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<ChatRow[]>([]);
  const [summary, setSummary] = useState<UnreadSummaryRow[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [showRightPane, setShowRightPane] = useState(true);
  const [newConversationOpen, setNewConversationOpen] = useState(false);

  const allNotifications = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot, notifications.getSnapshot);
  const unreadByChat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const notification of allNotifications) {
      if (!notification.id.startsWith("chat:")) continue;
      const id = notification.id.slice(5);
      counts.set(id, (counts.get(id) || 0) + Math.max(1, notification.count || 0));
    }
    return counts;
  }, [allNotifications]);

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
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [chatIdFromUrl, projectId]);

  const projectReady = loadedProjectId === projectId;
  const projectAgents = projectReady ? agents : [];
  const projectConversations = projectReady ? conversations : [];
  const focusedChatId = useMemo(() => {
    if (chatIdFromUrl) {
      return projectConversations.some((conversation) => conversation.id === chatIdFromUrl)
        ? chatIdFromUrl
        : null;
    }
    const unread = projectConversations.find((conversation) => (unreadByChat.get(conversation.id) || 0) > 0);
    return unread?.id || projectConversations[0]?.id || null;
  }, [chatIdFromUrl, projectConversations, unreadByChat]);

  useEffect(() => {
    if (projectReady && chatIdFromUrl && !focusedChatId) navigate("/chat", { replace: true });
  }, [chatIdFromUrl, focusedChatId, navigate, projectReady]);
  const focusedConversation = useMemo(
    () => projectConversations.find((conversation) => conversation.id === focusedChatId) || null,
    [focusedChatId, projectConversations],
  );
  const focusedParticipants = useMemo(() => {
    if (!focusedConversation) return [];
    const ids = new Set(focusedConversation.agent_ids);
    return projectAgents.filter((agent) => ids.has(agent.id));
  }, [focusedConversation, projectAgents]);
  const focusedInstance = useMemo(
    () => projectAgents.find((agent) => agent.id === focusedConversation?.instance_id) || focusedParticipants[0] || null,
    [focusedConversation, focusedParticipants, projectAgents],
  );

  usePageTitle(focusedConversation ? [t("chat.title"), focusedConversation.title] : t("chat.title"));

  const selectConversation = (id: string) => navigate(`/chat/${id}`);
  const conversationCreated = (conversation: ChatRow) => {
    setConversations((current) => [conversation, ...current.filter((row) => row.id !== conversation.id)]);
    navigate(`/chat/${conversation.id}`);
  };
  const conversationChanged = (conversation: ChatRow) => {
    setConversations((current) => current.map((row) => row.id === conversation.id ? conversation : row));
  };
  const conversationRemoved = (conversationId: string) => {
    setConversations((current) => current.filter((row) => row.id !== conversationId));
    navigate("/chat");
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className={`${chatIdFromUrl ? "hidden md:flex" : "flex"} min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-2 sm:px-6`}>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-text">{t("chat.title")}</h1>
          <div className="text-[11px] text-text-muted md:hidden">{t("chat.chooseConversation")}</div>
        </div>
        <button
          type="button"
          onClick={() => setNewConversationOpen(true)}
          className="touch-target inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent px-4 py-2 text-sm font-bold text-bg transition-colors hover:bg-accent-hover"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          {t("chat.newConversation")}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden md:grid md:grid-cols-[260px_minmax(0,1fr)] md:divide-x md:divide-border lg:grid-cols-[260px_minmax(0,1fr)_280px]">
        {(!chatIdFromUrl || isDesktop) && (
          <div className="h-full bg-bg">
            <ChatSidebar
              instances={projectAgents}
              conversations={projectConversations}
              summary={summary}
              unreadByChat={unreadByChat}
              focusedChatId={focusedChatId}
              onSelect={selectConversation}
              onNew={() => setNewConversationOpen(true)}
            />
          </div>
        )}

        {(chatIdFromUrl || isDesktop) && (
          <div className="h-full min-h-0">
            <ChatMain
              chatId={focusedChatId}
              conversation={focusedConversation}
              participants={focusedParticipants}
              agents={projectAgents}
              instance={focusedInstance}
              onBack={() => navigate("/chat")}
              onToggleRightPane={() => setShowRightPane((value) => !value)}
              rightPaneOpen={showRightPane}
              onConversationChanged={conversationChanged}
              onConversationRemoved={conversationRemoved}
            />
          </div>
        )}

        {showRightPane && hasContextColumn && (
          <div className="overflow-y-auto">
            {focusedInstance && focusedConversation ? (
              <>
                <ConversationDetails key={focusedConversation.id} conversation={focusedConversation} agents={projectAgents} onChanged={conversationChanged} onRemoved={conversationRemoved} />
                <AgentContextCard instance={focusedInstance} chatId={focusedChatId} />
              </>
            ) : <div className="p-4 text-sm text-text-dim">{t("chat.main.noChatSelected")}</div>}
          </div>
        )}
      </div>

      <NewConversationModal open={newConversationOpen} projectId={projectId} agents={projectAgents} onClose={() => setNewConversationOpen(false)} onCreated={conversationCreated} />
    </div>
  );
}
