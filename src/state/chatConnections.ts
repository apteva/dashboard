// chatConnections — global, per-chat SSE manager.
//
// Session-only: the connect intent is not persisted. Every chat
// starts disconnected on page load; the user clicks "connect" to
// activate live messaging for the current tab. This is a deliberate
// step back from a previous "remember intent in localStorage +
// resume on boot" design, which had two structural problems:
//
//   1. Stale intents survived instance deletion. If an instance was
//      removed (especially via a path that didn't run a dashboard
//      cleanup hook — e.g. direct DB delete), the localStorage entry
//      lived on. On the next page load, resumeFromStorage tried to
//      reopen its chat SSE, the server returned 404, and the
//      onerror retry loop reopened it every 1.5s forever — burning
//      a connection slot in retry state on every dashboard boot.
//
//   2. Cross-device "I want this chat live" sync wasn't real anyway:
//      localStorage is per-browser, per-profile. The persistence was
//      already inconsistent with the user's actual mental model.
//
// Session-only matches what "connected" semantically means — "I'm
// watching now." Closing the tab releases all subscriptions; the
// agent stops getting [chat] connected pings; the user is responsible
// for clicking connect again next time. No magic, no drift.
//
// Lifecycle:
//   - ChatPanel calls connect(chatId, instanceId) when the user
//     clicks the connect toggle (and disconnect for the opposite).
//     Emits the [chat] user connected/disconnected events to the
//     agent.
//   - ChatPanel calls subscribeMessages(chatId, sinceId, fn) on mount
//     to receive live messages; cleanup just unsubscribes — the SSE
//     stays open as long as the user has the chat connected.
//   - Agent delete calls forgetInstance(instanceId) to immediately
//     close any live SSE for that instance (otherwise a successful
//     delete leaves the SSE 404-retrying for the rest of the session).
//
// Reconnection: three fast retries, then a low-frequency 30s backoff.
// A transient server restart must not permanently downgrade chat to REST
// polling, while the slow backoff still prevents a missing/deleted chat from
// burning connection slots in a tight loop. Explicit disconnect/delete stops
// every pending attempt.

import { chat, type ChatMessageRow } from "../api";

const BUFFER_MAX = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const DEGRADED_RETRY_DELAY_MS = 30_000;

type MsgListener = (m: ChatMessageRow) => void;
type StateListener = () => void;

// StreamFrame mirrors the server-side channelchat.StreamFrame shape.
// Arrives on the SSE stream under the `stream` event name, separate
// from `message` (which carries final ChatMessageRow rows). Single
// place to disable streaming end-to-end on the server is the
// CHANNELCHAT_STREAMING env var; on the dashboard, this whole field
// + addEventListener block is what would be reverted.
export interface StreamFrame {
  type: "stream";
  chat_id: string;
  thread_id: string;
  call_id: string;
  text: string;
  done?: boolean;
  created_at?: string;
}

type StreamListener = (f: StreamFrame | null) => void;

interface Conn {
  chatId: string;
  instanceId: number;
  es: EventSource | null;
  open: boolean;
  failed: boolean; // true after MAX_RETRIES — UI surfaces a status dot
  retries: number;
  highestSeenId: number;
  signaledConnected: boolean;
  recentBuffer: ChatMessageRow[];
  msgListeners: Set<MsgListener>;
  stateListeners: Set<StateListener>;
  // streamListeners receive ephemeral StreamFrame updates and a
  // null when the streaming bubble should be cleared (next real
  // agent message lands or the SSE drops). Reverting streaming
  // safely is: drop the addEventListener("stream", ...) below and
  // remove this set + subscribeStream method.
  streamListeners: Set<StreamListener>;
  currentStream: StreamFrame | null;
  retryTimer: number | null;
  closed: boolean;
}

export class ChatConnectionsManager {
  private byChat = new Map<string, Conn>();
  private allListeners = new Set<StateListener>();

  // ---- Public API ----------------------------------------------------

  /** True if the SSE is currently in OPEN readyState. */
  isOpen(chatId: string): boolean {
    return this.byChat.get(chatId)?.open ?? false;
  }

  /** True if the connection was retried out and gave up. UI can use
   *  this to render a "couldn't connect" state alongside the dot. */
  hasFailed(chatId: string): boolean {
    return this.byChat.get(chatId)?.failed ?? false;
  }

