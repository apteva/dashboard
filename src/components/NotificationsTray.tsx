// NotificationsTray — generic notifications bell + dropdown.
//
// Lives in the top-right of the main content area. Renders an
// unread-count badge, a dropdown list of the latest notifications
// across all sources, and a small settings menu for desktop alerts.
//
// v1 has only chat as a source, but the component knows nothing about
// chat specifically — it routes by `Notification.ref.kind`.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications, type Notification } from "../state/notifications";
import { markChatSeen, markAllChatsSeen, setDesktopNotificationsEnabled, desktopNotificationsEnabled } from "../state/chatNotifications";

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function sourceLabel(n: Notification): string {
  if (n.source === "chat") return "Chat";
  return n.source;
}

export function NotificationsTray() {
  const { items, unreadCount, remove } = useNotifications();
  const [open, setOpen] = useState(false);
  const [desktopOn, setDesktopOn] = useState(desktopNotificationsEnabled());
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Reflect unread count into the browser tab title so it shows up in
  // pinned tabs / window switchers / cmd-tab. Standard "(N) Apteva"
  // pattern (Slack/Gmail/Discord); the original title is captured once
  // on first mount and restored when the count drops back to 0.
  useEffect(() => {
    const original = document.title.replace(/^\(\d+\)\s+/, "");
    document.title = unreadCount > 0
      ? `(${unreadCount > 99 ? "99+" : unreadCount}) ${original}`
      : original;
  }, [unreadCount]);

  // Click-outside to close the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Desktop-notification jump: clicking a system toast dispatches an
  // event the tray honors here so routing stays in one place.
  useEffect(() => {
    const onJump = (ev: Event) => {
      const n = (ev as CustomEvent<Notification>).detail;
      if (n) routeTo(n);
    };
    window.addEventListener("apteva.openNotification", onJump);
    return () => window.removeEventListener("apteva.openNotification", onJump);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function routeTo(n: Notification): void {
    if (n.ref?.kind === "instance-chat") {
      navigate(`/instances/${n.ref.instanceId}`);
      const chatId = n.id.startsWith("chat:") ? n.id.slice(5) : "";
      if (chatId && n.latestId) markChatSeen(chatId, n.latestId);
    }
    setOpen(false);
  }

  async function toggleDesktop() {
    const next = !desktopOn;
    const ok = await setDesktopNotificationsEnabled(next);
    setDesktopOn(ok);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
        title={unreadCount ? `${unreadCount} unread` : "Notifications"}
        aria-label="Notifications"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-h-[480px] overflow-hidden rounded-lg border border-border bg-bg-card shadow-xl z-50 flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-text font-medium text-sm">Notifications</span>
            {items.length > 0 && (
              <button
                onClick={() => markAllChatsSeen()}
                className="text-text-muted hover:text-text text-xs"
              >
                mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-text-dim text-xs text-center">
                Nothing new.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => routeTo(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border/40 hover:bg-bg-hover transition-colors ${
                    n.unread ? "" : "opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {n.unread && (
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-text text-sm font-medium truncate">{n.title}</span>
                        <span className="text-text-dim text-[10px] uppercase">{sourceLabel(n)}</span>
                        {n.count > 1 && (
                          <span className="text-text-muted text-[10px]">×{n.count}</span>
                        )}
                      </div>
                      <p className="text-text-muted text-xs mt-0.5 line-clamp-2">{n.preview}</p>
                      <span className="text-text-dim text-[10px]">{formatRelative(n.ts)}</span>
                    </div>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(n.id);
                        if (n.id.startsWith("chat:") && n.latestId) {
                          markChatSeen(n.id.slice(5), n.latestId);
                        }
                      }}
                      className="text-text-dim hover:text-text text-xs px-1"
                      title="Dismiss"
                    >
                      ×
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t border-border bg-bg-input/40">
            <label className="flex items-center gap-2 text-text-muted text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={desktopOn}
                onChange={() => void toggleDesktop()}
                className="accent-accent"
              />
              Desktop notifications when tab is in background
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
