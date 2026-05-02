// useAppEvents — shared SDK-level event subscription for the dashboard.
//
// Every Apteva app emits onto a per-(app, project_id) bus via
// ctx.Emit(); this hook is the dashboard side of that pipe. Pass
// the app name + project id + a handler; the hook joins a SHARED
// EventSource for that (app, project_id) pair so 30 chat components
// + 1 panel all subscribed to "storage" share one network connection.
//
// Why shared: components attached to chat messages can pile up
// (long conversation = many components), and per-component
// EventSources would blow past per-domain connection limits and
// chew memory. Hoisting to one connection per (app, project_id)
// pair keeps cost bounded regardless of how many subscribers
// the dashboard has open at once.
//
// Dedup is on `seq`. The platform's ring buffer holds the last 256
// events per (app, project) for replay; longer gaps are the app's
// responsibility to backfill (it owns the durable list anyway).

import { useEffect, useRef } from "react";

export interface AppEventEnvelope<T = unknown> {
  topic: string;          // app-relative, e.g. "file.added"
  app: string;            // server-stamped from the install token
  project_id: string;
  install_id: number;
  seq: number;
  time: string;
  data: T;
}

export interface UseAppEventsOptions {
  /** When false, the hook does nothing — handy for conditionally
   *  attaching (e.g. only when a panel is mounted in a real project). */
  enabled?: boolean;
}

// ─── Multiplexer ─────────────────────────────────────────────────────

type Listener = (ev: AppEventEnvelope) => void;

interface Channel {
  es: EventSource | null;
  listeners: Set<Listener>;
  lastSeq: number;
  reconnectTimer: number | null;
  closing: boolean;
}

const channels = new Map<string, Channel>();

function channelKey(app: string, projectId: string): string {
  return `${app}::${projectId}`;
}

function ensureChannel(app: string, projectId: string): Channel {
  const key = channelKey(app, projectId);
  let ch = channels.get(key);
  if (ch) return ch;
  ch = {
    es: null,
    listeners: new Set(),
    lastSeq: 0,
    reconnectTimer: null,
    closing: false,
  };
  channels.set(key, ch);
  openConnection(app, projectId, ch);
  return ch;
}

function openConnection(app: string, projectId: string, ch: Channel): void {
  if (ch.closing) return;
  const url =
    `/api/app-events/${encodeURIComponent(app)}` +
    `?project_id=${encodeURIComponent(projectId)}` +
    (ch.lastSeq > 0 ? `&since=${ch.lastSeq}` : "");
  const es = new EventSource(url, { withCredentials: true });
  ch.es = es;
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as AppEventEnvelope;
      if (ev.seq <= ch.lastSeq) return; // dedup across reconnects
      ch.lastSeq = ev.seq;
      // Snapshot the listeners so a listener that removes itself
      // mid-iteration doesn't skip its sibling.
      for (const fn of [...ch.listeners]) {
        try {
          fn(ev);
        } catch {
          // a misbehaving listener shouldn't tank the others
        }
      }
    } catch {
      // ignore malformed frame
    }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED && !ch.closing) {
      if (ch.reconnectTimer) window.clearTimeout(ch.reconnectTimer);
      ch.reconnectTimer = window.setTimeout(() => {
        ch.reconnectTimer = null;
        openConnection(app, projectId, ch);
      }, 2000);
    }
  };
}

function maybeCloseChannel(app: string, projectId: string): void {
  const key = channelKey(app, projectId);
  const ch = channels.get(key);
  if (!ch) return;
  if (ch.listeners.size > 0) return;
  ch.closing = true;
  if (ch.reconnectTimer) window.clearTimeout(ch.reconnectTimer);
  if (ch.es) ch.es.close();
  channels.delete(key);
}

// ─── Public hook ─────────────────────────────────────────────────────

export function useAppEvents<T = unknown>(
  app: string,
  projectId: string | undefined | null,
  onEvent: (ev: AppEventEnvelope<T>) => void,
  opts: UseAppEventsOptions = {},
) {
  const { enabled = true } = opts;
  // Stable handler ref so the consumer can pass an inline arrow
  // without forcing reconnects on every render.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !app || !projectId) return;
    const ch = ensureChannel(app, projectId);
    const listener: Listener = (ev) => handlerRef.current(ev as AppEventEnvelope<T>);
    ch.listeners.add(listener);
    return () => {
      ch.listeners.delete(listener);
      maybeCloseChannel(app, projectId);
    };
  }, [app, projectId, enabled]);
}

// ─── Test helpers ────────────────────────────────────────────────────
// Exposed for the unit test; production callers should ignore.
export const __testHelpers = {
  channels,
  channelKey,
};
