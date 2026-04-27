// Project-wide chat aggregator. Sidebar lists every instance in the
// project that has the channel-chat app available; the main pane
// embeds the existing ChatPanel for whichever instance is focused.
//
// Two design decisions:
//
//   1. We open a chat connection only for the focused instance, not
//      all of them. The chatNotifications driver (started by Layout)
//      already powers the wildcard SSE for unread badges across every
//      chat the user owns, so the sidebar doesn't need its own per-
//      chat connection just to show "X unread". This keeps the open
//      EventSource count to one regardless of fleet size.
//
//   2. The focused instance id is persisted in localStorage so the
//      user's last context survives navigation. The first time, we
//      pick the first instance with unread > 0, falling back to the
//      first running instance, falling back to the first instance.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { instances, type Instance } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { ChatPanel } from "../ChatPanel";
import type { SubscribeFn } from "../InstanceView";
import { notifications } from "../../state/notifications";

const FOCUSED_KEY = "apteva.dashboard.projectChat.focused";
const REFRESH_MS = 8000;

// ChatPanel needs a SubscribeFn for its status dot. From the project-
// dashboard context we don't have a live telemetry feed for the focused
// instance handy — the dot will stay in its default ("unknown") state,
// which is the right answer because we're showing the chat as a
// secondary surface, not the primary lifecycle view.
const noopSubscribe: SubscribeFn = () => () => {};

export function ProjectChat() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [list, setList] = useState<Instance[]>([]);
  const [focused, setFocused] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(FOCUSED_KEY);
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });

  // Subscribe to the notifications store so unread counts re-render
  // sidebar entries live (without polling the server). useSyncExternalStore
  // is the canonical pattern for non-React stores.
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

  // Refresh the instances list periodically. Includes stopped agents —
  // chat history persists across stop/start so a user can read past
  // conversations even when the agent is offline.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      instances.list(projectId).then((l) => {
        if (cancelled) return;
        setList(l);
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Pick a sensible default focus the first time the panel renders
  // with a non-empty list. Priority: previously-focused (still valid)
  // → first with unread → first running → first.
  useEffect(() => {
    if (list.length === 0) return;
    setFocused((prev) => {
      if (prev !== null && list.some((i) => i.id === prev)) return prev;
      const withUnread = list.find((i) => (unreadByInstance.get(i.id) || 0) > 0);
      if (withUnread) return withUnread.id;
      const running = list.find((i) => i.status === "running");
      if (running) return running.id;
      return list[0]?.id ?? null;
    });
    // Intentionally exclude unreadByInstance — we only want to pick
    // the initial focus, not switch every time an unread arrives. If
    // the user wants to jump to a busy chat, the badge in the sidebar
    // is the affordance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // Persist focus across reloads.
  useEffect(() => {
    if (focused === null) return;
    try { localStorage.setItem(FOCUSED_KEY, String(focused)); } catch {}
  }, [focused]);

  if (list.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 flex items-center justify-center min-h-[280px]">
        <div className="text-text-dim text-sm">No agents — no chats to aggregate</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg flex flex-col min-h-[420px] max-h-[60vh] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-xs text-text-dim uppercase tracking-wide">
          Project chat
        </div>
        <div className="text-xs text-text-muted">{list.length} agents</div>
      </div>

      <div className="flex-1 grid grid-cols-[180px_minmax(0,1fr)] divide-x divide-border overflow-hidden">
        {/* Sidebar — instance list */}
        <div className="overflow-y-auto">
          <ul>
            {list.map((inst) => {
              const unread = unreadByInstance.get(inst.id) || 0;
              const active = focused === inst.id;
              const running = inst.status === "running";
              return (
                <li key={inst.id}>
                  <button
                    onClick={() => setFocused(inst.id)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                      active ? "bg-bg-hover" : "hover:bg-bg-hover"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        running ? "bg-green" : "bg-text-dim"
                      }`}
                    />
                    <span
                      className={`flex-1 truncate text-sm ${
                        active ? "text-text" : "text-text-muted"
                      }`}
                    >
                      {inst.name}
                    </span>
                    {unread > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-bold flex items-center justify-center">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Main pane — focused chat */}
        <div className="flex flex-col min-h-0">
          {focused !== null ? (
            <ChatPanel
              key={focused /* force ChatPanel state to reset on switch */}
              instanceId={focused}
              subscribe={noopSubscribe}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
              Select an agent to view its chat
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
