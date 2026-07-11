import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { chat, type ChatAttachment, type ChatMessageContext, type ChatMessageRow } from "../api";
import { useProjects } from "../hooks/useProjects";
import {
  ChatComponentList,
  useInstalledApps,
} from "./apps/chatComponents";
import { ChatStatusDot } from "./ChatStatusDot";
import { markChatSeen, focusChat } from "../state/chatNotifications";
import { chatConnections } from "../state/chatConnections";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";
import type { SubscribeFn } from "./AgentView";
import { renderSafeMarkdown } from "../utils/safeMarkdown";
import { mergeChatMessages } from "../utils/chatMessages";
import { Modal } from "./Modal";

export interface ChatPanelHeader {
  title: string;
  subtitle?: string;
  running?: boolean;
  onBack?: () => void;
  onOpenAgent?: () => void;
  onOpenContext?: () => void;
  onToggleDesktopContext?: () => void;
  desktopContextOpen?: boolean;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "image";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  instanceId: number;
  // Telemetry subscribe — used ONLY for the status dot. Chat messages
  // come from the channel-chat app's SSE stream, not telemetry.
  subscribe: SubscribeFn;
  autoConnect?: boolean;
  hideHeader?: boolean;
  header?: ChatPanelHeader;
  messageContext?: ChatMessageContext;
  historyLimit?: number;
}

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

interface DraftAttachment extends ChatAttachment {
  id: string;
  data_url: string;
  name: string;
  mime_type: string;
  size: number;
}

// LiveTool — one tool call surfaced inline in the chat timeline.
// Distinct from any chat row; lives only in component state and is
// keyed by provider call_id. Tracks the streaming → called → done
// lifecycle plus enough metadata (thread, reason, duration) to
// render "who is doing what" between agent messages.
//
// startedAt is fixed at first-sight and never moves, so the tool's
// position in the interleaved timeline is stable even as state
// transitions in (re-renders only update icon / reason / duration).
interface LiveTool {
  id: string;             // call_id from the provider, or thread:name fallback
  threadId: string;       // "main" or sub-thread id — rendered so user can tell who's acting
  name: string;           // tool slug
  reason: string;         // the agent's free-text _reason at call time
  state: "streaming" | "called" | "done";
  success?: boolean;      // only on done
  durationMs?: number;    // only on done
  startedAt: number;      // canonical sort key for the timeline
  doneAt?: number;        // ms timestamp; for cap-eviction policy
}

// Tools we hide from the chat timeline. Pure agent housekeeping:
//   pace — sleep-rate adjustments fire constantly
//   done — thread terminator
//   channels_respond/channels_send/channels_status — ARE visible chat messages;
//     surfacing them as separate tool calls is pure noise (the user
//     already sees the message they produced as assistant turns).
const HIDDEN_TOOLS = new Set(["pace", "done", "channels_respond", "channels_send", "channels_status", "channels_request_approval"]);

// `send` is useful when it explains meaningful delegation, but noisy
// when it is only an internal completion/report-back hop.
function shouldHideTool(name: string, reason = ""): boolean {
  if (HIDDEN_TOOLS.has(name)) return true;
  if (name !== "send") return false;
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "report completion" ||
    normalized === "report back" ||
    normalized === "report result" ||
    normalized.includes("completion")
  );
}

// Cap on retained tool entries. Once exceeded we drop the oldest
// completed entry. In-flight (streaming/called) entries are never
// dropped — losing them mid-flight would leave the timeline with a
// "started but never finished" state we couldn't reason about.
const MAX_LIVE_TOOLS = 200;
const TOOL_BURST_MIN = 2;
const TOOL_BURST_IDLE_GAP_MS = 30_000;

// enforceCap drops the oldest completed entries when the map exceeds
// MAX_LIVE_TOOLS. Mutates and returns the same map for callsite
// brevity. No-op when under the cap, so the common case stays cheap.
function enforceCap(m: Map<string, LiveTool>): Map<string, LiveTool> {
  if (m.size <= MAX_LIVE_TOOLS) return m;
  const done = [...m.values()]
    .filter((t) => t.state === "done")
    .sort((a, b) => (a.doneAt || a.startedAt) - (b.doneAt || b.startedAt));
  let toDrop = m.size - MAX_LIVE_TOOLS;
  for (const t of done) {
    if (toDrop <= 0) break;
    m.delete(t.id);
    toDrop--;
  }
  return m;
}

