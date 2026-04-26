// Generic notifications store. v1 only has chat as a source, but the
// shape supports any future kind (build failures, telemetry alerts,
// app install errors, ...). The store holds at most one entry per
// (source, key) pair — bursts collapse into a count + latest preview.
//
// Pure observer pattern, no external state library, accessed in React
// via the useNotifications() hook below.

import { useEffect, useSyncExternalStore } from "react";

export interface Notification {
  /** Stable identity. Format: "<source>:<key>" — e.g. "chat:default-7". */
  id: string;
  source: string;
  title: string;
  preview: string;
  ts: string; // ISO
  /** Number of underlying events collapsed into this entry. */
  count: number;
  /** True when the user hasn't acknowledged this notification yet. */
  unread: boolean;
  /** Optional click target. Layout-agnostic — consumers route on it. */
  ref?: { kind: "instance-chat"; instanceId: number };
}

type Listener = () => void;

class Store {
  private items: Map<string, Notification> = new Map();
  private listeners: Set<Listener> = new Set();
  private snapshotCache: Notification[] = [];
  private snapshotDirty = true;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Snapshot of items, newest first. Stable reference across calls
   * unless the store changed — required for useSyncExternalStore. */
  getSnapshot = (): Notification[] => {
    if (this.snapshotDirty) {
      this.snapshotCache = Array.from(this.items.values()).sort(
        (a, b) => Date.parse(b.ts) - Date.parse(a.ts),
      );
      this.snapshotDirty = false;
    }
    return this.snapshotCache;
  };

  /** Upsert. Merges count + advances ts/preview if the incoming entry
   * is newer than the existing one. */
  upsert(n: Notification): void {
    const existing = this.items.get(n.id);
    if (existing && Date.parse(existing.ts) >= Date.parse(n.ts)) {
      // Stale event (out-of-order delivery); keep what we have but
      // bump count if the new entry represents new underlying events.
      if (n.count > existing.count) {
        this.items.set(n.id, { ...existing, count: n.count, unread: n.unread || existing.unread });
        this.dirty();
      }
      return;
    }
    this.items.set(n.id, n);
    this.dirty();
  }

  /** Drop a notification entirely (e.g., user opened that chat). */
  remove(id: string): void {
    if (this.items.delete(id)) this.dirty();
  }

  /** Mark a single notification read but keep it in the list. */
  markRead(id: string): void {
    const n = this.items.get(id);
    if (n && n.unread) {
      this.items.set(id, { ...n, unread: false });
      this.dirty();
    }
  }

  /** Mark all entries read; doesn't remove them. */
  markAllRead(): void {
    let changed = false;
    for (const [id, n] of this.items) {
      if (n.unread) {
        this.items.set(id, { ...n, unread: false });
        changed = true;
      }
    }
    if (changed) this.dirty();
  }

  /** Clear everything (e.g., logout). */
  reset(): void {
    if (this.items.size === 0) return;
    this.items.clear();
    this.dirty();
  }

  private dirty(): void {
    this.snapshotDirty = true;
    for (const fn of this.listeners) fn();
  }
}

export const notifications = new Store();

/** Subscribe a React component to the store. Re-renders on any change. */
export function useNotifications(): {
  items: Notification[];
  unreadCount: number;
  totalCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
} {
  const items = useSyncExternalStore(notifications.subscribe, notifications.getSnapshot, notifications.getSnapshot);
  const unreadCount = items.reduce((n, it) => n + (it.unread ? 1 : 0), 0);
  return {
    items,
    unreadCount,
    totalCount: items.length,
    markRead: notifications.markRead.bind(notifications),
    markAllRead: notifications.markAllRead.bind(notifications),
    remove: notifications.remove.bind(notifications),
  };
}

/** Convenience hook: ensure a side-effect runs once at mount and is
 * cleaned up on unmount. Used by Layout to start the chat driver. */
export function useNotificationsStartup(start: () => () => void): void {
  useEffect(() => start(), [start]);
}
