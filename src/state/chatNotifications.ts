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

/** Advance the watermark and remove the matching notification entry.
 * Idempotent: if the new id is below the existing watermark, no-op. */
export function markChatSeen(chatId: string, latestId: number): void {
  if (latestId <= 0) return;
  const cur = getWatermark(chatId);
  if (latestId <= cur) return;
  try {
    localStorage.setItem(WATERMARK_KEY(chatId), String(latestId));
  } catch {
    // localStorage may throw in private mode; we'll re-mark on next message.
  }
  notifications.remove(`chat:${chatId}`);
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
    if (row.latest_id <= 0) continue;
    if (row.latest_role === "system" || row.latest_role === "") continue;
    const watermark = getWatermark(row.chat_id);
    if (row.latest_id <= watermark) continue;
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

function ingest(msg: ChatMessageRow): void {
  if (msg.role === "system") return;
  const meta = state.chatToInstance.get(msg.chat_id);
  // If we don't know the instance yet (chat created mid-session),
  // refresh the cache opportunistically.
  if (!meta) {
    void seed();
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
        const msg = JSON.parse(ev.data) as ChatMessageRow;
        ingest(msg);
      } catch {
        // ignore unparseable
      }
    };
    es.onerror = () => {
      // Browser auto-retries on some network errors but not auth failures
      // (401 closes the stream permanently). Manual reopen with backoff
      // covers both — caps at 30s so a logged-out tab doesn't spin.
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
