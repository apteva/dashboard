// chatConnections — global, per-chat SSE manager.
//
// Connection intent is scoped to one browser tab and persisted in
// sessionStorage. It therefore survives React remounts, dashboard navigation,
// and a full-page refresh, while naturally disappearing when the tab closes.
// This is deliberately narrower than the old localStorage design, which had
// two structural problems:
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
// Only one per-chat SSE is active in a tab. Opening another conversation moves
// the live connection instead of accumulating one socket per conversation.
// Explicit Disconnect is remembered for that chat for the remainder of the
// tab session, so an auto-connected panel cannot silently reconnect it.
//
// Lifecycle:
//   - ChatPanel calls connect(chatId, instanceId) when the conversation is
//     active or the user clicks Connect. Disconnect is the only explicit
//     teardown; component unmounts do not own connection lifetime.
//   - ChatPanel calls subscribeMessages(chatId, sinceId, fn) on mount to
//     receive live messages. Switching conversations moves the single active
//     connection; navigating elsewhere leaves it alive.
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
const STREAM_DONE_GRACE_MS = 1500;
const SETTLED_STREAM_TTL_MS = 30_000;
const SETTLED_STREAM_MAX = 20;
const ACTIVE_CONNECTION_KEY = "apteva.chat.active-connection.v1";
const EXPLICITLY_DISCONNECTED_KEY = "apteva.chat.explicitly-disconnected.v1";

interface StoredConnectionIntent {
  chatId: string;
  instanceId: number;
}

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
  // Message rows and stream frames travel over two independent server
  // channels. A durable row can therefore win the select race before the
  // final stream frame for the same call. Keep short-lived tombstones so a
  // late ephemeral frame cannot recreate a duplicate assistant bubble.
  settledStreamCalls: Map<string, number>;
  recentAgentMessages: Array<{ content: string; settledAt: number }>;
  streamClearTimer: number | null;
  retryTimer: number | null;
  closed: boolean;
}

export class ChatConnectionsManager {
  private byChat = new Map<string, Conn>();
  private allListeners = new Set<StateListener>();
  private activeIntent: StoredConnectionIntent | null = null;
  private explicitlyDisconnected = new Set<string>();
  private storageLoaded = false;

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

  /** Whether this tab currently intends to keep the chat connected. */
  isConnected(chatId: string): boolean {
    this.loadStorage();
    return this.activeIntent?.chatId === chatId;
  }

  /** Resolve initial panel state without letting autoConnect override a
   * deliberate Disconnect made earlier in this tab. */
  shouldConnect(chatId: string, autoConnect: boolean): boolean {
    this.loadStorage();
    if (this.activeIntent?.chatId === chatId) return true;
    if (this.explicitlyDisconnected.has(chatId)) return false;
    return autoConnect;
  }

  /** Restore the tab's one active connection after a full-page refresh. */
  resumeSession(): void {
    this.loadStorage();
    const active = this.activeIntent;
    if (!active || this.explicitlyDisconnected.has(active.chatId)) return;
    // Generic conversations are selected and auto-connected by their owning
    // ChatPanel after the conversation list has proved they still exist. Do
    // not probe a persisted conv-* id here: a deleted row produces a noisy
    // browser-console 404 before the page can discard it. Primary default
    // chats can still resume immediately on dashboard boot.
    if (active.chatId.startsWith("conv-")) {
      this.forgetChat(active.chatId);
      return;
    }
    this.openConnection(active.chatId, active.instanceId);
    this.notifyAll();
  }

  /** Open (or refresh) the SSE for one chat. Idempotent — calling
   *  twice while open is a no-op. */
  connect(chatId: string, instanceId: number): void {
    this.loadStorage();
    this.activeIntent = { chatId, instanceId };
    this.explicitlyDisconnected.delete(chatId);
    this.persistStorage();
    for (const c of Array.from(this.byChat.values())) {
      if (c.chatId === chatId) continue;
      this.closeConnection(c, false);
      this.byChat.delete(c.chatId);
    }
    this.openConnection(chatId, instanceId);
    this.notifyAll();
  }

