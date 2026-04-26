// chatConnections — global, per-chat SSE manager.
//
// Lifts the per-chat EventSource out of ChatPanel so the SSE survives
// component unmount + page navigation. While the dashboard tab is
// open, every chat the user has toggled "connected" stays subscribed
// — the agent sees chat as IsActive and can ping the user even while
// they're looking at the Apps tab or another instance.
//
// Lifecycle:
//   - Layout calls resumeFromStorage() on login → reopens SSEs for any
//     chat with chat.connected.<instanceId>=1 in localStorage.
//   - ChatPanel calls connect(chatId, instanceId) when the user clicks
//     the connect toggle (and disconnect for the opposite). Persists
//     intent in localStorage and emits the [chat] user connected /
//     disconnected events to the agent.
//   - ChatPanel calls subscribeMessages(chatId, sinceId, fn) on mount
//     to receive live messages; cleanup just unsubscribes — the SSE
//     stays open. Buffered recent messages are replayed for late
//     subscribers so a panel mount doesn't miss messages that arrived
//     while it was unmounted.
//
// No automatic reconnection cascade beyond a simple backoff — if the
// network blips, the manager retries every 1.5s until either the
// connect succeeds or the user explicitly disconnects.

import { chat, instances, type ChatMessageRow } from "../api";

const INTENT_KEY = (instanceId: number) => `chat.connected.${instanceId}`;
const BUFFER_MAX = 100;

type MsgListener = (m: ChatMessageRow) => void;
type StateListener = () => void;

interface Conn {
  chatId: string;
  instanceId: number;
  es: EventSource | null;
  open: boolean;
  highestSeenId: number;
  signaledConnected: boolean;
  recentBuffer: ChatMessageRow[];
  msgListeners: Set<MsgListener>;
  stateListeners: Set<StateListener>;
  retryTimer: number | null;
  closed: boolean;
}

class ChatConnectionsManager {
  private byChat = new Map<string, Conn>();
  private allListeners = new Set<StateListener>();

  // ---- Public API ----------------------------------------------------

  /** True if localStorage says the user wants this instance connected. */
  isConnectedIntent(instanceId: number): boolean {
    try {
      return localStorage.getItem(INTENT_KEY(instanceId)) === "1";
    } catch {
      return false;
    }
  }

  /** True if the SSE is currently in OPEN readyState. */
  isOpen(chatId: string): boolean {
    return this.byChat.get(chatId)?.open ?? false;
  }

  /** Open (or refresh) the SSE for one chat. Idempotent — calling
   * twice while open is a no-op. */
  connect(chatId: string, instanceId: number): void {
    this.persistIntent(instanceId, true);
    this.openConnection(chatId, instanceId);
    this.notifyAll();
  }

  /** Close the SSE and tell the agent the user is gone. Idempotent. */
  disconnect(chatId: string, instanceId: number): void {
    this.persistIntent(instanceId, false);
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
      instances
        .sendEvent(instanceId, "[chat] user disconnected from chat", "main")
        .catch(() => {});
      c.signaledConnected = false;
    }
    c.open = false;
    this.notify(c);
    this.byChat.delete(chatId);
    this.notifyAll();
  }

  /** Subscribe to live messages for one chat. Replays any messages
   * already buffered with id > sinceId so a late panel mount doesn't
   * miss anything between the REST history fetch and this subscribe.
   * Cleanup removes the listener but leaves the SSE open. */
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

  /** Subscribe to SSE-open / connection state changes for one chat.
   * Useful for the status dot. Cleanup is a no-op for SSE itself. */
  subscribeState(chatId: string, fn: StateListener): () => void {
    const c = this.ensureShell(chatId);
    c.stateListeners.add(fn);
    return () => {
      c.stateListeners.delete(fn);
    };
  }

  /** Subscribe to "any chat changed state" events. Used by future
   * dashboard widgets that want a global presence indicator. */
  subscribeAny(fn: StateListener): () => void {
    this.allListeners.add(fn);
    return () => {
      this.allListeners.delete(fn);
    };
  }

  /** Walk localStorage and reopen every chat the user previously
   * marked connected. Called by Layout once the user is logged in. */
  resumeFromStorage(): void {
    let opened = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const match = key.match(/^chat\.connected\.(\d+)$/);
        if (!match) continue;
        if (localStorage.getItem(key) !== "1") continue;
        const instanceId = parseInt(match[1], 10);
        if (!Number.isFinite(instanceId)) continue;
        // Default-chat-id convention mirrors store.go's defaultChatID.
        const chatId = `default-${instanceId}`;
        this.openConnection(chatId, instanceId);
        opened++;
      }
    } catch {
      // localStorage unavailable (private mode, sandbox); no-op.
    }
    if (opened > 0) this.notifyAll();
  }

  /** Tear down everything — used on logout. */
  stopAll(): void {
    for (const c of Array.from(this.byChat.values())) {
      this.disconnect(c.chatId, c.instanceId);
    }
  }

  // ---- Internals -----------------------------------------------------

  private persistIntent(instanceId: number, on: boolean): void {
    try {
      localStorage.setItem(INTENT_KEY(instanceId), on ? "1" : "0");
    } catch {
      // localStorage unavailable; intent is in-memory only this session.
    }
  }

  /** Make sure a shell record exists for state subscribers even when
   * no connection is open yet. */
  private ensureShell(chatId: string): Conn {
    let c = this.byChat.get(chatId);
    if (!c) {
      c = {
        chatId,
        instanceId: 0,
        es: null,
        open: false,
        highestSeenId: 0,
        signaledConnected: false,
        recentBuffer: [],
        msgListeners: new Set(),
        stateListeners: new Set(),
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
    if (c.es) return; // already connecting / connected
    const since = c.highestSeenId;
    const es = chat.stream(chatId, since);
    c.es = es;
    es.onopen = () => {
      c.open = true;
      this.notify(c);
      if (!c.signaledConnected) {
        c.signaledConnected = true;
        instances
          .sendEvent(instanceId, "[chat] user connected to chat", "main")
          .catch(() => {});
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
      } catch {
        // malformed frame — ignore
      }
    };
    es.onerror = () => {
      c.open = false;
      this.notify(c);
      if (c.es) {
        c.es.close();
        c.es = null;
      }
      if (c.closed) return;
      if (c.retryTimer !== null) clearTimeout(c.retryTimer);
      c.retryTimer = window.setTimeout(() => {
        c.retryTimer = null;
        this.openConnection(chatId, instanceId);
      }, 1500);
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