  /** Open (or refresh) the SSE for one chat. Idempotent — calling
   *  twice while open is a no-op. */
  connect(chatId: string, instanceId: number): void {
    this.openConnection(chatId, instanceId);
    this.notifyAll();
  }

  /** Close the SSE and tell the agent the user is gone. Idempotent. */
  disconnect(chatId: string, instanceId: number): void {
    const c = this.byChat.get(chatId);
    if (!c) {
      this.notifyAll();
      return;
    }
    c.closed = true;
    if (c.retryTimer !== null) {
      clearTimeout(c.retryTimer);
      c.retryTimer = null;
    }
    if (c.es) {
      c.es.close();
      c.es = null;
    }
    if (c.signaledConnected) {
      chat.presence(chatId, "disconnected").catch(() => {});
      c.signaledConnected = false;
    }
    c.open = false;
    this.notify(c);
    this.byChat.delete(chatId);
    this.notifyAll();
  }

  /** Subscribe to live messages for one chat. Replays any messages
   *  already buffered with id > sinceId so a late panel mount doesn't
   *  miss anything between the REST history fetch and this subscribe.
   *  Cleanup removes the listener but leaves the SSE open. */
  subscribeMessages(
    chatId: string,
    sinceId: number,
    fn: MsgListener,
  ): () => void {
    const c = this.byChat.get(chatId);
    if (!c) return () => {};
    for (const m of c.recentBuffer) {
      if (m.id > sinceId) fn(m);
    }
    c.msgListeners.add(fn);
    return () => {
      c.msgListeners.delete(fn);
    };
  }

  /** Subscribe to streaming-frame updates for one chat. The callback
   *  fires with the current StreamFrame (text grows monotonically
   *  across calls) and with `null` when the bubble should clear
   *  (next real agent message arrives or SSE drops). Returns
   *  unsubscribe; the SSE itself stays open.
   *
   *  Disabling end-to-end: server flag CHANNELCHAT_STREAMING=0
   *  stops emitting frames, so this listener simply never fires —
   *  no UI changes needed. To revert the dashboard piece only,
   *  delete this method, the streamListeners field, the
   *  addEventListener("stream", ...) in openConnection, and the
   *  StreamFrame export. */
  subscribeStream(chatId: string, fn: StreamListener): () => void {
    const c = this.ensureShell(chatId);
    c.streamListeners.add(fn);
    if (c.currentStream) fn(c.currentStream);
    return () => {
      c.streamListeners.delete(fn);
    };
  }

  /** Subscribe to SSE-open / connection state changes for one chat.
   *  Useful for the status dot. Cleanup is a no-op for SSE itself. */
  subscribeState(chatId: string, fn: StateListener): () => void {
    const c = this.ensureShell(chatId);
    c.stateListeners.add(fn);
    return () => {
      c.stateListeners.delete(fn);
    };
  }

  /** Subscribe to "any chat changed state" events. */
  subscribeAny(fn: StateListener): () => void {
    this.allListeners.add(fn);
    return () => {
      this.allListeners.delete(fn);
    };
  }

  /** Tear down everything — used on logout. */
  stopAll(): void {
    for (const c of Array.from(this.byChat.values())) {
      this.disconnect(c.chatId, c.instanceId);
    }
  }

  /** Drop every trace of an instance after the user deletes it: close
   *  any live SSE so the retry loop doesn't 404-spam after delete.
   *  Skip the "[chat] user disconnected" send because the instance is
   *  already gone server-side. Session-only design means there's no
   *  persisted intent to clear. */
  forgetInstance(instanceId: number): void {
    for (const c of Array.from(this.byChat.values())) {
      if (c.instanceId !== instanceId) continue;
      if (c.retryTimer !== null) {
        clearTimeout(c.retryTimer);
        c.retryTimer = null;
      }
      if (c.es) {
        c.es.close();
        c.es = null;
      }
      c.closed = true;
      c.open = false;
      c.signaledConnected = false;
      this.byChat.delete(c.chatId);
    }
    this.notifyAll();
  }

  // ---- Internals -----------------------------------------------------