  /** Close the SSE and tell the agent the user is gone. Idempotent. */
  disconnect(chatId: string, instanceId: number): void {
    this.loadStorage();
    const c = this.byChat.get(chatId);
    const wasActive = this.activeIntent?.chatId === chatId;
    if (wasActive) this.activeIntent = null;
    this.explicitlyDisconnected.add(chatId);
    this.persistStorage();
    if (c) {
      this.closeConnection(c, true);
      this.byChat.delete(chatId);
    } else if (wasActive) {
      // A restored intent may be disconnected before EventSource reaches open.
      chat.presence(chatId, "disconnected").catch(() => {});
    }
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
    for (const c of Array.from(this.byChat.values())) this.closeConnection(c, true);
    this.byChat.clear();
    this.activeIntent = null;
    this.explicitlyDisconnected.clear();
    this.persistStorage();
    this.notifyAll();
  }

  /** Drop every trace of an instance after the user deletes it: close
   *  any live SSE so the retry loop doesn't 404-spam after delete.
   *  Skip the "[chat] user disconnected" send because the instance is
   *  already gone server-side. Session-only design means there's no
   *  persisted intent to clear. */
  forgetInstance(instanceId: number): void {
    for (const c of Array.from(this.byChat.values())) {
      if (c.instanceId !== instanceId) continue;
      this.closeConnection(c, false);
      this.byChat.delete(c.chatId);
    }
    this.loadStorage();
    if (this.activeIntent?.instanceId === instanceId) this.activeIntent = null;
    this.persistStorage();
    this.notifyAll();
  }

