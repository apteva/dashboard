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
import { instances, chat, type Agent, type UnreadSummaryRow } from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { ChatMain } from "../components/chat/ChatMain";
import { AgentContextCard } from "../components/chat/AgentContextCard";
import { ChatSwitcher } from "../components/chat/ChatSwitcher";
import { notifications } from "../state/notifications";

const REFRESH_MS = 8000;

export function Chat() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const navigate = useNavigate();
  const { chatId: chatIdFromUrl } = useParams<{ chatId?: string }>();

  const [list, setList] = useState<Agent[]>([]);
  const [summary, setSummary] = useState<UnreadSummaryRow[]>([]);
  const [showRightPane, setShowRightPane] = useState(true);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showMobileList, setShowMobileList] = useState(false);

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
    const load = () => {
      Promise.all([
        instances.list(projectId).catch(() => [] as Agent[]),
        chat.unreadSummary().catch(() => [] as UnreadSummaryRow[]),
      ]).then(([l, s]) => {
        if (cancelled) return;
        setList(l);
        setSummary(s);
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
    if (list.length === 0) return null;
    const withUnread = list.find((i) => (unreadByInstance.get(i.id) || 0) > 0);
    if (withUnread) return `default-${withUnread.id}`;
    const running = list.find((i) => i.status === "running");
    if (running) return `default-${running.id}`;
    return list[0] ? `default-${list[0].id}` : null;
    // Intentionally only react to URL + list — switching default on
    // every unread arrival would steal focus from the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatIdFromUrl, list]);

  // Scope summary rows to the current project's instances. The
  // unreadSummary endpoint returns every chat the user owns across
  // projects, so we filter client-side.
  const projectInstanceIds = useMemo(() => new Set(list.map((i) => i.id)), [list]);
  const projectSummary = useMemo(
    () => summary.filter((s) => projectInstanceIds.has(s.instance_id)),
    [summary, projectInstanceIds],
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
    () => list.find((i) => i.id === focusedInstanceId) || null,
    [list, focusedInstanceId],
  );

  usePageTitle(focusedInstance ? ["Chat", focusedInstance.name] : "Chat");

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
    setShowMobileList(false);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => setShowMobileList(true)}
            className="md:hidden text-xs text-text-muted hover:text-text border border-border rounded px-2 py-1"
            title="Show agents"
          >
            agents
          </button>
          <h1 className="text-text text-lg font-bold truncate">Chat</h1>
        </div>
        <button
          onClick={() => setShowSwitcher(true)}
          className="shrink-0 text-xs text-text-muted hover:text-text border border-border rounded px-2 py-1 font-mono"
          title="Switch chat (⌘K)"
        >
          ⌘K
        </button>
      </div>

      <div className="flex-1 min-h-0 relative md:grid md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_280px] md:divide-x md:divide-border overflow-hidden">
        {showMobileList && (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/40 md:hidden"
            onClick={() => setShowMobileList(false)}
            aria-label="Close agents"
          />
        )}
        <div
          className={`absolute inset-y-0 left-0 z-30 w-[min(20rem,86vw)] bg-bg border-r border-border shadow-xl md:static md:block md:w-auto md:shadow-none ${
            showMobileList ? "block" : "hidden"
          }`}
        >
          <ChatSidebar
            instances={list}
            summary={projectSummary}
            unreadByInstance={unreadByInstance}
            focusedChatId={focusedChatId}
            onSelect={selectChat}
          />
        </div>

        <ChatMain
          chatId={focusedChatId}
          instance={focusedInstance}
          onToggleRightPane={() => setShowRightPane((v) => !v)}
          rightPaneOpen={showRightPane}
        />

        {showRightPane && (
          <div className="hidden lg:block overflow-y-auto">
            {focusedInstance ? (
              <AgentContextCard instance={focusedInstance} chatId={focusedChatId} />
            ) : (
              <div className="p-4 text-text-dim text-sm">
                Select an agent to see context
              </div>
            )}
          </div>
        )}
      </div>

      {showSwitcher && (
        <ChatSwitcher
          instances={list}
          summary={projectSummary}
          unreadByInstance={unreadByInstance}
          onSelect={selectChat}
          onClose={() => setShowSwitcher(false)}
        />
      )}
    </div>
  );
}
