// Chat → notifications-tray driver.
//
// Wires the channel-chat app's wildcard SSE + unread-summary endpoint
// into the generic notifications store. Maintains a per-chat watermark
// in localStorage so reload and cross-tab transitions agree on what's
// been seen. Also handles the optional desktop-notification opt-in.
//
// Single instance per tab, started by Layout once the user is logged
// in. Returns a cleanup function so a logout can tear it down.

import { chat, type ChatMessageRow, type UnreadSummaryRow } from "../api";
import { notifications, type Notification } from "./notifications";

const WATERMARK_KEY = (chatId: string) => `apteva.chat.lastSeen.${chatId}`;
const DESKTOP_TOGGLE_KEY = "apteva.notifications.desktop";

function getWatermark(chatId: string): number {
  try {
    const v = localStorage.getItem(WATERMARK_KEY(chatId));
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

// Set of chat ids the user is *currently viewing* in a mounted, visible
// ChatPanel. Messages for these chats bypass the tray entirely — the
// user sees them in the panel itself, no badge needed. The watermark
// advances automatically when a new message arrives for a focused
// chat, so unmounting + reloading doesn't reintroduce the badge.
const focusedChats = new Set<string>();

/** ChatPanel calls this when it mounts (and tab is visible) to claim
 * focus on a chat. Returns a release fn for the unmount cleanup. */
export function focusChat(chatId: string): () => void {
  focusedChats.add(chatId);
  // The tray may already be holding a stale entry for this chat from
  // before mount — clear it on focus too.
  notifications.remove(`chat:${chatId}`);
  return () => {
    focusedChats.delete(chatId);
  };
}

function setWatermark(chatId: string, latestId: number): void {
  try {
    localStorage.setItem(WATERMARK_KEY(chatId), String(latestId));
  } catch {
    // localStorage may throw in private mode; the server-backed
    // watermark covers persistence in that case.
  }
}

/** Drop every trace of a chat from the tray + localStorage. Called on
 * instance delete so the watermark and any pending badge entry don't
 * outlive the chat — otherwise a new instance with the same numeric id
 * (rare but possible after wipes) would inherit a stale "last seen"
 * point and silently miss the first messages. */
export function forgetChat(chatId: string): void {
  try {
    localStorage.removeItem(WATERMARK_KEY(chatId));
  } catch {
    // localStorage unavailable; nothing to clean up there.
  }
  notifications.remove(`chat:${chatId}`);
  focusedChats.delete(chatId);
}

/** Advance the watermark (localStorage instant + server eventual) and
 * remove the matching notification entry. Idempotent: if the new id is
 * below the existing watermark, no-op locally; the server is monotonic
 * so a redundant POST is harmless. */
export function markChatSeen(chatId: string, latestId: number): void {
  if (latestId <= 0) return;
  const cur = getWatermark(chatId);
  if (latestId > cur) {
    setWatermark(chatId, latestId);
  }
  notifications.remove(`chat:${chatId}`);
  // Fire-and-forget server sync — failures are tolerable because
  // localStorage already reflects the new state for this device, and
  // the next /unread-summary will reconcile.
  void chat.markSeen(chatId, latestId).catch(() => {});
}

function previewFor(role: string, content: string): string {
  // Trim the system-message level prefix the channel adds so the tray
  // shows the human-readable body.
  if (role === "system") {
    const m = content.match(/^\[(info|warn|alert|error)\]\s*(.*)$/);
    if (m) return m[2];
  }
  if (role === "user") return `you: ${content}`;
  return content;
}

function titleFor(instanceName: string): string {
  return instanceName || "Agent";
}

/** Build a Notification from one chat row + its unread count. */
function buildNotification(
  chatId: string,
  instanceId: number,
  instanceName: string,
  latestId: number,
  latestRole: string,
  latestPreview: string,
  latestAt: string,
  count: number,
): Notification {
  return {
    id: `chat:${chatId}`,
    source: "chat",
    title: titleFor(instanceName),
    preview: previewFor(latestRole, latestPreview),
    ts: latestAt,
    count,
    unread: count > 0,
    latestId,
    ref: { kind: "instance-chat", instanceId },
  };
}

function maybeDesktopNotify(n: Notification): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (localStorage.getItem(DESKTOP_TOGGLE_KEY) !== "1") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const native = new window.Notification(n.title, {
      body: n.preview.slice(0, 140),
      tag: n.id, // dedup: rapid messages collapse into one OS toast
      icon: "/favicon.ico",
      silent: false,
    });
    native.onclick = () => {
      window.focus();
      const ref = n.ref;
      if (ref?.kind === "instance-chat") {
        // Layout's NotificationsTray owns routing; here we just hint
        // via a custom event the tray can listen to.
        window.dispatchEvent(
          new CustomEvent("apteva.openNotification", { detail: n }),
        );
      }
      native.close();
    };
  } catch {
    // Notification API can throw in some embeddings; we just no-op.
  }
}

interface ChatNotifState {
  chatToInstance: Map<string, { id: number; name: string }>;
}

