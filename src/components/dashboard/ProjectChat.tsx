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
import { useNavigate } from "react-router-dom";
import { chat, instances, type Agent, type UnreadSummaryRow } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { ChatPanel } from "../ChatPanel";
import type { SubscribeFn } from "../AgentView";
import { notifications } from "../../state/notifications";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useRealtimeAvailability } from "../../hooks/useRealtimeAvailability";

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
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const projectId = currentProject?.id;

  const [list, setList] = useState<Agent[]>([]);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [summary, setSummary] = useState<UnreadSummaryRow[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  // Render-time gating closes the window before the project-change effect
  // clears state, so an old ChatPanel is never actionable under a new label.
  const projectList = useMemo(
    () => loadedProjectId === projectId ? list : [],
    [list, loadedProjectId, projectId],
  );

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
    // Project selection changes synchronously, so clear the actionable old
    // chat synchronously too. Keeping it mounted until a network response
    // arrives lets an operator send to project A while the selector says B.
    setList([]);
    setSummary([]);
    setLoadedProjectId(null);
    setFocused(readFocusedAgent(projectId));
    if (!projectId) return () => { cancelled = true; };
    const load = () => {
      Promise.all([
        instances.list(projectId),
        chat.unreadSummary().catch(() => [] as UnreadSummaryRow[]),
      ]).then(([l, s]) => {
        if (cancelled) return;
        setList(l);
        setSummary(s);
        setLoadedProjectId(projectId);
      }).catch(() => {
        if (!cancelled) {
          setList([]);
          setSummary([]);
          setLoadedProjectId(projectId);
        }
      });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Pick a sensible default focus the first time the panel renders
  // with a non-empty list. Priority: previously-focused (still valid)
  // → first with unread → first running → first.
  useEffect(() => {
    if (projectList.length === 0) return;
    setFocused((prev) => {
      if (prev !== null && projectList.some((i) => i.id === prev)) return prev;
      const withUnread = projectList.find((i) => (unreadByInstance.get(i.id) || 0) > 0);
      if (withUnread) return withUnread.id;
      const running = projectList.find((i) => i.status === "running");
      if (running) return running.id;
      return projectList[0]?.id ?? null;
    });
    // Intentionally exclude unreadByInstance — we only want to pick
    // the initial focus, not switch every time an unread arrives. If
    // the user wants to jump to a busy chat, the badge in the sidebar
    // is the affordance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectList]);

  // Persist focus across reloads.
  useEffect(() => {
    if (!projectId || focused === null) return;
    try { localStorage.setItem(`${FOCUSED_KEY}:${projectId}`, String(focused)); } catch {}
  }, [focused, projectId]);

  const focusedAgent = focused !== null
    ? projectList.find((inst) => inst.id === focused) || null
    : null;
  const realtime = useRealtimeAvailability(focusedAgent?.id, focusedAgent?.status === "running");
  const projectIds = useMemo(() => new Set(projectList.map((agent) => agent.id)), [projectList]);
  const summaryByAgent = useMemo(() => {
    const map = new Map<number, UnreadSummaryRow>();
    for (const row of summary) {
      if (projectIds.has(row.instance_id)) map.set(row.instance_id, row);
    }
    return map;
  }, [projectIds, summary]);
  const recentAgents = useMemo(() => [...projectList].sort((a, b) => {
    const unreadDelta = (unreadByInstance.get(b.id) || 0) - (unreadByInstance.get(a.id) || 0);
    if (unreadDelta !== 0) return unreadDelta;
    const aTime = summaryByAgent.get(a.id)?.latest_at ? Date.parse(summaryByAgent.get(a.id)!.latest_at!) : 0;
    const bTime = summaryByAgent.get(b.id)?.latest_at ? Date.parse(summaryByAgent.get(b.id)!.latest_at!) : 0;
    if (aTime !== bTime) return bTime - aTime;
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return a.name.localeCompare(b.name);
  }), [projectList, summaryByAgent, unreadByInstance]);

  if (projectList.length === 0) {
    return (
      <div className="border border-border rounded-lg p-6 flex items-center justify-center min-h-[280px]">
        <div className="text-text-dim text-sm">No agents — no chats to aggregate</div>
      </div>
    );
  }

  return (
    <>
    {!isDesktop && <section className="overflow-hidden rounded-lg border border-border bg-bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-text">Recent conversations</h2>
          <p className="mt-0.5 text-[11px] text-text-dim">Messages from your agents</p>
        </div>
        <button type="button" onClick={() => navigate("/chat")} className="touch-target rounded-lg border border-border px-3 text-xs font-semibold text-accent hover:bg-bg-hover">
          View all
        </button>
      </div>
      <div className="divide-y divide-border">
        {recentAgents.slice(0, 4).map((agent) => {
          const unread = unreadByInstance.get(agent.id) || 0;
          const row = summaryByAgent.get(agent.id);
          return (
            <button key={agent.id} type="button" onClick={() => navigate(`/chat/default-${agent.id}`)} className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover">
              <span className={`h-2 w-2 shrink-0 rounded-full ${agent.status === "running" ? "bg-green" : "bg-text-dim"}`} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate text-[15px] font-medium text-text">{agent.name}</span>
                  {row?.latest_at && <span className="shrink-0 text-[10px] text-text-dim">{formatRelative(row.latest_at)}</span>}
                </span>
                <span className="mt-1 block truncate text-xs text-text-muted">{row?.latest_preview || "No messages yet"}</span>
              </span>
              {unread > 0 ? (
                <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-bg">{unread > 99 ? "99+" : unread}</span>
              ) : (
                <span className="shrink-0 text-lg text-text-dim">›</span>
              )}
            </button>
          );
        })}
      </div>
    </section>}

    {isDesktop && <div className="border border-border rounded-lg flex flex-col min-h-[420px] max-h-[60vh] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border">
        <div className="min-w-0">
          <div className="text-xs text-text-dim uppercase tracking-wide">
            Project chat
          </div>
        </div>
        <div className="text-xs text-text-muted">{projectList.length} agents</div>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[180px_minmax(0,1fr)] divide-x divide-border overflow-hidden">
        {/* Sidebar — instance list */}
        <div className="overflow-y-auto">
          <ul>
            {projectList.map((inst) => {
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
        <div className="flex flex-1 flex-col min-h-0">
          {focused !== null ? (
            <ChatPanel
              key={focused /* force ChatPanel state to reset on switch */}
              instanceId={focused}
              agentName={focusedAgent?.name || "Agent"}
              realtime={realtime}
              subscribe={noopSubscribe}
              historyLimit={100}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
              Select an agent to view its chat
            </div>
          )}
        </div>
      </div>
    </div>}
    </>
  );
}

function readFocusedAgent(projectId?: string): number | null {
  if (!projectId) return null;
  try {
    const value = localStorage.getItem(`${FOCUSED_KEY}:${projectId}`);
    const id = value ? parseInt(value, 10) : NaN;
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function formatRelative(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