  /** Make sure a shell record exists for state subscribers even when
   *  no connection is open yet. */
  private ensureShell(chatId: string): Conn {
    let c = this.byChat.get(chatId);
    if (!c) {
      c = {
        chatId,
        instanceId: 0,
        es: null,
        open: false,
        failed: false,
        retries: 0,
        highestSeenId: 0,
        signaledConnected: false,
        recentBuffer: [],
        msgListeners: new Set(),
        stateListeners: new Set(),
        streamListeners: new Set(),
        currentStream: null,
        retryTimer: null,
        closed: false,
      };
      this.byChat.set(chatId, c);
    }
    return c;
  }

  private openConnection(chatId: string, instanceId: number): void {
    const c = this.ensureShell(chatId);
    c.instanceId = instanceId;
    c.closed = false;
    c.failed = false;
    if (c.es) return; // already connecting / connected
    const since = c.highestSeenId;
    const es = chat.stream(chatId, since);
    c.es = es;
    es.onopen = () => {
      c.open = true;
      c.retries = 0; // reset budget after a successful connect
      this.notify(c);
      if (!c.signaledConnected) {
        c.signaledConnected = true;
        chat.presence(chatId, "connected").catch(() => {});
      }
    };
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data) as ChatMessageRow;
        if (!m || typeof m.id !== "number") return;
        if (m.id <= c.highestSeenId) return;
        c.highestSeenId = m.id;
        c.recentBuffer.push(m);
        if (c.recentBuffer.length > BUFFER_MAX) {
          c.recentBuffer.splice(0, c.recentBuffer.length - BUFFER_MAX);
        }
        for (const fn of c.msgListeners) fn(m);
        // When a real agent message lands, the streaming bubble's job
        // is done — clear it so the UI swaps without flicker. We
        // intentionally don't try to correlate by call_id; "the next
        // agent message wins" is robust against provider-specific
        // call-id quirks and avoids a swap race.
        if (m.role === "agent" && c.currentStream) {
          c.currentStream = null;
          for (const fn of c.streamListeners) fn(null);
        }
      } catch {
        // malformed frame — ignore
      }
    };
    // Named-event handler for stream frames (server emits with
    // `event: stream`). Default `onmessage` doesn't fire on named
    // events, so this and `onmessage` can't collide.
    es.addEventListener("stream", (ev) => {
      try {
        const f = JSON.parse((ev as MessageEvent).data) as StreamFrame;
        if (!f || f.type !== "stream") return;
        if (f.done) {
          c.currentStream = null;
          for (const fn of c.streamListeners) fn(null);
          return;
        }
        c.currentStream = f;
        for (const fn of c.streamListeners) fn(f);
      } catch {
        // malformed frame — ignore
      }
    });
    es.onerror = () => {
      c.open = false;
      // Drop any in-progress streaming bubble on disconnect — the
      // next thing the user sees should be the (real, DB-backed)
      // message that lands after reconnect, not a stale partial.
      if (c.currentStream) {
        c.currentStream = null;
        for (const fn of c.streamListeners) fn(null);
      }
      this.notify(c);
      if (c.es) {
        c.es.close();
        c.es = null;
      }
      if (c.closed) return;
      // Retry quickly for ordinary transport blips, then remain recoverable
      // at a low cadence. Permanently giving up here left a connected chat
      // frozen until remount and silently forced the REST backstop to do all
      // delivery after a brief server restart.
      c.retries += 1;
      const degraded = c.retries >= MAX_RETRIES;
      if (degraded) {
        c.failed = true;
        this.notify(c);
      }
      if (c.retryTimer !== null) clearTimeout(c.retryTimer);
      c.retryTimer = window.setTimeout(() => {
        c.retryTimer = null;
        this.openConnection(chatId, instanceId);
      }, degraded ? DEGRADED_RETRY_DELAY_MS : RETRY_DELAY_MS);
    };
  }

  private notify(c: Conn): void {
    for (const fn of c.stateListeners) fn();
    for (const fn of this.allListeners) fn();
  }

  private notifyAll(): void {
    for (const fn of this.allListeners) fn();
  }
}

export const chatConnections = new ChatConnectionsManager();

/** Walk localStorage and remove every legacy `chat.connected.<id>`
 *  key from the previous persistent-intent design. Idempotent and
 *  cheap — runs once on dashboard boot via Layout. After every user
 *  has booted at least once after the upgrade, this becomes a no-op
 *  that we can safely delete. */
export function purgeLegacyChatConnectedKeys(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (/^chat\.connected\.\d+$/.test(key)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    // localStorage unavailable; nothing to clean.
  }
}
