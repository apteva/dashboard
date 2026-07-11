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
  reconnectAttempts: number;
}

// Reconnect budget mirrors the telemetry bus / chatConnections: a
// disconnected channel retries 5× with a 2s gap, then gives up.
// Otherwise an app whose endpoint 404s after uninstall would
// reconnect-loop forever, eating a connection-budget slot for the
// rest of the session.
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

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
    reconnectAttempts: 0,
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
  dbg("openConnection", { app, projectId, since: ch.lastSeq });
  const es = new EventSource(url, { withCredentials: true });
  ch.es = es;
  es.onopen = () => {
    ch.reconnectAttempts = 0; // successful connect resets the budget
    dbg("EventSource open", { app, projectId });
  };
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as AppEventEnvelope;
      if (ev.seq <= ch.lastSeq) return; // dedup across reconnects
      ch.lastSeq = ev.seq;
      dbg("event", { app, projectId, topic: ev.topic, seq: ev.seq, listeners: ch.listeners.size });
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
    dbg("EventSource error", { app, projectId, readyState: es.readyState });
    if (ch.es !== es) return;
    // Disable EventSource's unbounded native reconnect loop before applying
    // our own retry budget. Most browsers report CONNECTING, not CLOSED, from
    // onerror even for a persistent 404.
    es.close();
    ch.es = null;
    if (ch.closing) return;
    ch.reconnectAttempts += 1;
    if (ch.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      dbg("EventSource giving up after max reconnect attempts", { app, projectId });
      return;
    }
    if (ch.reconnectTimer) window.clearTimeout(ch.reconnectTimer);
    ch.reconnectTimer = window.setTimeout(() => {
      ch.reconnectTimer = null;
      openConnection(app, projectId, ch);
    }, RECONNECT_DELAY_MS);
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
  dbg("channel closed (no listeners left)", { app, projectId });
}

// ─── Cross-bundle multiplexer ────────────────────────────────────────
//
// App panels (apps/mcp/*/ui/*Panel.tsx) ship as standalone .mjs
// bundles loaded at runtime — they can't import from the dashboard's
// module graph (it'd break panels installed without the dashboard
// nearby). At runtime, though, every panel + the dashboard share one
// `window`, so we publish a tiny subscribe/unsubscribe handle that
// panels detect and reuse. Net effect: 17+ inline EventSources across
// the panel set collapse into one shared channel per (app, project).
// Without this, opening a few panels in the agent detail page burns
// the browser's per-origin HTTP/1.1 connection budget and stuck POSTs
// follow.

interface AppEventsBridge {
  subscribe(
    app: string,
    projectId: string,
    fn: (ev: AppEventEnvelope) => void,
  ): () => void;
}

declare global {
  interface Window {
    __aptevaAppEvents?: AppEventsBridge;
  }
}

// dbg — no-op. Originally a console.log channel for the chat-card
// hang investigation; that's fixed, but we keep the call sites so
// flipping it back on for future regressions is a one-line change.
// Don't gate it on localStorage — the user's call after the last
// debug round was that runtime gates accumulate cruft, so the
// honest move is to switch this back to console.log when needed.
function dbg(..._args: unknown[]) {
  // intentionally empty
}

if (typeof window !== "undefined") {
  const bridge: AppEventsBridge = {
    subscribe(app, projectId, fn) {
      const key = channelKey(app, projectId);
      const ch = ensureChannel(app, projectId);
      ch.listeners.add(fn);
      dbg("bridge.subscribe", { app, projectId, listeners: ch.listeners.size, key });
      return () => {
        ch.listeners.delete(fn);
        const n = ch.listeners.size;
        maybeCloseChannel(app, projectId);
        dbg("bridge.unsubscribe", { app, projectId, listenersAfter: n, key });
      };
    },
  };
  // Don't trample if a previous module load already installed it
  // (HMR edge case). The first one wins; later ones share state via
  // the module-scoped `channels` map.
  if (!window.__aptevaAppEvents) {
    window.__aptevaAppEvents = bridge;
    dbg("bridge installed on window.__aptevaAppEvents");
  } else {
    dbg("bridge already installed by an earlier module load");
  }
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