  /** Forget a conversation immediately after it is permanently deleted.
   *  The row no longer exists, so this intentionally skips the presence
   *  callback and cancels every pending EventSource retry. */
  forgetChat(chatId: string): void {
    this.loadStorage();
    const c = this.byChat.get(chatId);
    if (c) {
      this.closeConnection(c, false);
      this.byChat.delete(chatId);
    }
    if (this.activeIntent?.chatId === chatId) this.activeIntent = null;
    this.explicitlyDisconnected.delete(chatId);
    this.persistStorage();
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
        recentBuffer: [],
        msgListeners: new Set(),
        stateListeners: new Set(),
        streamListeners: new Set(),
        currentStream: null,
        settledStreamCalls: new Map(),
        recentAgentMessages: [],
        streamClearTimer: null,
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
        // When a real agent message lands, the streaming bubble's job
        // is done. Remember both its content and the active call id before
        // notifying React. That makes the provisional-to-durable swap atomic
        // and prevents a later frame from the parallel stream channel from
        // resurrecting the same text.
        if (m.role === "agent") {
          this.rememberAgentMessage(c, m.content);
          if (c.currentStream?.call_id) {
            this.rememberSettledStreamCall(c, c.currentStream.call_id);
          }
          if (c.currentStream) {
            this.cancelStreamClear(c);
            c.currentStream = null;
            for (const fn of c.streamListeners) fn(null);
          }
        }
        for (const fn of c.msgListeners) fn(m);
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
        this.pruneSettledStreams(c);
        if (f.call_id && c.settledStreamCalls.has(f.call_id)) return;
        if (!f.done && this.frameMatchesRecentAgentMessage(c, f.text)) {
          if (f.call_id) this.rememberSettledStreamCall(c, f.call_id);
          return;
        }
        if (f.done) {
          // Normally the durable row arrives first and clears the matching
          // bubble immediately. A suppressed duplicate has no durable row, so
          // retain the final frame briefly, then remove the orphan.
          if (!c.currentStream || (f.call_id && c.currentStream.call_id !== f.call_id)) return;
          if (f.call_id) this.rememberSettledStreamCall(c, f.call_id);
          this.cancelStreamClear(c);
          c.streamClearTimer = window.setTimeout(() => {
            c.streamClearTimer = null;
            if (!c.currentStream || (f.call_id && c.currentStream.call_id !== f.call_id)) return;
            c.currentStream = null;
            for (const fn of c.streamListeners) fn(null);
          }, STREAM_DONE_GRACE_MS);
          return;
        }
        this.cancelStreamClear(c);
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
        this.cancelStreamClear(c);
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

  private closeConnection(c: Conn, explicit: boolean): void {
    c.closed = true;
    this.cancelStreamClear(c);
    if (c.retryTimer !== null) {
      clearTimeout(c.retryTimer);
      c.retryTimer = null;
    }
    if (c.es) {
      c.es.close();
      c.es = null;
    }
    if (explicit && c.open) {
      chat.presence(c.chatId, "disconnected").catch(() => {});
    }
    c.open = false;
    if (c.currentStream) {
      c.currentStream = null;
      for (const fn of c.streamListeners) fn(null);
    }
    this.notify(c);
  }

  private cancelStreamClear(c: Conn): void {
    if (c.streamClearTimer !== null) {
      clearTimeout(c.streamClearTimer);
      c.streamClearTimer = null;
    }
  }

  private rememberSettledStreamCall(c: Conn, callId: string): void {
    if (!callId) return;
    c.settledStreamCalls.set(callId, Date.now());
    this.pruneSettledStreams(c);
  }

  private rememberAgentMessage(c: Conn, content: string): void {
    const normalized = normalizeStreamText(content);
    if (!normalized) return;
    c.recentAgentMessages.push({ content: normalized, settledAt: Date.now() });
    this.pruneSettledStreams(c);
  }

  private frameMatchesRecentAgentMessage(c: Conn, text: string): boolean {
    const normalized = normalizeStreamText(text);
    if (!normalized) return false;
    return c.recentAgentMessages.some((message) => message.content.startsWith(normalized));
  }

  private pruneSettledStreams(c: Conn): void {
    const cutoff = Date.now() - SETTLED_STREAM_TTL_MS;
    for (const [callId, settledAt] of c.settledStreamCalls) {
      if (settledAt < cutoff) c.settledStreamCalls.delete(callId);
    }
    c.recentAgentMessages = c.recentAgentMessages
      .filter((message) => message.settledAt >= cutoff)
      .slice(-SETTLED_STREAM_MAX);
    if (c.settledStreamCalls.size > SETTLED_STREAM_MAX) {
      const overflow = c.settledStreamCalls.size - SETTLED_STREAM_MAX;
      for (const callId of [...c.settledStreamCalls.keys()].slice(0, overflow)) {
        c.settledStreamCalls.delete(callId);
      }
    }
  }

  private loadStorage(): void {
    if (this.storageLoaded) return;
    this.storageLoaded = true;
    try {
      const activeRaw = sessionStorage.getItem(ACTIVE_CONNECTION_KEY);
      if (activeRaw) {
        const value = JSON.parse(activeRaw) as Partial<StoredConnectionIntent>;
        if (typeof value.chatId === "string" && Number.isFinite(value.instanceId)) {
          this.activeIntent = { chatId: value.chatId, instanceId: Number(value.instanceId) };
        }
      }
      const disconnectedRaw = sessionStorage.getItem(EXPLICITLY_DISCONNECTED_KEY);
      if (disconnectedRaw) {
        const values = JSON.parse(disconnectedRaw) as unknown;
        if (Array.isArray(values)) {
          this.explicitlyDisconnected = new Set(values.filter((value): value is string => typeof value === "string"));
        }
      }
    } catch {
      // Storage can be unavailable in privacy modes; in-memory behavior still
      // preserves connections across SPA navigation.
    }
  }

  private persistStorage(): void {
    try {
      if (this.activeIntent) sessionStorage.setItem(ACTIVE_CONNECTION_KEY, JSON.stringify(this.activeIntent));
      else sessionStorage.removeItem(ACTIVE_CONNECTION_KEY);
      sessionStorage.setItem(EXPLICITLY_DISCONNECTED_KEY, JSON.stringify([...this.explicitlyDisconnected]));
    } catch {
      // See loadStorage: in-memory intent remains authoritative for this page.
    }
  }
}

function normalizeStreamText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
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
