// NotificationsTray — generic notifications bell + dropdown.
//
// Lives in the top-right of the main content area. Renders an
// unread-count badge and a dropdown list of the latest notifications
// across all sources. Source-specific producers and routes live outside
// this generic shell.

import { useEffect, useRef, useState } from "react";
import { useNotifications, type Notification } from "../state/notifications";
import { setUnreadTitleCount } from "../state/documentTitle";

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
  return n.source.replace(/[-_]+/g, " ");
}

export function NotificationsTray() {
  const { items, unreadCount, markRead, remove } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Reflect unread count into the browser tab title so it composes with
  // the current route title.
  useEffect(() => {
    setUnreadTitleCount(unreadCount);
    return () => setUnreadTitleCount(0);
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

  function acknowledge(n: Notification): void {
    markRead(n.id);
    setOpen(false);
  }

  function dismissNotification(n: Notification): void {
    remove(n.id);
  }

  function dismissAll(): void {
    for (const n of items) {
      dismissNotification(n);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
        title={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
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
        <div className="absolute right-0 mt-2 w-[min(360px,calc(100vw-1rem))] max-h-[480px] overflow-hidden rounded-lg border border-border bg-bg-card shadow-xl z-50 flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-text font-medium text-sm">Notifications</span>
            {items.length > 0 && (
              <button
                onClick={dismissAll}
                className="text-text-muted hover:text-text text-xs"
              >
                dismiss all
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
                  onClick={() => acknowledge(n)}
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
                        dismissNotification(n);
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