// ChatPanel — DB-backed conversation view for a single instance.
//
// Previous implementation reconstructed chat state from a telemetry
// firehose (tool.call / llm.tool_chunk / tool.result + two-layer
// dedup). That was fundamentally wrong: the chat was a derived view of
// an ordered event stream, not a stored object, so ordering bugs and
// duplicates were inevitable. This implementation subscribes to the
// `channel-chat` app's REST + SSE surface. Messages have monotonic DB
// ids; reconnect fetches the exact gap via `since=<last_id>`. No
// dedup logic, no tool-call correlation, no streaming-text extractor.
export function ChatPanel({
  instanceId,
  subscribe,
  autoConnect = false,
  hideHeader = false,
  header,
  messageContext,
  historyLimit,
}: Props) {
  const { t } = useTranslation();
  // Project context — needed so chat-attached components can scope
  // their fetches and event subscriptions correctly. Falls back to
  // empty string when there's no current project (apps with chat
  // components won't render in that state, but plain text still
  // works).
  const { currentProject } = useProjects();
  const projectId = currentProject?.id ?? "";
  const installedApps = useInstalledApps(projectId || null);

  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suppressNextThinkingRef = useRef(false);
  const suppressNextThinkingTimerRef = useRef<number | null>(null);

  const armQuietFollowupTurn = useCallback(() => {
    suppressNextThinkingRef.current = true;
    if (suppressNextThinkingTimerRef.current !== null) {
      window.clearTimeout(suppressNextThinkingTimerRef.current);
    }
    suppressNextThinkingTimerRef.current = window.setTimeout(() => {
      suppressNextThinkingRef.current = false;
      suppressNextThinkingTimerRef.current = null;
    }, 15_000);
  }, []);

  const clearQuietFollowupTurn = useCallback(() => {
    suppressNextThinkingRef.current = false;
    if (suppressNextThinkingTimerRef.current !== null) {
      window.clearTimeout(suppressNextThinkingTimerRef.current);
      suppressNextThinkingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearQuietFollowupTurn();
  }, [clearQuietFollowupTurn]);

  // Ephemeral tool-activity strip. NEVER enters `messages` — that's
  // the previous implementation's mistake. The strip is pinned above
  // the input; in-flight tools appear there, completed ones fade out.
  // Keyed by call id (falls back to thread:name when id is absent
  // mid-stream), so the same tool transitions cleanly through its
  // streaming → called → done lifecycle without duplicating rows.
  const [liveTools, setLiveTools] = useState<Map<string, LiveTool>>(() => new Map());
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(() => new Set());

  // Ephemeral streaming bubble — the LLM-args text for an in-progress
  // `channels_respond` tool call, surfaced as the user's reply arrives
  // character-by-character. Cleared on the next real agent message,
  // on SSE drop, or on chat switch. Sourced from chatConnections's
  // subscribeStream — server flag CHANNELCHAT_STREAMING=0 stops the
  // frames at the source, so this state simply stays null end-to-end.
  const [streamingText, setStreamingText] = useState<string | null>(null);

  // Explicit connect/disconnect, session-only.
  //
  // Why explicit at all? The agent is proactive — when chat is
  // "connected" it may greet, ping, push a status update unprompted.
  // We want the user to own that "I'm available to be poked" signal,
  // not have it toggle silently as browser tabs open and close.
  //
  // Session-only: every chat starts disconnected on tab open; clicking
  // Connect opens the SSE for the current session. Closing the tab
  // releases. The previous design persisted `chat.connected.<id>=1` to
  // localStorage and resumed on boot, but stale entries (instances
  // deleted out-of-band) caused unbounded 404 retry loops that ate
  // the connection budget — see chatConnections.ts header.
  const [connected, setConnected] = useState<boolean>(() => autoConnect);

  // SSE "is the stream actually open?" — distinct from `connected`,
  // which is the user's INTENT. readyState transitions on retry are
  // surfaced here so the presence dot can say "reconnecting" instead
  // of a stale "connected".
  const [sseOpen, setSseOpen] = useState(false);

  // Plan-mode toggle. Session-only (no DB, no agent state) — when on,
  // handleSend wraps the user message with a "plan first, don't write"
  // prompt and a small Approve/Reject/Refine quick-action strip
  // appears above the input. Soft enforcement: the agent's wrapped
  // prompt tells it to investigate-then-plan; there is no runtime
  // gate on writes. Same trust contract as Claude Code's plan mode.
  const [planMode, setPlanMode] = useState(false);

  // Monotonic "highest id seen" — used as the `since` cursor on
  // reconnect and as the idempotency gate on SSE deliveries (reject
  // any row whose id we've already rendered).
  const sinceRef = useRef<number>(0);

  // All durable delivery paths converge here. In particular, do not reject a
  // row merely because its id is below the cursor: a fast SSE agent reply can
  // beat the preceding user POST response back to the browser.
  const mergeDurableMessages = useCallback((rows: ChatMessageRow[]) => {
    if (rows.length === 0) return;
    const maxId = rows.reduce((highest, row) => Math.max(highest, row.id), sinceRef.current);
    sinceRef.current = maxId;
    setMessages((current) => mergeChatMessages(current, rows));
    if (
      maxId > 0 &&
      chatId &&
      (typeof document === "undefined" || document.visibilityState === "visible")
    ) {
      markChatSeen(chatId, maxId);
    }
  }, [chatId]);

  useEffect(() => {
    if (autoConnect && chatId) {
      setConnected(true);
    }
  }, [autoConnect, chatId, instanceId]);

  // --- 1. Resolve the chat for this instance -----------------------------
  useEffect(() => {
    setChatId(null);
    setMessages([]);
    setHistoryReady(false);
    setError(null);
    sinceRef.current = 0;

    let cancelled = false;
    chat.listChats(instanceId)
      .then((chats) => {
        if (cancelled) return;
        if (chats.length > 0) {
          setChatId(chats[0].id);
        } else {
          // No chat yet — create one. This is a server-restart / fresh
          // instance corner case; normally the app auto-creates a
          // default chat via OnInstanceAttach.
          chat.createChat(instanceId).then((c) => {
            if (!cancelled) setChatId(c.id);
          }).catch((e) => !cancelled && setError(errMsg(e)));
        }
      })
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => { cancelled = true; };
  }, [instanceId]);

  // --- 2. Load history once chatId is known -----------------------------
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    chat.messages(chatId, 0, historyLimit)
      .then((rows) => {
        if (cancelled) return;
        // SSE starts as soon as chatId resolves. Merge history into any live
        // rows that arrived while this request was in flight; never replace
        // the real-time timeline with an older REST snapshot.
        setMessages((current) => mergeChatMessages(current, rows));
        const maxId = rows.reduce((m, r) => (r.id > m ? r.id : m), 0);
        sinceRef.current = Math.max(sinceRef.current, maxId);
        // Reading the chat clears its tray entry — but ONLY if the
        // tab is actually visible. A backgrounded tab that finishes
        // its history fetch shouldn't silently mark messages read
        // before the user has had a chance to see them.
        const visible = typeof document === "undefined" || document.visibilityState === "visible";
        if (maxId > 0 && visible) markChatSeen(chatId, maxId);
        setHistoryReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errMsg(e));
        // Do not open a stream from cursor zero after a history failure: that
        // can replay a huge chat and still leave a gap. A retry/remount will
        // resolve a trustworthy cursor first.
        setHistoryReady(false);
      });
    return () => { cancelled = true; };
  }, [chatId, historyLimit]);

  // --- 3. Hook into the global chat-connections manager ----------------
  //
  // The SSE no longer lives inside this component. The Layout-level
  // chatConnections singleton owns one EventSource per connected chat,
  // so navigating away from this instance does NOT close the connection
  // — the agent keeps seeing chat as IsActive and can ping the user
  // while they're on another page. ChatPanel is a viewer for the
  // singleton's state.
  //
  // Three things to wire:
  //   1. connect/disconnect toggle → manager.connect/disconnect
  //      (emits the [chat] user connected/disconnected events to the
  //      agent). Intent is session-only — closing the tab releases.
  //   2. Live messages → subscribeMessages, which replays buffered
  //      messages with id > sinceRef so a panel mount that comes
  //      after some messages already arrived doesn't miss them.
  //   3. SSE open state → subscribeState for the presence dot.
  useEffect(() => {
    if (!chatId) return;
    if (connected) {
      // Open SSE immediately. History and live delivery are independent;
      // delaying the EventSource behind REST broke the previously reliable
      // stream-frame path and made token streaming disappear.
      chatConnections.connect(chatId, instanceId);
    } else {
      chatConnections.disconnect(chatId, instanceId);
    }
  }, [chatId, connected, instanceId]);

  useEffect(() => {
    if (!chatId) return;
    setSseOpen(chatConnections.isOpen(chatId));
    return chatConnections.subscribeState(chatId, () => {
      setSseOpen(chatConnections.isOpen(chatId));
    });
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    return chatConnections.subscribeMessages(chatId, sinceRef.current, (row) => {
      mergeDurableMessages([row]);
    });
  }, [chatId, mergeDurableMessages]);

  // SSE is the low-latency path, but it must never be the sole display path
  // for rows that are already durable in SQLite. Reconcile from the cursor as
  // a cheap backstop so an exhausted/stale EventSource cannot leave the panel
  // frozen while user messages and channels_send replies keep persisting.
  useEffect(() => {
    if (!chatId || !historyReady || !connected) return;
    let cancelled = false;
    let inFlight = false;

    const reconcile = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        let cursor = sinceRef.current;
        for (let page = 0; page < 10 && !cancelled; page += 1) {
          const rows = await chat.messages(chatId, cursor, 200);
          if (cancelled) return;
          mergeDurableMessages(rows);
          if (rows.length < 200) break;
          cursor = rows.reduce((highest, row) => Math.max(highest, row.id), cursor);
        }
      } catch {
        // SSE may still be healthy; the next interval/visibility event retries.
      } finally {
        inFlight = false;
      }
    };

    const recover = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (chatConnections.hasFailed(chatId)) {
        // A new online/visibility transition is a bounded, external recovery
        // signal. It resets the exhausted stream without a permanent 404 loop.
        chatConnections.connect(chatId, instanceId);
      }
      void reconcile();
    };

    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 5_000);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [chatId, connected, historyReady, instanceId, mergeDurableMessages]);

  // Claim "focused chat" on the notifications driver whenever the
  // panel has a live delivery stream AND the tab is visible. The wildcard SSE that
  // feeds the tray skips messages for the focused chat (and silently
  // advances the watermark), so a user staring at the chat panel never
  // sees a tray badge for messages that are already on screen. A disconnected
  // panel must not claim focus: it cannot render new messages, so suppressing
  // the wildcard notification there would silently mark unseen messages read.
  useEffect(() => {
    if (!chatId || !historyReady || !connected || !sseOpen || typeof document === "undefined") return;
    let release: (() => void) | null = null;
    const apply = () => {
      const visible = document.visibilityState === "visible";
      if (visible && !release) {
        release = focusChat(chatId);
      } else if (!visible && release) {
        release();
        release = null;
      }
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      if (release) release();
    };
  }, [chatId, historyReady, connected, sseOpen]);

  // --- 4. Stick-to-bottom auto-scroll (ChatGPT/Claude-style) -----------
  //
  // Two pieces:
  //   A. Track whether the user is "at bottom" (within 60px of the
  //      end). Anything further is a deliberate scroll-up — we don't
  //      yank them back when new content arrives.
  //   B. On every timeline/messages change, if they're at bottom,
  //      pin to the new bottom. This fires per-streaming-chunk
  //      because each chunk re-renders messages, AND on tool-row
  //      arrivals because timeline changes there too.
  //
  // The previous version listened on `[messages]` only, so:
  //   - tool rows arriving never scrolled.
  //   - it always yanked to bottom even when the user had scrolled
  //     up to read older history.
  //   - streaming chunks technically did fire (messages array
  //     replaced per chunk), but the yank-while-reading bug made it
  //     feel wrong anyway.
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
      setAtBottom(dist < 60);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Seed on mount / chat switch so the initial empty viewport reads
    // as "at bottom" (so the first message scrolls into view).
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [chatId]);

  // Activity state. Declared up here (not next to its event handler
  // far below) because the auto-scroll effect right beneath this
  // depends on activity.phase — moving the useState down would
  // re-introduce the TDZ error we just fixed in AgentView.
  // The full state machine that drives this still lives further
  // down beside the related useTelemetryEvents subscription; only
  // the storage hook is hoisted.
  type AgentActivity =
    | { phase: "idle" }
    | { phase: "thinking"; since: number; thread: string };
  const [activity, setActivity] = useState<AgentActivity>({ phase: "idle" });

  useEffect(() => {
    if (!chatId) return;
    setActivity({ phase: "idle" });
    armQuietFollowupTurn();
  }, [connected, chatId, armQuietFollowupTurn]);

  // Pin to bottom when the timeline grows OR the viewport shrinks
  // and the user is at bottom. Deps cover three things:
  //   - messages / liveTools / streamingText (timeline growth)
  //   - atBottom (a user who scrolls back down auto-pins next render)
  //   - activity.phase (the "Thinking…" strip toggling on shrinks the
  //     scroll viewport by ~30px; without this dep the just-sent
  //     user message gets clipped behind the strip until the next
  //     message arrives)
  useEffect(() => {
    if (!atBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveTools, streamingText, atBottom, activity.phase]);

  // --- 4b. Live tool activity (interleaved into the timeline) -----------
  //
  // Subscribe to the per-instance telemetry SSE and track every
  // tool call across every thread. The timeline render below sorts
  // these alongside DB messages by timestamp, so the user sees an
  // accurate "agent said X, then leader-thread did Y, then agent
  // said Z" reading order.
  //
  // Importantly, tools and messages are kept in SEPARATE state
  // shapes. The previous broken implementation tried to derive
  // chat state from the telemetry firehose; that was the ordering
  // bug. Here we never copy a tool into messages or vice versa —
  // they only meet at render time, sorted by timestamp.
  //
  // Three event types drive the lifecycle:
  //   llm.tool_chunk → first chunk creates a "streaming" entry. We
  //                    don't render args (intentional — args were
  //                    the noisy bit), only the name + thread.
  //   tool.call      → args finalised, executor running. Carries
  //                    the agent's free-text `reason` — the human-
  //                    readable "why".
  //   tool.result    → finished. Success/error + duration.
  //
  // Filter: only the housekeeping set (pace/done/send). Everything
  // else, on every thread, surfaces — that's the user's "who is
  // doing what" requirement.
  useEffect(() => {
    return subscribe((ev) => {
      if (ev.type === "llm.tool_chunk") {
        const name = String(ev.data?.tool || "");
        if ((name === "channels_respond" || name === "channels_send") && isActiveConversationThread(ev.thread_id, chatId)) {
          clearQuietFollowupTurn();
          return;
        }
        if (!name || shouldHideTool(name)) return;
        const id = String(ev.data?.id || `${ev.thread_id}:${name}`);
        setLiveTools((prev) => {
          if (prev.has(id)) return prev; // already tracked, ignore further chunks
          const next = new Map(prev);
          next.set(id, {
            id,
            threadId: ev.thread_id || "main",
            name,
            reason: "",
            state: "streaming",
            startedAt: Date.parse(ev.time) || Date.now(),
          });
          return enforceCap(next);
        });
        return;
      }

      if (ev.type === "tool.call") {
        const name = String(ev.data?.name || "");
        const id = String(ev.data?.id || `${ev.thread_id}:${name}`);
        const reason = String(ev.data?.reason || "");
        if (name && !shouldHideTool(name, reason)) {
          clearQuietFollowupTurn();
        }
        if (!name || shouldHideTool(name, reason)) {
          setLiveTools((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
          return;
        }
        setLiveTools((prev) => {
          const next = new Map(prev);
          const existing = next.get(id);
          next.set(id, {
            id,
            threadId: existing?.threadId || ev.thread_id || "main",
            name,
            reason,
            state: "called",
            startedAt: existing?.startedAt ?? (Date.parse(ev.time) || Date.now()),
          });
          return enforceCap(next);
        });
        return;
      }

      if (ev.type === "tool.result") {
        const name = String(ev.data?.name || ev.data?.tool || "");
        const id = String(ev.data?.id || `${ev.thread_id}:${name}`);
        if (
          (name === "channels_respond" || name === "channels_send") &&
          !ev.data?.is_error &&
          isActiveConversationThread(ev.thread_id, chatId)
        ) {
          armQuietFollowupTurn();
          return;
        }
        if (!name || HIDDEN_TOOLS.has(name)) return;
        const isError = !!ev.data?.is_error;
        const durationMs =
          typeof ev.data?.duration_ms === "number" ? ev.data.duration_ms : undefined;
        setLiveTools((prev) => {
          const next = new Map(prev);
          const existing = next.get(id);
          if (name === "send" && !existing) return prev;
          next.set(id, {
            id,
            threadId: existing?.threadId || ev.thread_id || "main",
            name,
            reason: existing?.reason || "",
            state: "done",
            success: !isError,
            durationMs,
            startedAt: existing?.startedAt ?? (Date.parse(ev.time) || Date.now()),
            doneAt: Date.now(),
          });
          return enforceCap(next);
        });
        return;
      }
    });
  }, [subscribe, chatId, armQuietFollowupTurn, clearQuietFollowupTurn]);

  // Reset tool list when switching chats / instances. Otherwise stale
  // entries from a previous instance briefly leak into the new view.
  useEffect(() => {
    setLiveTools(new Map());
    setExpandedToolGroups(new Set());
    setStreamingText(null);
    clearQuietFollowupTurn();
  }, [instanceId, chatId, clearQuietFollowupTurn]);

  // Subscribe to streaming-frame updates for this chat. Frames carry
  // monotonically growing text; setting state to the latest is enough,
  // no reducer needed. A null payload (chatConnections fires that on
  // real-message-arrival and on SSE drop) clears the bubble.
  useEffect(() => {
    if (!chatId) return;
    return chatConnections.subscribeStream(chatId, (f) => {
      if (f && !f.done) {
        clearQuietFollowupTurn();
        setActivity({ phase: "idle" });
      }
      setStreamingText(f && !f.done ? f.text : null);
    });
  }, [chatId, clearQuietFollowupTurn]);

  // --- 4c. Agent activity strip (Claude/ChatGPT-style "Thinking…") -----
  //
  // Drives a slim status row above the input that says what the agent
  // is doing right now: thinking (LLM call in flight), running a tool,
  // or idle (paced/done). Sources telemetry from the project-wide bus
  // (window.__aptevaTelemetryBus) so it works on every page that
  // mounts a ChatPanel — including the chat-only pages where the
  // legacy `subscribe` prop is a noop. The bus opens ONE SSE per
  // project regardless of how many panels mount; see
  // hooks/useTelemetryBus.ts for the multiplexer.
  // The strip mirrors LLM-in-flight only: visible while the model is
  // generating, gone the moment llm.done fires. Tool execution is
  // already rendered inline in the chat timeline (see ToolRow), so
  // the strip would just duplicate that. This matches the right-rail
  // status indicator's behavior. (The `activity` useState lives up
  // near the auto-scroll effect that depends on `activity.phase`.)

  // Reset activity when switching agents / chats — avoid showing
  // "thinking" carried over from a previous instance's stream.
  useEffect(() => {
    setActivity({ phase: "idle" });
    clearQuietFollowupTurn();
  }, [instanceId, chatId, clearQuietFollowupTurn]);

  // Only the active conversation thread drives the strip. Older chat
  // routing used main; per-chat routing uses a core thread named
  // `chat-${chatId}` so a busy main thread cannot block chat replies.
  useTelemetryEvents(instanceId, (ev) => {
    if (!isActiveConversationThread(ev.thread_id, chatId)) return;
    if (ev.type === "llm.start") {
      if (suppressNextThinkingRef.current) return;
      setActivity({
        phase: "thinking",
        since: Date.parse(ev.time) || Date.now(),
        thread: ev.thread_id || "main",
      });
      return;
    }
    // Any of these mean the LLM is no longer generating: the
    // current call finished (llm.done), the thread terminated
    // (thread.done), or an error stopped the call (llm.error).
    // tool.call/tool.result aren't strip events anymore — those
    // render in the timeline.
    if (
      ev.type === "llm.done" ||
      ev.type === "llm.error" ||
      ev.type === "thread.done"
    ) {
      clearQuietFollowupTurn();
      setActivity({ phase: "idle" });
      return;
    }
  });

  const addImageFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (list.length === 0) return;
    if (attachments.length + list.length > MAX_IMAGE_ATTACHMENTS) {
      setError(t("chat.panel.attachMaxImages", { count: MAX_IMAGE_ATTACHMENTS }));
      return;
    }
    const next: DraftAttachment[] = [];
    for (const file of list) {
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t("chat.panel.imageTooLarge", { name: file.name || t("chat.panel.image") }));
        return;
      }
      const dataUrl = await readFileAsDataURL(file);
      next.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: "image",
        data_url: dataUrl,
        name: file.name || "image",
        mime_type: file.type || "image/png",
        size: file.size,
      });
    }
    setAttachments((current) => [...current, ...next].slice(0, MAX_IMAGE_ATTACHMENTS));
    setError(null);
  }, [attachments.length, t]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((att) => att.id !== id));
  }, []);

  // --- 5. Send handler ---------------------------------------------------
  const handleSend = useCallback(async () => {
    const raw = input.trim();
    if ((!raw && attachments.length === 0) || !chatId || sending || !connected) return;
    // Plan-mode prompt wrap. Pure prompt engineering — the agent reads
    // this as a regular user message and is expected to reply with a
    // plan (no writes) via channels_respond. The Approve button below
    // sends a follow-up "execute now" message that releases the agent.
    const text = planMode
      ? `[Plan mode] Investigate using read-only tools, then reply with a numbered plan to do:\n\n${raw}\n\nDo NOT call write/send/delete/create/update tools yet. I will approve the plan before you execute.`
      : raw;
    setSending(true);
    setError(null);
    try {
      const posted = await chat.post(chatId, text, messageContext, attachments);
      // Render the server-confirmed row immediately. SSE and REST may deliver
      // it again; the id-based merge above makes those echoes harmless.
      mergeDurableMessages([posted]);
      setInput("");
      setAttachments([]);
      // Reset textarea height + restore focus. The textarea no longer
      // disables on `sending` so the browser shouldn't have blurred,
      // but we refocus explicitly here as a defensive measure for
      // anything else (modal autoFocus, scroll-into-view) that might
      // steal focus during the round-trip.
      const el = document.getElementById("chat-input") as HTMLTextAreaElement | null;
      if (el) {
        el.style.height = "auto";
        el.focus();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSending(false);
    }
  }, [input, attachments, chatId, sending, connected, planMode, messageContext, mergeDurableMessages]);

  // postCanned sends a fixed reply on behalf of the user — used by the
  // plan-mode Approve / Reject / Refine quick-action buttons. Same
  // gating as handleSend (chat must be loaded + connected + not
  // mid-send) but bypasses the input box so the user doesn't have to
  // clear it before clicking.
  const postCanned = useCallback(
    async (text: string) => {
      if (!chatId || sending || !connected) return;
      setSending(true);
      setError(null);
      try {
        const posted = await chat.post(chatId, text, messageContext);
        mergeDurableMessages([posted]);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setSending(false);
      }
    },
    [chatId, sending, connected, messageContext, mergeDurableMessages],
  );

  // --- 6. Clear history -------------------------------------------------
  // Wipes the messages DB on the server AND the ephemeral on-screen
  // state: tool-activity strip and any in-progress streaming bubble.
  // Without the latter, Clear visually empties the message list but
  // tool rows + a hanging "thinking" bubble stay pinned above the
  // input, which feels broken.
  const handleClear = async () => {
    setShowClearModal(false);
    if (!chatId) return;
    try {
      await chat.clear(chatId);
      setMessages([]);
      setLiveTools(new Map());
      setStreamingText(null);
      setActivity({ phase: "idle" });
      sinceRef.current = 0;
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a.id - b.id),
    [messages],
  );

  const handleMessageUpdated = useCallback((message: ChatMessageRow) => {
    setMessages((prev) => prev.map((row) => (row.id === message.id ? message : row)));
  }, []);

  // Interleaved timeline of messages + tool bursts.
  //
  // The merge happens at render time only — tools and messages keep
  // their own state shapes throughout. We never copy between them, so
  // there's no double-source-of-truth problem and reordering can't
  // produce duplicates.
  //
  // Ordering rule: timestamp, ascending. Messages use `created_at`
  // (DB-assigned), tools use `startedAt` (telemetry `time` at first-
  // sight, fixed across state transitions). When ts ties, messages
  // win — the user's reply at the same moment as a tool call should
  // visually anchor before the tool, since the tool was triggered by
  // the message.
  //
  // Tool rendering rule: one tool remains one normal line. Two or
  // more tools in the same work burst collapse to a single row with
  // expandable details. Bursts are bounded by chat messages and by a
  // long idle gap, so tight polling/render loops don't flood the
  // transcript while genuinely separate tool phases still split.
  const timeline = useMemo(() => {
    type Item =
      | { kind: "msg"; ts: number; msg: ChatMessageRow }
      | { kind: "tool"; ts: number; tool: LiveTool };
    type TimelineItem =
      | Item
      | { kind: "toolGroup"; ts: number; key: string; tools: LiveTool[] };
    const items: Item[] = [];
    for (const m of orderedMessages) {
      items.push({ kind: "msg", ts: Date.parse(m.created_at) || 0, msg: m });
    }
    for (const t of liveTools.values()) {
      items.push({ kind: "tool", ts: t.startedAt, tool: t });
    }
    items.sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      // Tie-break: messages before tools, then stable-by-id.
      if (a.kind !== b.kind) return a.kind === "msg" ? -1 : 1;
      if (a.kind === "msg" && b.kind === "msg") return a.msg.id - b.msg.id;
      if (a.kind === "tool" && b.kind === "tool") {
        return a.tool.id < b.tool.id ? -1 : 1;
      }
      return 0;
    });
    const grouped: TimelineItem[] = [];
    let pending: LiveTool[] = [];

    const flushTools = () => {
      if (pending.length === 0) return;
      if (pending.length >= TOOL_BURST_MIN) {
        const first = pending[0]!;
        const last = pending[pending.length - 1]!;
        grouped.push({
          kind: "toolGroup",
          ts: first.startedAt,
          key: `${first.id}:${first.startedAt}:${last.id}:${last.startedAt}`,
          tools: pending,
        });
      } else {
        for (const tool of pending) {
          grouped.push({ kind: "tool", ts: tool.startedAt, tool });
        }
      }
      pending = [];
    };

    for (const item of items) {
      if (item.kind === "msg") {
        flushTools();
        grouped.push(item);
        continue;
      }
      const last = pending[pending.length - 1];
      if (last && item.tool.startedAt - last.startedAt > TOOL_BURST_IDLE_GAP_MS) {
        flushTools();
      }
      pending.push(item.tool);
    }
    flushTools();
    return grouped;
  }, [orderedMessages, liveTools]);

  const toggleToolGroup = useCallback((key: string) => {
    setExpandedToolGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const presenceColor = !connected
    ? "bg-text-dim"
    : sseOpen
      ? "bg-green"
      : "bg-yellow animate-pulse";
  const presenceLabel = !connected
    ? t("chat.panel.notConnected")
    : sseOpen
      ? t("chat.panel.connected")
      : t("chat.panel.reconnecting");
  const presenceTitle = !connected
    ? t("chat.panel.notConnectedTitle")
    : sseOpen
      ? t("chat.panel.connectedTitle")
      : t("chat.panel.reconnectingTitle");
  const presenceBadge = (
    <span className="flex items-center gap-1.5 shrink-0" title={presenceTitle}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${presenceColor}`} />
      <span className="text-text-muted text-[10px] uppercase tracking-wide">
        {presenceLabel}
      </span>
    </span>
  );

  return (
    <div className="flex flex-col h-full min-w-0">
      {!hideHeader && (
        <>
          {header ? (
            <>
              <div className="chat-mobile-header-safe md:hidden border-b border-border px-2 flex items-center gap-2 bg-bg/95 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={header.onBack}
                  className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text"
                  aria-label="Back to conversations"
                >
                  <BackIcon />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${header.running ? "bg-green" : "bg-text-dim"}`} />
                    <div className="truncate text-[15px] font-semibold text-text">{header.title}</div>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-text-muted">{header.subtitle || presenceLabel}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMobileActions(true)}
                  className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text"
                  aria-label="Conversation actions"
                >
                  <MoreIcon />
                </button>
              </div>

              <div className="hidden md:flex min-h-14 border-b border-border px-4 py-2 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${header.running ? "bg-green" : "bg-text-dim"}`} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">{header.title}</div>
                    <div className="truncate text-[11px] text-text-muted">{header.subtitle}</div>
                  </div>
                  {presenceBadge}
                  <ChatStatusDot subscribe={subscribe} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPlanMode((v) => !v)}
                    className={`rounded px-2 py-1 text-[10px] uppercase tracking-wide transition-colors ${planMode ? "bg-accent/10 text-accent font-bold" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}
                  >
                    {planMode ? t("chat.panel.planOn") : t("chat.panel.plan")}
                  </button>
                  {chatId && messages.length > 0 && (
                    <button type="button" onClick={() => setShowClearModal(true)} className="rounded px-2 py-1 text-[10px] text-text-muted hover:bg-bg-hover hover:text-red">
                      {t("chat.panel.clear")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConnected((value) => !value)}
                    className={`rounded px-2 py-1 text-[10px] font-bold ${connected ? "text-text-muted hover:bg-bg-hover hover:text-red" : "text-accent hover:bg-accent/10"}`}
                  >
                    {connected ? t("chat.panel.disconnect") : t("chat.panel.connect")}
                  </button>
                  {header.onOpenAgent && (
                    <button type="button" onClick={header.onOpenAgent} className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text">
                      Agent
                    </button>
                  )}
                  {header.onToggleDesktopContext && (
                    <button
                      type="button"
                      onClick={header.onToggleDesktopContext}
                      className="hidden lg:inline-flex rounded border border-border px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text"
                      aria-label={header.desktopContextOpen ? "Hide context" : "Show context"}
                    >
                      {header.desktopContextOpen ? "›" : "‹"}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
          <div className="border-b border-border px-4 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {presenceBadge}
              <ChatStatusDot subscribe={subscribe} />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setPlanMode((v) => !v)}
                title={
                  planMode
                    ? t("chat.panel.planOnTitle")
                    : t("chat.panel.planOffTitle")
                }
                className={`text-[10px] uppercase tracking-wide transition-colors ${
                  planMode ? "text-accent font-bold" : "text-text-muted hover:text-text"
                }`}
              >
                {planMode ? t("chat.panel.planOn") : t("chat.panel.plan")}
              </button>
              {chatId && messages.length > 0 && (
                <button
                  onClick={() => setShowClearModal(true)}
                  title={t("chat.panel.clearTitle")}
                  className="text-[10px] text-text-muted hover:text-red transition-colors"
                >
                  {t("chat.panel.clear")}
                </button>
              )}
              {connected ? (
                <button
                  onClick={() => setConnected(false)}
                  className="text-[10px] text-text-muted hover:text-red transition-colors"
                  title={t("chat.panel.disconnectTitle")}
                >
                  {t("chat.panel.disconnect")}
                </button>
              ) : (
                <button
                  onClick={() => setConnected(true)}
                  className="text-[10px] text-accent hover:text-accent-hover transition-colors font-bold"
                  title={t("chat.panel.connectTitle")}
                >
                  {t("chat.panel.connect")}
                </button>
              )}
            </div>
          </div>
          )}
        </>
      )}

      {header && (
        <Modal open={showMobileActions} onClose={() => setShowMobileActions(false)} width="max-w-md" ariaLabel="Conversation actions">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-accent">Conversation</div>
            <div className="mt-1 truncate text-base font-semibold text-text">{header.title}</div>
            <div className="mt-1 flex items-center gap-2">{presenceBadge}</div>
          </div>
          <div className="page-safe-bottom grid gap-2 p-3">
            {header.onOpenContext && (
              <button type="button" onClick={() => { setShowMobileActions(false); header.onOpenContext?.(); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text hover:bg-bg-hover">
                Agent context
              </button>
            )}
            {header.onOpenAgent && (
              <button type="button" onClick={() => { setShowMobileActions(false); header.onOpenAgent?.(); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text hover:bg-bg-hover">
                Open agent details
              </button>
            )}
            <button type="button" onClick={() => { setPlanMode((value) => !value); setShowMobileActions(false); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text hover:bg-bg-hover">
              {planMode ? "Turn off plan mode" : "Turn on plan mode"}
            </button>
            <button type="button" onClick={() => { setConnected((value) => !value); setShowMobileActions(false); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text hover:bg-bg-hover">
              {connected ? t("chat.panel.disconnect") : t("chat.panel.connect")}
            </button>
            {chatId && messages.length > 0 && (
              <button type="button" onClick={() => { setShowMobileActions(false); setShowClearModal(true); }} className="touch-target rounded-lg border border-red/40 px-4 text-left text-sm text-red hover:bg-red/10">
                {t("chat.panel.clearChat")}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Error banner — dismissible */}
      {error && (
        <div className="shrink-0 border-b border-red/40 bg-red/10 px-4 py-2 flex items-start gap-2">
          <span className="text-red text-[11px] font-bold shrink-0 mt-0.5">{t("chat.panel.error")}</span>
          <pre className="flex-1 min-w-0 text-[10px] text-red leading-snug whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
            {error}
          </pre>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-red/70 hover:text-red text-xs px-1"
            title={t("chat.panel.dismiss")}
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className={`scroll-safe-bottom flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4 space-y-4 min-w-0 transition-opacity duration-300 ${connected ? "" : "opacity-40"}`}
      >
        {!chatId && (
          <p className="text-text-muted text-xs text-center py-8">{t("chat.panel.loading")}</p>
        )}
        {chatId && orderedMessages.length === 0 && (
          <p className="text-text-muted text-xs text-center py-8">
            {t("chat.panel.empty")}
          </p>
        )}
        {timeline.map((item) =>
          item.kind === "msg" ? (
            <MessageRow
              key={`m${item.msg.id}`}
              msg={item.msg}
              projectId={projectId}
              apps={installedApps}
              onMessageUpdated={handleMessageUpdated}
            />
          ) : item.kind === "toolGroup" ? (
            <ToolGroupRow
              key={`tg${item.key}`}
              tools={item.tools}
              expanded={expandedToolGroups.has(item.key)}
              onToggle={() => toggleToolGroup(item.key)}
            />
          ) : (
            <ToolRow key={`t${item.tool.id}`} t={item.tool} />
          ),
        )}
        {streamingText !== null && <StreamingBubble text={streamingText} />}
      </div>

      {/* Activity strip — Claude/ChatGPT-style "Thinking…" line that
          surfaces what the agent is doing right now. Lives between
          messages and the input so it doesn't compete with chat
          content but stays in the user's eyeline as they type. */}
      {activity.phase !== "idle" && (
        <ActivityStrip activity={activity} />
      )}

      {/* Plan-mode quick actions. Only shown when plan mode is on AND
          the most recent message is from the agent (i.e. there's a
          plan on screen worth approving). Buttons send canned text
          via postCanned; for nuanced feedback the user can also just
          type a reply in the input below. */}
      {planMode && connected && orderedMessages.length > 0 &&
        orderedMessages[orderedMessages.length - 1]!.role === "agent" && (
          <div className="shrink-0 px-3 pt-2 grid grid-cols-3 gap-2 sm:flex sm:items-center sm:flex-wrap">
            <span className="col-span-3 text-[10px] uppercase tracking-wide text-text-muted sm:col-auto">
              Plan
            </span>
            <button
              onClick={() => postCanned("Approved. Execute the plan now.")}
              disabled={sending}
              className="touch-target text-[11px] px-2 py-1 rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
              title={t("chat.panel.approveTitle")}
            >
              {t("chat.panel.approve")}
            </button>
            <button
              onClick={() =>
                postCanned("Rejected. Don't execute that plan — try a different approach.")
              }
              disabled={sending}
              className="touch-target text-[11px] px-2 py-1 rounded border border-border text-text-muted hover:border-red hover:text-red disabled:opacity-40 transition-colors"
              title={t("chat.panel.rejectTitle")}
            >
              {t("chat.panel.reject")}
            </button>
            <button
              onClick={() =>
                postCanned("Refine the plan. Keep the overall approach but address the points I'll list next.")
              }
              disabled={sending}
              className="touch-target text-[11px] px-2 py-1 rounded border border-border text-text-muted hover:border-text hover:text-text disabled:opacity-40 transition-colors"
              title={t("chat.panel.refineTitle")}
            >
              {t("chat.panel.refine")}
            </button>
            <span className="hidden text-[10px] text-text-dim ml-1 sm:inline">
              {t("chat.panel.typeReply")}
            </span>
          </div>
        )}

      {/* Input */}
      <div className="chat-composer-safe shrink-0 px-2 pt-2 sm:px-5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              void addImageFiles(e.target.files);
            }
            e.currentTarget.value = "";
          }}
        />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-bg-subtle"
                title={`${att.name} (${formatBytes(att.size)})`}
              >
                <img
                  src={att.data_url}
                  alt={att.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="absolute right-1 top-1 h-5 w-5 rounded-full bg-bg/90 text-[11px] text-text border border-border hover:border-text"
                  aria-label={t("chat.panel.removeAttachment", { name: att.name })}
                  title={t("chat.panel.removeImage")}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.items || []).some((item) => item.type.startsWith("image/"))) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            if (Array.from(e.dataTransfer.files || []).some((file) => file.type.startsWith("image/"))) {
              e.preventDefault();
              void addImageFiles(e.dataTransfer.files);
            }
          }}
          className="flex min-h-[54px] items-center gap-1.5 rounded-2xl border border-border bg-bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur-sm transition-colors focus-within:border-accent/60 sm:min-h-[58px] sm:gap-3 sm:px-4 sm:py-2"
        >
          <span className="hidden sm:inline font-bold text-sm text-accent shrink-0 self-center">&gt;</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!chatId || !connected || sending || attachments.length >= MAX_IMAGE_ATTACHMENTS}
            className="touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-bg-subtle hover:text-text disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8"
            aria-label={t("chat.panel.attachImage")}
            title={t("chat.panel.attachImage")}
          >
            <svg
              viewBox="0 0 20 20"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 11.5l3-3 3 3 1.5-1.5L16 13.5" />
              <rect x="3" y="4" width="14" height="12" rx="2" />
              <circle cx="13.5" cy="7.5" r="1" />
            </svg>
          </button>
          <textarea
            id="chat-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 144) + "px";
            }}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter newline. Same convention as
              // the chat UIs the product is compared against.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files || []).filter((file) => file.type.startsWith("image/"));
              if (files.length > 0) {
                e.preventDefault();
                void addImageFiles(files);
              }
            }}
            rows={1}
            style={{ lineHeight: "20px", minHeight: "36px" }}
            className="block min-w-0 flex-1 resize-none bg-transparent py-2 font-mono text-base text-text placeholder:text-text-dim focus:outline-none sm:text-sm"
            placeholder={
              !chatId
                ? t("chat.panel.placeholderLoading")
                : !connected
                  ? t("chat.panel.placeholderDisconnected")
                  : t("chat.panel.placeholderMessage")
            }
            disabled={!chatId || !connected}
            autoFocus={!!chatId && typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches}
          />
          <button
            type="submit"
            disabled={!chatId || (!input.trim() && attachments.length === 0) || sending || !connected}
            className="touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-bg transition-all disabled:cursor-not-allowed disabled:opacity-20 enabled:hover:bg-accent-hover enabled:active:scale-95 sm:h-9 sm:w-9"
            aria-label={t("chat.panel.send")}
            title={t("chat.panel.sendTitle")}
          >
            <svg
              viewBox="0 0 20 20"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 17V3" />
              <path d="M5 8l5-5 5 5" />
            </svg>
          </button>
        </form>
      </div>

      {/* Clear confirmation modal */}
      <Modal open={showClearModal} onClose={() => setShowClearModal(false)} width="max-w-sm" ariaLabel={t("chat.panel.clearChat")}>
            <div className="page-safe-bottom px-4 py-4 sm:px-5 space-y-3">
              <h3 className="text-text text-sm font-bold">{t("chat.panel.clearChat")}</h3>
              <p className="text-text-muted text-xs leading-relaxed">
                {t("chat.panel.clearWarning")}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => setShowClearModal(false)}
                  className="touch-target px-3 py-1.5 text-xs text-text-muted border border-border rounded-lg hover:border-text-muted transition-colors"
                >
                  {t("chat.panel.cancel")}
                </button>
                <button
                  onClick={handleClear}
                  className="touch-target px-3 py-1.5 text-xs text-bg bg-red hover:bg-red/80 rounded-lg font-bold transition-colors"
                >
                  {t("chat.panel.clearMessages")}
                </button>
              </div>
            </div>
      </Modal>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

// MessageRow renders one chat_messages row. Role determines layout:
//   user   — right-aligned bubble with accent tint
//   agent  — full-width markdown (Claude.ai / ChatGPT style)
//   system — centered status line, softer color
//
// projectId + apps are injected by the parent so any ChatComponents
// attached to the message can scope themselves and resolve to the
// right sidecar bundle.
//
// Wrapped in React.memo because the parent re-renders on every tool
// event (timeline merges messages + liveTools), and re-running marked
// on every agent message every time was eating real CPU on long
// chats. Memo's default shallow comparison is the right fit here:
//   - msg row is referentially stable per id (rows come from setState
//     of an array, never mutated in place).
//   - projectId is the stable currentProject?.id ?? "" string.
//   - apps is the state value of useInstalledApps's useState, so its
//     reference only changes when the install list actually changes.
// Result: timeline-only updates (a tool event arriving) skip every
// MessageRow's re-render entirely.
const MessageRow = memo(function MessageRow({
  msg,
  projectId,
  apps,
  onMessageUpdated,
}: {
  msg: ChatMessageRow;
  projectId: string;
  apps: ReturnType<typeof useInstalledApps>;
  onMessageUpdated?: (message: ChatMessageRow) => void;
}) {
  // Memoize the parsed HTML against the message content so the
  // marked() call doesn't run on a re-render that survived the memo
  // (e.g. apps array reference changed but msg.content didn't).
  // The role check matches the original fall-through: user + system
  // get bespoke layouts above; everything else (agent and any future
  // role) renders as markdown.
  const isMarkdown = msg.role !== "user" && msg.role !== "system";
  const html = useMemo(
    () => (isMarkdown ? renderSafeMarkdown(msg.content) : ""),
    [msg.content, isMarkdown],
  );

  if (msg.role === "user") {
    const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
    if (!hasAttachments) {
      return (
        <div className="flex justify-end min-w-0">
          <div className="bg-accent/15 border border-accent/30 rounded-xl rounded-br-sm px-3 py-2 max-w-[92%] sm:max-w-[80%] min-w-0">
            <p className="text-text text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-end min-w-0">
        <div className="max-w-[92%] sm:max-w-[82%] min-w-0 flex flex-col items-end gap-2">
          <UserAttachmentGrid attachments={msg.attachments || []} />
          {msg.content && (
            <div className="bg-accent/15 border border-accent/30 rounded-xl rounded-br-sm px-3 py-1.5 max-w-full min-w-0">
              <p className="text-text text-[15px] sm:text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (msg.role === "system") {
    return (
      <div className="text-center text-[10px] text-text-muted py-1 break-words">
        ℹ {msg.content}
      </div>
    );
  }
  // Agent — markdown + optional rich attachments.
  return (
    <div className="min-w-0">
      <div
        className="chat-md text-text text-[15px] sm:text-sm break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {msg.components && msg.components.length > 0 && (
        <ChatComponentList
          components={msg.components}
          apps={apps}
          projectId={projectId}
          messageId={msg.id}
          onMessageUpdated={onMessageUpdated}
        />
      )}
    </div>
  );
});

function UserAttachmentGrid({ attachments }: { attachments: ChatAttachment[] }) {
  const { t } = useTranslation();
  const visible = attachments.filter((att) => att.data_url || att.name);
  if (visible.length === 0) return null;
  const single = visible.length === 1;
  return (
    <div
      className={
        single
          ? "w-full max-w-[460px]"
          : "grid grid-cols-2 gap-2 w-full max-w-[460px]"
      }
    >
      {visible.map((att, index) => {
        const key = att.id || `${att.name || "image"}-${index}`;
        const title = `${att.name || t("chat.panel.image")} (${formatBytes(att.size)})`;
        if (!att.data_url) {
          return (
            <div
              key={key}
              className="rounded-xl border border-border bg-bg-card px-3 py-2 text-[11px] text-text-muted"
              title={title}
            >
              {att.name || t("chat.panel.image")}
            </div>
          );
        }
        return (
          <img
            key={key}
            src={att.data_url}
            alt={att.name || t("chat.panel.attachedImage")}
            title={title}
            className={
              single
                ? "block max-h-[420px] w-full rounded-2xl border border-border/60 object-contain bg-black/20"
                : "block aspect-square w-full rounded-xl border border-border/60 object-cover bg-black/20"
            }
          />
        );
      })}
    </div>
  );
}

// StreamingBubble — ephemeral agent-style bubble pinned to the bottom
// of the timeline while the LLM is composing a respond() call. The
// text grows as new server frames arrive. Replaced (not transitioned)
// by the real DB message once the tool actually runs — chatConnections
// fires a null stream payload at that moment, which clears the bubble
// in the same React commit as MessageRow renders the final row.
//
// Markdown: we parse and sanitize every chunk via the same helper used
// by final messages, so lists/code/bold render live. Unterminated
// tokens (a `**bold` mid-stream) get auto-closed by closeOpenMarkdown
// before parse — keeps marked from emitting literal asterisks one
// chunk and bold the next. Memoized against text so unrelated
// re-renders (e.g. other state changes in ChatPanel) don't re-parse.
function StreamingBubble({ text }: { text: string }) {
  const html = useMemo(
    () => renderSafeMarkdown(closeOpenMarkdown(text)),
    [text],
  );
  return (
    <div className="min-w-0">
      <div
        className="chat-md text-text text-[15px] sm:text-sm break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// closeOpenMarkdown closes the last unterminated bold/italic/inline-
// code/fenced-code/link tokens in a string so a partial mid-stream
// render doesn't flicker as the closing pair arrives. Doesn't try to
// be a full parser — just the four token types that produce the
// worst visual flashes when half-written.
function closeOpenMarkdown(s: string): string {
  // Fenced code (```): odd count → append a closing fence on its own line.
  const fence = (s.match(/```/g) || []).length;
  let out = s;
  if (fence % 2 === 1) out += "\n```";
  // Inside a fence? Skip the inline rules — they're literal in code blocks.
  if (fence % 2 === 1) return out;
  // Inline code (`): odd count of single backticks not part of a fence.
  // Strip the fences first so we don't miscount.
  const noFences = out.replace(/```[\s\S]*?```/g, "");
  const ticks = (noFences.match(/`/g) || []).length;
  if (ticks % 2 === 1) out += "`";
  // Bold (**): odd count of `**`.
  const bold = (out.match(/\*\*/g) || []).length;
  if (bold % 2 === 1) out += "**";
  // Unclosed link: `[text](url` without the closing paren.
  if (/\[[^\]]*\]\([^)]*$/.test(out)) out += ")";
  return out;
}

// ToolRow — inline tool indicator rendered between messages in the
// chat timeline. Visually subdued (smaller, dimmer, indented) so it
// reads as background activity, not as a primary turn. Layout:
//
//   ⟳ agent's reason                                         (1.2s)
function toolDisplayName(name: string): string {
  const parts = name.split(/[_:.-]+/).filter(Boolean);
  if (parts.length > 1 && parts[0] === parts[1]) parts.shift();
  return parts.join(" ") || name;
}

function toolLabel(tool: LiveTool, t: (key: string, options?: Record<string, unknown>) => string): string {
  return tool.reason || (tool.state === "streaming" ? t("chat.panel.preparingTool", { name: toolDisplayName(tool.name) }) : t("chat.panel.working"));
}

function toolDurationLabel(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function plural(n: number, singular: string, pluralValue = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralValue}`;
}

function compactLabels(tools: LiveTool[], limit: number, t: (key: string, options?: Record<string, unknown>) => string): { text: string; more: number } {
  const labels: string[] = [];
  for (const tool of tools) {
    const label = toolLabel(tool, t);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return { text: labels.join(", "), more: Math.max(0, tools.length - labels.length) };
}

interface ToolDetailSummary {
  key: string;
  label: string;
  count: number;
  state: LiveTool["state"];
  success?: boolean;
  durationMs: number;
}

function summarizeToolDetails(tools: LiveTool[], t: (key: string, options?: Record<string, unknown>) => string): ToolDetailSummary[] {
  const summaries = new Map<string, ToolDetailSummary>();
  for (const tool of tools) {
    const label = toolLabel(tool, t) || tool.name;
    const stateKey =
      tool.state === "done"
        ? tool.success === false
          ? "failed"
          : "done"
        : tool.state;
    const key = `${label}:${stateKey}`;
    const existing = summaries.get(key);
    if (existing) {
      existing.count += 1;
      existing.durationMs += tool.durationMs || 0;
      continue;
    }
    summaries.set(key, {
      key,
      label,
      count: 1,
      state: tool.state,
      success: tool.success,
      durationMs: tool.durationMs || 0,
    });
  }
  return [...summaries.values()];
}

function ToolGroupRow({
  tools,
  expanded,
  onToggle,
}: {
  tools: LiveTool[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const active = tools.filter((t) => t.state !== "done");
  const failed = tools.filter((t) => t.state === "done" && t.success === false);
  const completed = tools.filter((t) => t.state === "done");
  const durationTotal = completed.reduce((sum, t) => sum + (t.durationMs || 0), 0);
  const labelSource = failed.length > 0 ? [...failed, ...tools.filter((t) => !failed.includes(t))] : active.length > 0 ? [...active, ...tools.filter((t) => !active.includes(t))] : tools;
  const labels = compactLabels(labelSource, 2, t);
  const detailSummaries = summarizeToolDetails(tools, t);
  const icon =
    failed.length > 0
      ? <span className="text-red shrink-0">✗</span>
      : active.length > 0
      ? <span className="text-accent shrink-0 animate-spin">⟳</span>
      : <span className="text-green shrink-0">✓</span>;
  const status =
    failed.length > 0
      ? t(failed.length === 1 ? "chat.panel.toolFailedStatus" : "chat.panel.toolsFailedStatus", { count: failed.length })
      : active.length > 0
      ? t(active.length === 1 ? "chat.panel.toolRunningStatus" : "chat.panel.toolsRunningStatus", { count: active.length })
      : t(tools.length === 1 ? "chat.panel.toolCompletedStatus" : "chat.panel.toolsCompletedStatus", { count: tools.length });
  const detailParts = [
    durationTotal > 0 && active.length === 0 ? toolDurationLabel(durationTotal) : "",
    labels.text,
    labels.more > 0 ? `+${labels.more}` : "",
  ].filter(Boolean);

  return (
    <div className="min-w-0 pl-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex max-w-full items-center gap-1.5 text-[10px] text-text-dim hover:text-text-muted leading-tight"
        title={expanded ? t("chat.panel.hideToolCalls") : t("chat.panel.showToolCalls")}
      >
        {icon}
        <span className={failed.length > 0 ? "text-red shrink-0" : "shrink-0"}>{status}</span>
        {detailParts.length > 0 && <span className="shrink-0">·</span>}
        {detailParts.length > 0 && (
          <span className="truncate text-left">
            {detailParts.join(" · ")}
          </span>
        )}
        <span className="shrink-0 text-text-dim opacity-70">{expanded ? t("chat.panel.hide") : t("chat.panel.details")}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 border-l border-border/70 pl-2">
          {detailSummaries.map((summary) => (
            <ToolSummaryRow key={summary.key} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolSummaryRow({ summary }: { summary: ToolDetailSummary }) {
  const { t } = useTranslation();
  const icon =
    summary.state === "streaming"
      ? <span className="text-yellow shrink-0 animate-pulse">◐</span>
      : summary.state === "called"
      ? <span className="text-accent shrink-0 animate-spin">⟳</span>
      : <span className={`shrink-0 ${summary.success ? "text-green" : "text-red"}`}>{summary.success ? "✓" : "✗"}</span>;
  const dur = summary.durationMs > 0 ? toolDurationLabel(summary.durationMs) : "";
  return (
    <div className="flex items-center gap-1.5 min-w-0 leading-tight text-[10px] text-text-dim">
      {icon}
      <span className={summary.state === "streaming" ? "truncate italic" : "truncate"} title={summary.label}>
        {summary.label}
      </span>
      {summary.count > 1 && <span className="shrink-0">x{summary.count}</span>}
      {dur && <span className="shrink-0">({dur})</span>}
      {summary.state === "done" && summary.success === false && (
        <span className="shrink-0 text-red">{t("chat.panel.toolFailed")}</span>
      )}
    </div>
  );
}

function ToolRow({ t: tool, compact = false }: { t: LiveTool; compact?: boolean }) {
  const { t } = useTranslation();
  const icon =
    tool.state === "streaming"
      ? <span className="text-yellow shrink-0 animate-pulse">◐</span>
      : tool.state === "called"
      ? <span className="text-accent shrink-0 animate-spin">⟳</span>
      : <span className={`shrink-0 ${tool.success ? "text-green" : "text-red"}`}>{tool.success ? "✓" : "✗"}</span>;
  const label = toolLabel(tool, t);
  const dur =
    tool.state === "done" && tool.durationMs != null
      ? toolDurationLabel(tool.durationMs)
      : "";

  return (
    <div className={`flex items-center gap-1.5 min-w-0 leading-tight text-[10px] text-text-dim ${compact ? "" : "pl-3"}`}>
      {icon}
      <span
        className={tool.state === "streaming" ? "truncate italic" : "truncate"}
        title={label}
      >
        {label}
      </span>
      {dur && <span className="shrink-0">({dur})</span>}
      {tool.state === "done" && tool.success === false && (
        <span className="shrink-0 text-red">{t("chat.panel.toolFailed")}</span>
      )}
    </div>
  );
}

// ActivityStrip — slim status row above the chat input. Visible iff
// the LLM is currently generating; mirrors the right-rail status
// indicator's behavior. Tool execution is rendered inline in the
// timeline, so the strip stays focused on a single signal: "is the
// model thinking right now?". Duration counter updates every 500ms.
type ActivityForStrip = { phase: "thinking"; since: number; thread: string };

function isActiveConversationThread(threadId: string, chatId: string | null): boolean {
  const normalized = threadId || "main";
  if (normalized === "main") return true;
  if (!chatId) return false;
  return normalized === chatId || normalized === `chat-${chatId}`;
}

function ActivityStrip({ activity }: { activity: ActivityForStrip }) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const elapsedMs = Date.now() - activity.since;
  void tick; // referenced to silence lint; the tick value isn't used directly
  const elapsedLabel =
    elapsedMs >= 1000
      ? `${(elapsedMs / 1000).toFixed(1)}s`
      : `${elapsedMs}ms`;

  return (
    <div className="shrink-0 px-4 pt-2 pb-2 flex items-center gap-2 text-[11px] text-text-muted bg-bg-card/40">
      <span className="flex items-center gap-1 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse [animation-delay:200ms]" />
      </span>
      <span className="text-text shrink-0">{t("chat.panel.thinking")}</span>
      <span className="flex-1" />
      <span className="shrink-0 text-text-dim tabular-nums">{elapsedLabel}</span>
    </div>
  );
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