const state: ChatNotifState = {
  chatToInstance: new Map(),
};

async function seed(): Promise<void> {
  let summary: UnreadSummaryRow[];
  try {
    summary = await chat.unreadSummary();
  } catch {
    return; // server hasn't shipped the endpoint yet, or auth missing
  }
  for (const row of summary) {
    state.chatToInstance.set(row.chat_id, {
      id: row.instance_id,
      name: row.instance_name,
    });
    // Reconcile localStorage with the server's view, clamped to the
    // server's real latest_id. A localStorage value above latest_id
    // is a data corruption artifact (e.g. an old build that wrote
    // Number.MAX_SAFE_INTEGER as a "fully read" sentinel) — we treat
    // the server's latest as the ceiling so the next message can show
    // up as unread again.
    const local = getWatermark(row.chat_id);
    const ceiling = row.latest_id;
    const serverWM = Math.min(row.last_seen_id, ceiling);
    const candidate = Math.max(serverWM, local);
    const watermark = candidate > ceiling ? ceiling : candidate;
    if (watermark !== local) setWatermark(row.chat_id, watermark);
    if (row.latest_id <= 0) continue;
    if (row.latest_role === "system" || row.latest_role === "") continue;
    if (row.latest_id <= watermark) {
      // Watermark caught up — drop any stale entry the tray was holding.
      notifications.remove(`chat:${row.chat_id}`);
      continue;
    }
    const count = row.latest_id - watermark;
    notifications.upsert(
      buildNotification(
        row.chat_id,
        row.instance_id,
        row.instance_name,
        row.latest_id,
        row.latest_role,
        row.latest_preview,
        row.latest_at,
        count,
      ),
    );
  }
}

/** Mark every chat-source notification read at once. Used by the tray's
 * "mark all read" button. Advances each chat's watermark to its current
 * known latest message id and clears the entries. */
export function markAllChatsSeen(): void {
  const items = notifications.getSnapshot();
  for (const n of items) {
    if (!n.id.startsWith("chat:")) continue;
    if (!n.latestId) continue;
    const chatId = n.id.slice(5);
    markChatSeen(chatId, n.latestId);
  }
}

function ingest(msg: ChatMessageRow): void {
  if (msg.role === "system") return;
  const meta = state.chatToInstance.get(msg.chat_id);
  if (!meta) {
    // Chat we don't know yet (e.g. created mid-session) — refresh
    // the cache and let the next delivery land.
    void seed();
    return;
  }
  // If the user is currently viewing this chat, the tray must not
  // badge — they'll see the message in the panel itself. Auto-mark
  // the watermark too so a later reload doesn't pop a stale badge
  // for messages already on screen.
  if (focusedChats.has(msg.chat_id)) {
    markChatSeen(msg.chat_id, msg.id);
    return;
  }
  const watermark = getWatermark(msg.chat_id);
  if (msg.id <= watermark) return;
  const existing = notifications.getSnapshot().find((n) => n.id === `chat:${msg.chat_id}`);
  const count = (existing?.count || 0) + 1;
  const notif = buildNotification(
    msg.chat_id,
    meta.id,
    meta.name,
    msg.id,
    msg.role,
    msg.content,
    msg.created_at,
    count,
  );
  notifications.upsert(notif);
  if (msg.role === "agent") maybeDesktopNotify(notif);
}

function startSSE(): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let backoff = 500;

  const open = () => {
    if (closed) return;
    es = chat.streamUser();
    es.onopen = () => {
      backoff = 500; // reset on successful connect
    };
    es.onmessage = (ev) => {
      if (!ev.data) return;
      try {
        ingest(JSON.parse(ev.data) as ChatMessageRow);
      } catch {
        // ignore unparseable
      }
    };
    es.onerror = () => {
      es?.close();
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
  };

  open();

  return () => {
    closed = true;
    es?.close();
  };
}

function startStorageSync(): () => void {
  // When another tab marks a chat read (advances its watermark), drop
  // the corresponding tray entry in this tab too.
  const listener = (ev: StorageEvent) => {
    if (!ev.key) return;
    const prefix = "apteva.chat.lastSeen.";
    if (!ev.key.startsWith(prefix)) return;
    const chatId = ev.key.slice(prefix.length);
    notifications.remove(`chat:${chatId}`);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Boot the chat-notifications source. Returns cleanup. */
export function startChatNotifications(): () => void {
  void seed();
  const stopSSE = startSSE();
  const stopStorage = startStorageSync();
  return () => {
    stopSSE();
    stopStorage();
    notifications.reset();
  };
}

/** Toggle persisted across reloads. Permission prompt is requested on
 * the same user gesture that toggles ON. */
export async function setDesktopNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    localStorage.removeItem(DESKTOP_TOGGLE_KEY);
    return false;
  }
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "denied") return false;
  if (Notification.permission !== "granted") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return false;
  }
  localStorage.setItem(DESKTOP_TOGGLE_KEY, "1");
  return true;
}

export function desktopNotificationsEnabled(): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  return localStorage.getItem(DESKTOP_TOGGLE_KEY) === "1";
}
