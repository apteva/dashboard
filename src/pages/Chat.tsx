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
import { instances, chat, type Instance, type UnreadSummaryRow } from "../api";
import { useProjects } from "../hooks/useProjects";
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

  const [list, setList] = useState<Instance[]>([]);
  const [summary, setSummary] = useState<UnreadSummaryRow[]>([]);
  const [showRightPane, setShowRightPane] = useState(true);
  const [showSwitcher, setShowSwitcher] = useState(false);

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
        instances.list(projectId).catch(() => [] as Instance[]),
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
      <div className="border-b border-border px-6 py-3 flex items-center justify-between">
        <h1 className="text-text text-lg font-bold">Chat</h1>
        <button
          onClick={() => setShowSwitcher(true)}
          className="text-xs text-text-muted hover:text-text border border-border rounded px-2 py-1 font-mono"
          title="Switch chat (⌘K)"
        >
          ⌘K
        </button>
      </div>

      <div className="flex-1 grid grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_280px] divide-x divide-border overflow-hidden">
        <ChatSidebar
          instances={list}
          summary={projectSummary}
          unreadByInstance={unreadByInstance}
          focusedChatId={focusedChatId}
          onSelect={selectChat}
        />

        <ChatMain
          chatId={focusedChatId}
          instance={focusedInstance}
          onToggleRightPane={() => setShowRightPane((v) => !v)}
          rightPaneOpen={showRightPane}
        />

        {showRightPane && (
          <div className="hidden lg:block overflow-y-auto">
            {focusedInstance ? (
              <AgentContextCard instance={focusedInstance} />
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
