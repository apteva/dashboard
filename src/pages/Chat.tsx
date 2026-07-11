// /chat — full-page Slack-shaped agent chat surface.
//
// Three columns:
//
//   ┌──────────┬────────────────────────────────┬──────────────┐
//   │ Sidebar  │ Main pane                       │ Right pane  │
//   │ (240px)  │ (flex)                          │ (280px,     │
//   │          │                                 │  optional)  │
//   └──────────┴────────────────────────────────┴──────────────┘
//
// The sidebar lists every agent in the project that has channelchat
// installed. Selecting an agent loads its default chat into the
// centre pane (existing <ChatPanel> reused) and shows agent context
// in the right pane. URL → /chat/:chatId so direct links work.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { instances, chat, type Agent, type UnreadSummaryRow } from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { ChatMain } from "../components/chat/ChatMain";
import { AgentContextCard } from "../components/chat/AgentContextCard";
import { ChatSwitcher } from "../components/chat/ChatSwitcher";
import { notifications } from "../state/notifications";
import { useMediaQuery } from "../hooks/useMediaQuery";

const REFRESH_MS = 8000;

export function Chat() {
  const { t } = useTranslation();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const navigate = useNavigate();
  const { chatId: chatIdFromUrl } = useParams<{ chatId?: string }>();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const hasContextColumn = useMediaQuery("(min-width: 1024px)");

  const [list, setList] = useState<Agent[]>([]);
  const [summary, setSummary] = useState<UnreadSummaryRow[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [showRightPane, setShowRightPane] = useState(true);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const projectList = useMemo(
    () => loadedProjectId === projectId ? list : [],
    [list, loadedProjectId, projectId],
  );
  const projectChatSummary = loadedProjectId === projectId ? summary : [];

  // Notifications drive unread badges.
  const allNotifs = useSyncExternalStore(
    notifications.subscribe,
    notifications.getSnapshot,
    notifications.getSnapshot,
  );
  const unreadByInstance = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of allNotifs) {
      const match = n.id.match(/^chat:default-(\d+)$/);
      if (!match || !match[1]) continue;
      const id = parseInt(match[1], 10);
      if (!Number.isFinite(id)) continue;
      m.set(id, (m.get(id) || 0) + Math.max(1, n.count || 0));
    }
    return m;
  }, [allNotifs]);

  // Periodic load of the instance list + chat summary. The summary
  // gives us last-message-at + last-message-preview without N+1 calls,
  // which the sidebar uses for sort + previews. Polled rather than
  // SSE'd because the existing wildcard SSE already keeps notifications
  // current; this is just for the metadata that doesn't change often.
  useEffect(() => {
    let cancelled = false;
    setList([]);
    setSummary([]);
    setLoadedProjectId(null);
    if (!projectId) return () => { cancelled = true; };
    const load = () => {
      Promise.all([
        instances.list(projectId).catch(() => [] as Agent[]),
        chat.unreadSummary().catch(() => [] as UnreadSummaryRow[]),
      ]).then(([l, s]) => {
        if (cancelled) return;
        setList(l);
        setSummary(s);
        setLoadedProjectId(projectId);
      });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Resolve focused chat from URL or from a sensible default. The
  // priority mirrors ProjectChat: explicit URL → first with unread →
  // first running → first.
  const focusedChatId = useMemo(() => {
    if (chatIdFromUrl) return chatIdFromUrl;
    if (projectList.length === 0) return null;
    const withUnread = projectList.find((i) => (unreadByInstance.get(i.id) || 0) > 0);
    if (withUnread) return `default-${withUnread.id}`;
    const running = projectList.find((i) => i.status === "running");
    if (running) return `default-${running.id}`;
    return projectList[0] ? `default-${projectList[0].id}` : null;
    // Intentionally only react to URL + list — switching default on
    // every unread arrival would steal focus from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatIdFromUrl, projectList]);

  // Scope summary rows to the current project's instances. The
  // unreadSummary endpoint returns every chat the user owns across
  // projects, so we filter client-side.
  const projectInstanceIds = useMemo(() => new Set(projectList.map((i) => i.id)), [projectList]);
  const projectSummary = useMemo(
    () => projectChatSummary.filter((s) => projectInstanceIds.has(s.instance_id)),
    [projectChatSummary, projectInstanceIds],
  );

  // Resolve focused instance from focused chat id.
  const focusedInstanceId = useMemo(() => {
    if (!focusedChatId) return null;
    const m = focusedChatId.match(/^default-(\d+)$/);
    if (!m || !m[1]) return null;
    const id = parseInt(m[1], 10);
    return Number.isFinite(id) ? id : null;
  }, [focusedChatId]);

  const focusedInstance = useMemo(
    () => projectList.find((i) => i.id === focusedInstanceId) || null,
    [projectList, focusedInstanceId],
  );

  usePageTitle(focusedInstance ? [t("chat.title"), focusedInstance.name] : t("chat.title"));

  // Cmd-K / Ctrl-K opens the switch palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowSwitcher((v) => !v);
      }
      if (e.key === "Escape" && showSwitcher) {
        setShowSwitcher(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSwitcher]);

  const selectChat = (chatId: string) => {
    navigate(`/chat/${chatId}`);
    setShowSwitcher(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={`${chatIdFromUrl ? "hidden md:flex" : "flex"} min-h-14 border-b border-border px-4 sm:px-6 py-2 items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-text">{t("chat.title")}</h1>
          <div className="text-[11px] text-text-muted md:hidden">Choose a conversation</div>
        </div>
        <button
          onClick={() => setShowSwitcher(true)}
          className="touch-target shrink-0 rounded border border-border px-3 text-xs text-text-muted hover:bg-bg-hover hover:text-text"
          title={t("chat.switchChatTitle")}
        >
          <span className="md:hidden">Search</span>
          <span className="hidden font-mono md:inline">⌘K</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 relative md:grid md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_280px] md:divide-x md:divide-border overflow-hidden">
        {(!chatIdFromUrl || isDesktop) && <div className="h-full bg-bg md:w-auto">
          <ChatSidebar
            instances={projectList}
            summary={projectSummary}
            unreadByInstance={unreadByInstance}
            focusedChatId={focusedChatId}
            onSelect={selectChat}
          />
        </div>}

        {(chatIdFromUrl || isDesktop) && <div className="h-full min-h-0">
          <ChatMain
            chatId={focusedChatId}
            instance={focusedInstance}
            onBack={() => navigate("/chat")}
            onToggleRightPane={() => setShowRightPane((v) => !v)}
            rightPaneOpen={showRightPane}
          />
        </div>}

        {showRightPane && hasContextColumn && (
          <div className="overflow-y-auto">
            {focusedInstance ? (
              <AgentContextCard instance={focusedInstance} chatId={focusedChatId} />
            ) : (
              <div className="p-4 text-text-dim text-sm">
                {t("chat.selectAgentForContext")}
              </div>
            )}
          </div>
        )}
      </div>

      {showSwitcher && (
        <ChatSwitcher
          instances={projectList}
          summary={projectSummary}
          unreadByInstance={unreadByInstance}
          onSelect={selectChat}
          onClose={() => setShowSwitcher(false)}
        />
      )}
    </div>
  );
}
