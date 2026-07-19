import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { chat, telemetry, type ChatAttachment, type ChatMessageContext, type ChatMessageRow, type RealtimeAvailability, type TelemetryEvent } from "../api";
import { useProjects } from "../hooks/useProjects";
import {
  ChatComponentList,
  useInstalledApps,
} from "./apps/chatComponents";
import { ChatStatusDot } from "./ChatStatusDot";
import { markChatSeen, focusChat } from "../state/chatNotifications";
import { chatConnections, type StreamFrame } from "../state/chatConnections";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";
import type { SubscribeFn } from "./AgentView";
import { renderSafeMarkdown } from "../utils/safeMarkdown";
import { mergeChatMessages } from "../utils/chatMessages";
import { Modal } from "./Modal";
import { ChatToolActivity } from "./chat/ToolActivity";
import {
  buildChatTimeline,
  chatConversationThreadId,
  isChatConversationTelemetry,
  mergeToolActivityEvents,
  shouldHideChatTool,
  type ToolActivity,
} from "./chat/toolActivityModel";
import { splitToolTelemetryPaintFrame } from "../utils/toolTelemetryPaint";
import { useToolVisualRegistry } from "./chat/toolVisuals";
import {
  clearThinkingForIteration,
  clearThinkingThroughGeneration,
  isChatUserTurnEvent,
  nextChatTurnStartKind,
  shouldShowChatThinking,
  terminalToolEndsChatTurn,
  telemetryIteration,
  toolEventReplacesThinking,
  type ChatTurnStartKind,
  type ChatThinkingPlaceholder,
} from "../utils/chatThinkingLifecycle";
import { MicrophoneIcon, useRealtimeVoice } from "../state/RealtimeVoiceContext";

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

export interface ChatQueuedMessage {
  id: string;
  content: string;
  attachments?: ChatAttachment[];
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
  conversationId?: string;
  // Telemetry subscribe — used ONLY for the status dot. Chat messages
  // come from the channel-chat app's SSE stream, not telemetry.
  subscribe: SubscribeFn;
  autoConnect?: boolean;
  hideHeader?: boolean;
  header?: ChatPanelHeader;
  messageContext?: ChatMessageContext;
  historyLimit?: number;
  realtime?: RealtimeAvailability;
  agentName?: string;
  agentNames?: Record<number, string>;
  participantIds?: number[];
  queuedMessage?: ChatQueuedMessage;
  onQueuedMessageHandled?: (id: string) => void;
}

const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface DraftAttachment extends ChatAttachment {
  id: string;
  data_url: string;
  name: string;
  mime_type: string;
  size: number;
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
  conversationId,
  subscribe,
  autoConnect = false,
  hideHeader = false,
  header,
  messageContext,
  historyLimit,
  realtime,
  agentName = "Agent",
  agentNames = {},
  participantIds,
  queuedMessage,
  onQueuedMessageHandled,
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
  const toolVisualRegistry = useToolVisualRegistry(projectId || null, installedApps);
  const telemetryAgentKey = (participantIds?.length ? participantIds : [instanceId]).join(",");
  const telemetryAgentIds = useMemo(
    () => telemetryAgentKey.split(",").map(Number).filter((id) => Number.isFinite(id)),
    [telemetryAgentKey],
  );
  const voice = useRealtimeVoice();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const activeVoiceHere = voice.session?.agentId === instanceId ? voice.session : null;
  const completedVoiceHere = voice.lastSession?.agentId === instanceId ? voice.lastSession : null;

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

  // Ephemeral tool activity. It never enters `messages`; the two sources
  // only meet when the timeline is derived for rendering.
  const [liveTools, setLiveTools] = useState<Map<string, ToolActivity>>(() => new Map());
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(() => new Set());
  const toolHistoryKeyRef = useRef("");
  const pendingToolEventsRef = useRef<TelemetryEvent[]>([]);
  const pendingToolReplacementGenerationRef = useRef<number | null>(null);
  const toolAnimationFrameRef = useRef<number | null>(null);

  // Ephemeral streaming bubble — the LLM-args text for an in-progress
  // `channels_send` tool call, surfaced as the user's reply arrives
  // character-by-character. Cleared on the next real agent message,
  // on SSE drop, or on chat switch. Sourced from chatConnections's
  // subscribeStream — server flag CHANNELCHAT_STREAMING=0 stops the
  // frames at the source, so this state simply stays null end-to-end.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const pendingStreamFrameRef = useRef<StreamFrame | null>(null);
  const streamAnimationFrameRef = useRef<number | null>(null);
  const [thinkingPlaceholder, setThinkingPlaceholder] = useState<ChatThinkingPlaceholder | null>(null);
  const [startingResponse, setStartingResponse] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const thinkingGenerationRef = useRef(0);
  const awaitingChatResponseRef = useRef(false);
  const acceptedChatTurnRef = useRef(false);
  const afterAgentReplyRef = useRef(false);
  const activeChatTurnKeyRef = useRef("");
  const awaitingChatResponseTimerRef = useRef<number | null>(null);
  const queuedMessageInFlightRef = useRef("");

  const markAwaitingChatResponse = useCallback((
    turnKey: string,
    requestedStartKind: ChatTurnStartKind = "response",
  ) => {
    const startKind = nextChatTurnStartKind(
      activeChatTurnKeyRef.current,
      turnKey,
      requestedStartKind,
    );
    if (!startKind) return;
    activeChatTurnKeyRef.current = turnKey;
    acceptedChatTurnRef.current = false;
    afterAgentReplyRef.current = false;
    setStartingResponse(true);
    setStartingConversation(startKind === "conversation");
    awaitingChatResponseRef.current = true;
    if (awaitingChatResponseTimerRef.current !== null) {
      window.clearTimeout(awaitingChatResponseTimerRef.current);
    }
    awaitingChatResponseTimerRef.current = window.setTimeout(() => {
      awaitingChatResponseRef.current = false;
      acceptedChatTurnRef.current = false;
      afterAgentReplyRef.current = false;
      awaitingChatResponseTimerRef.current = null;
      setStartingResponse(false);
      setStartingConversation(false);
      setThinkingPlaceholder(null);
    }, 5 * 60_000);
  }, []);

  const clearAwaitingChatResponse = useCallback(() => {
    awaitingChatResponseRef.current = false;
    acceptedChatTurnRef.current = false;
    afterAgentReplyRef.current = false;
    setStartingResponse(false);
    setStartingConversation(false);
    if (awaitingChatResponseTimerRef.current !== null) {
      window.clearTimeout(awaitingChatResponseTimerRef.current);
      awaitingChatResponseTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearAwaitingChatResponse(), [clearAwaitingChatResponse]);

  // Explicit connect/disconnect, scoped to this browser tab.
  //
  // Why explicit at all? The agent is proactive — when chat is
  // "connected" it may greet, ping, push a status update unprompted.
  // We want the user to own that "I'm available to be poked" signal,
  // not have it toggle silently as browser tabs open and close.
  //
  // The manager owns intent across component remounts and refreshes via
  // sessionStorage. Unlike the old localStorage design this state disappears
  // with the tab, and the manager keeps only one per-chat SSE active.
  const [connected, setConnected] = useState<boolean>(() =>
    conversationId
      ? chatConnections.shouldConnect(conversationId, autoConnect)
      : autoConnect,
  );

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
    const latestTurn = rows.reduce<ChatMessageRow | null>((latest, row) => {
      if (row.role !== "user" && row.role !== "agent") return latest;
      return !latest || row.id > latest.id ? row : latest;
    }, null);
    // User rows can also arrive from another UI over conversation SSE. Arm
    // the same real llm.start lifecycle; do not manufacture a placeholder.
    if (latestTurn?.role === "user") {
      markAwaitingChatResponse(
        latestTurn.client_message_id || `message:${latestTurn.id}`,
      );
    }
    if (rows.some((row) => row.role === "agent")) {
      // The manager performs this swap atomically for normal SSE delivery.
      // Repeating it here covers REST reconciliation after a dropped frame:
      // persisted content replaces the ephemeral bubble, never leaving both.
      pendingStreamFrameRef.current = null;
      if (streamAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(streamAnimationFrameRef.current);
        streamAnimationFrameRef.current = null;
      }
      setStreamingText(null);
      setThinkingPlaceholder(null);
      setStartingResponse(false);
      if (awaitingChatResponseRef.current) afterAgentReplyRef.current = true;
    }
    if (
      maxId > 0 &&
      chatId &&
      (typeof document === "undefined" || document.visibilityState === "visible")
    ) {
      markChatSeen(chatId, maxId);
    }
  }, [chatId, markAwaitingChatResponse]);

  // --- 1. Resolve the chat for this instance -----------------------------
  useEffect(() => {
    setChatId(null);
    setMessages([]);
    setThinkingPlaceholder(null);
    activeChatTurnKeyRef.current = "";
    clearAwaitingChatResponse();
    setHistoryReady(false);
    setError(null);
    sinceRef.current = 0;

    let cancelled = false;
    if (conversationId) {
      setChatId(conversationId);
      return () => { cancelled = true; };
    }

    chat.listChats(instanceId)
      .then((chats) => {
        if (cancelled) return;
        if (chats.length > 0) {
          setChatId(chats[0].id);
        } else {
          // Merely mounting a chat surface must not create a conversation.
          // Conversation creation belongs to explicit Start/New/Chat actions.
          setChatId(null);
        }
      })
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => { cancelled = true; };
  }, [conversationId, instanceId, clearAwaitingChatResponse]);

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
  // chatConnections singleton owns one EventSource per connected chat.
  // Connection lifetime belongs to the tab-level manager, not this component.
  // Navigation/remount therefore cannot emit a false disconnect. The manager
  // moves its one active chat stream when another conversation is selected.
  //
  // Three things to wire:
  //   1. active conversation / connect toggle → manager.connect/disconnect.
  //   2. Live messages → subscribeMessages, which replays buffered
  //      messages with id > sinceRef so a panel mount that comes
  //      after some messages already arrived doesn't miss them.
  //   3. SSE open state → subscribeState for the presence dot.
  useEffect(() => {
    if (!chatId) return;
    const shouldConnect = chatConnections.shouldConnect(chatId, autoConnect);
    setConnected(shouldConnect);
    if (shouldConnect) {
      chatConnections.connect(chatId, instanceId);
    }
  }, [autoConnect, chatId, instanceId]);

  useEffect(() => {
    if (!chatId) return;
    setSseOpen(chatConnections.isOpen(chatId));
    return chatConnections.subscribeState(chatId, () => {
      setConnected(chatConnections.isConnected(chatId));
      setSseOpen(chatConnections.isOpen(chatId));
    });
  }, [chatId]);

  const toggleConnection = useCallback(() => {
    if (!chatId) return;
    if (chatConnections.isConnected(chatId)) {
      chatConnections.disconnect(chatId, instanceId);
      setConnected(false);
      return;
    }
    chatConnections.connect(chatId, instanceId);
    setConnected(true);
  }, [chatId, instanceId]);

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
  // Track the user's intent in a ref so scroll events don't re-render the
  // entire transcript. Explicit sends still schedule one follow operation,
  // while transcript replacements pin the bottom in a layout effect. The
  // latter runs before paint, so swapping Thinking for a tool/message cannot
  // expose one frame at the old scroll position.
  const atBottomRef = useRef(true);
  const followBottomAnimationFrameRef = useRef<number | null>(null);
  const scheduleFollowBottom = useCallback(() => {
    if (!atBottomRef.current || followBottomAnimationFrameRef.current !== null) return;
    followBottomAnimationFrameRef.current = window.requestAnimationFrame(() => {
      followBottomAnimationFrameRef.current = null;
      if (!atBottomRef.current) return;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = true;
    const onScroll = () => {
      const dist = el.scrollHeight - el.clientHeight - el.scrollTop;
      atBottomRef.current = dist < 60;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [chatId]);

  useLayoutEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, liveTools, streamingText, thinkingPlaceholder, startingResponse]);

  useEffect(() => () => {
    if (followBottomAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(followBottomAnimationFrameRef.current);
      followBottomAnimationFrameRef.current = null;
    }
  }, []);

  // --- 4b. Live tool activity (interleaved into the timeline) -----------
  //
  // Subscribe through the project telemetry bus and track tools emitted by
  // this conversation's participant agents on this conversation's exact
  // runtime thread. The timeline render below sorts
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
  // Filter: internal housekeeping (pace/done/send) stays hidden. Other tools
  // surface only when both the participant agent and selected thread match.
  const flushToolEventFrame = useCallback(function flushToolEventFrame() {
    toolAnimationFrameRef.current = null;
    const { paint, deferred } = splitToolTelemetryPaintFrame(pendingToolEventsRef.current);
    pendingToolEventsRef.current = deferred;
    const replaceThroughGeneration = pendingToolReplacementGenerationRef.current;
    pendingToolReplacementGenerationRef.current = null;
    if (paint.length > 0) {
      if (replaceThroughGeneration !== null) {
        setThinkingPlaceholder((current) =>
          clearThinkingThroughGeneration(current, replaceThroughGeneration),
        );
      }
      setLiveTools((previous) => mergeToolActivityEvents(previous, paint));
    }
    if (pendingToolEventsRef.current.length > 0) {
      toolAnimationFrameRef.current = window.requestAnimationFrame(flushToolEventFrame);
    }
  }, []);

  const queueToolEvent = useCallback((event: TelemetryEvent, replacesThinking: boolean) => {
    pendingToolEventsRef.current.push(event);
    if (replacesThinking) {
      const generation = thinkingGenerationRef.current;
      pendingToolReplacementGenerationRef.current = Math.max(
        pendingToolReplacementGenerationRef.current ?? generation,
        generation,
      );
    }
    if (toolAnimationFrameRef.current !== null) return;
    toolAnimationFrameRef.current = window.requestAnimationFrame(flushToolEventFrame);
  }, [flushToolEventFrame]);

  const cancelPendingToolEvents = useCallback(() => {
    pendingToolEventsRef.current = [];
    pendingToolReplacementGenerationRef.current = null;
    if (toolAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(toolAnimationFrameRef.current);
      toolAnimationFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingToolEvents, [cancelPendingToolEvents]);

  useTelemetryEvents(telemetryAgentIds.length > 1 ? null : instanceId, (ev) => {
    const activeConversation = isChatConversationTelemetry(ev, chatId, telemetryAgentIds);
    if (!activeConversation) return;
    if (ev.type === "event.received") {
      if (awaitingChatResponseRef.current && isChatUserTurnEvent(ev.data)) {
        acceptedChatTurnRef.current = true;
      }
      return;
    }
    if (activeConversation && ev.type === "llm.start") {
      const generation = ++thinkingGenerationRef.current;
      // Telemetry is project-wide and may replay an already-running main
      // iteration when this panel mounts. Only surface a placeholder for a
      // response explicitly initiated from this mounted chat.
      // A new conversation worker can run once before it receives the queued
      // dashboard event. Do not render that bootstrap work as the user's
      // response; event.received below accepts the turn before its real
      // llm.start arrives.
      if (!shouldShowChatThinking(
        awaitingChatResponseRef.current,
        acceptedChatTurnRef.current,
        afterAgentReplyRef.current,
      )) return;
      if (streamingText === null) {
        setStartingResponse(false);
        setThinkingPlaceholder((current) => ({
          since: current?.since ?? (Date.parse(ev.time) || Date.now()),
          threadId: ev.thread_id || "main",
          generation,
          iteration: telemetryIteration(ev.data),
        }));
      }
      return;
    }
    if (activeConversation && ev.type === "llm.done") {
      setThinkingPlaceholder((current) =>
        clearThinkingForIteration(current, telemetryIteration(ev.data)),
      );
      return;
    }
    if (activeConversation && (ev.type === "llm.error" || ev.type === "llm.err" || ev.type === "thread.done")) {
      setThinkingPlaceholder(null);
      clearAwaitingChatResponse();
      return;
    }
    if (ev.type !== "llm.tool_chunk" && ev.type !== "tool.call" && ev.type !== "tool.result") return;
    const name = String(ev.data?.name || ev.data?.tool || "");
    const reason = String(ev.data?.reason || "");
    if (terminalToolEndsChatTurn(name, acceptedChatTurnRef.current)) {
      // A freshly spawned conversation worker performs a bootstrap LLM pass
      // and may pace before channel-chat delivers the queued user event. Only
      // let pace/done finish a turn after Core confirms that exact dashboard
      // event through event.received telemetry.
      setThinkingPlaceholder(null);
      clearAwaitingChatResponse();
      return;
    }
    const isResponseTool = name === "channels_respond" || name === "channels_send";
    if (isResponseTool && activeConversation) {
      return;
    }
    const visibleTool = !shouldHideChatTool(name, reason);
    const beginsVisibleTool = visibleTool && toolEventReplacesThinking(ev.type);
    if (beginsVisibleTool) {
      // A visible tool after an acknowledgement proves the prior message was
      // intermediate. Its next LLM pass is answer preparation, not silent
      // post-reply housekeeping.
      afterAgentReplyRef.current = false;
      setStartingResponse(false);
    }
    const replacesThinking = beginsVisibleTool;
    queueToolEvent(ev, replacesThinking);
  });

  // Reset tool list when switching chats / instances. Otherwise stale
  // entries from a previous instance briefly leak into the new view.
  useEffect(() => {
    cancelPendingToolEvents();
    setLiveTools(new Map());
    setExpandedToolGroups(new Set());
    toolHistoryKeyRef.current = "";
    queuedMessageInFlightRef.current = "";
    setStreamingText(null);
    setThinkingPlaceholder(null);
    clearAwaitingChatResponse();
  }, [instanceId, chatId, cancelPendingToolEvents, clearAwaitingChatResponse]);

  useEffect(() => {
    if (connected) return;
    setThinkingPlaceholder(null);
    clearAwaitingChatResponse();
  }, [connected, clearAwaitingChatResponse]);

  // Subscribe to streaming-frame updates for this chat. Frames carry
  // monotonically growing text; setting state to the latest is enough,
  // no reducer needed. A null payload (chatConnections fires that on
  // real-message-arrival and on SSE drop) clears the bubble.
  useEffect(() => {
    if (!chatId) return;
    const unsubscribe = chatConnections.subscribeStream(chatId, (f) => {
      if (f && !f.done) {
        if (awaitingChatResponseRef.current) afterAgentReplyRef.current = true;
        setStartingResponse(false);
        pendingStreamFrameRef.current = f;
        if (streamAnimationFrameRef.current === null) {
          streamAnimationFrameRef.current = window.requestAnimationFrame(() => {
            streamAnimationFrameRef.current = null;
            const latest = pendingStreamFrameRef.current;
            pendingStreamFrameRef.current = null;
            if (latest) {
              setThinkingPlaceholder(null);
              setStreamingText(latest.text);
            }
          });
        }
        return;
      }
      pendingStreamFrameRef.current = null;
      if (streamAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(streamAnimationFrameRef.current);
        streamAnimationFrameRef.current = null;
      }
      setStreamingText(null);
    });
    return () => {
      unsubscribe();
      pendingStreamFrameRef.current = null;
      if (streamAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(streamAnimationFrameRef.current);
        streamAnimationFrameRef.current = null;
      }
    };
  }, [chatId]);

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

  const handleVoice = useCallback(async () => {
    setVoiceError(null);
    if (activeVoiceHere) {
      voice.toggleMute();
      return;
    }
    if (!realtime) return;
    try {
      await voice.start({ agentId: instanceId, agentName, availability: realtime });
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Could not start voice.");
    }
  }, [activeVoiceHere, agentName, instanceId, realtime, voice]);

  // Every surface sends through this path: the composer, plan actions, and
  // queued initial messages from conversation creators such as Build. It
  // only arms the response lifecycle; the placeholder itself is driven by
  // Core's real llm.start telemetry.
  const sendChatMessage = useCallback(async (
    content: string,
    outgoingAttachments: ChatAttachment[] = [],
    clientMessageId: string = newClientMessageId(),
    startKind: ChatTurnStartKind = "response",
  ): Promise<boolean> => {
    if ((!content.trim() && outgoingAttachments.length === 0) || !chatId || sending || !connected) {
      return false;
    }
    markAwaitingChatResponse(clientMessageId, startKind);
    atBottomRef.current = true;
    scheduleFollowBottom();
    setSending(true);
    setError(null);
    try {
      const posted = await chat.post(
        chatId,
        content,
        messageContext,
        outgoingAttachments,
        clientMessageId,
      );
      // Render the server-confirmed row immediately. SSE and REST may deliver
      // it again; the id-based merge above makes those echoes harmless.
      mergeDurableMessages([posted]);
      return true;
    } catch (e) {
      clearAwaitingChatResponse();
      setThinkingPlaceholder(null);
      setError(errMsg(e));
      return false;
    } finally {
      setSending(false);
    }
  }, [chatId, sending, connected, messageContext, markAwaitingChatResponse, scheduleFollowBottom, mergeDurableMessages, clearAwaitingChatResponse]);

  // A newly created conversation may arrive with its first message queued by
  // its parent. Wait until history and the delivery stream are ready, then use
  // the exact same sender as a manual composer submission. The stable id is
  // also the server-side idempotency key, so remounts cannot double-post it.
  useEffect(() => {
    if (
      !queuedMessage ||
      !historyReady ||
      !chatId ||
      !connected ||
      sending ||
      queuedMessageInFlightRef.current === queuedMessage.id
    ) {
      return;
    }
    queuedMessageInFlightRef.current = queuedMessage.id;
    void sendChatMessage(
      queuedMessage.content,
      queuedMessage.attachments || [],
      queuedMessage.id,
      "conversation",
    ).finally(() => {
      onQueuedMessageHandled?.(queuedMessage.id);
    });
  }, [chatId, connected, historyReady, onQueuedMessageHandled, queuedMessage, sendChatMessage, sending]);

  // --- 5. Send handler ---------------------------------------------------
  const handleSend = useCallback(async () => {
    const raw = input.trim();
    if (!raw && attachments.length === 0) return;
    // Plan-mode prompt wrap. Pure prompt engineering — the agent reads
    // this as a regular user message and is expected to reply with a
    // plan (no writes) via channels_send. The Approve button below
    // sends a follow-up "execute now" message that releases the agent.
    const text = planMode
      ? `[Plan mode] Investigate using read-only tools, then reply with a numbered plan to do:\n\n${raw}\n\nDo NOT call write/send/delete/create/update tools yet. I will approve the plan before you execute.`
      : raw;
    const sent = await sendChatMessage(text, attachments);
    if (!sent) return;
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
  }, [input, attachments, planMode, sendChatMessage]);

  // postCanned sends a fixed reply on behalf of the user — used by the
  // plan-mode Approve / Reject / Refine quick-action buttons. Same
  // gating as handleSend (chat must be loaded + connected + not
  // mid-send) but bypasses the input box so the user doesn't have to
  // clear it before clicking.
  const postCanned = useCallback(
    async (text: string) => {
      await sendChatMessage(text);
    },
    [sendChatMessage],
  );

  // --- 6. Clear history -------------------------------------------------
  // Wipes the messages DB on the server AND the ephemeral on-screen
  // state: tool activity and any in-progress streaming bubble.
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
      setThinkingPlaceholder(null);
      clearAwaitingChatResponse();
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

  // Tool calls are persisted in telemetry separately from durable chat
  // messages. Backfill the visible message window so activity survives a
  // refresh, then feed it through the exact same idempotent reducer used by
  // live events. A short look-behind catches a call that began just before
  // the first loaded message and completed inside the window.
  useEffect(() => {
    if (!historyReady || !chatId || orderedMessages.length === 0) return;
    const oldestMessageAt = Date.parse(orderedMessages[0]!.created_at);
    if (!Number.isFinite(oldestMessageAt)) return;
    const since = new Date(Math.max(0, oldestMessageAt - 5 * 60_000)).toISOString();
    const key = `${instanceId}:${chatId}:${since}`;
    if (toolHistoryKeyRef.current === key) return;
    toolHistoryKeyRef.current = key;
    let cancelled = false;
    Promise.all(telemetryAgentIds.flatMap((agentId) => [
      telemetry.query(agentId, "tool.call", 1000, undefined, since),
      telemetry.query(agentId, "tool.result", 1000, undefined, since),
    ])).then((eventSets) => {
      if (cancelled) return;
      const conversationEvents = eventSets.flat().filter((event) =>
        isChatConversationTelemetry(event, chatId, telemetryAgentIds),
      );
      setLiveTools((previous) => mergeToolActivityEvents(previous, conversationEvents));
    }).catch(() => {
      // Live telemetry remains available when history is temporarily
      // unreachable. Avoid turning an auxiliary timeline failure into a
      // blocking chat error banner.
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, historyReady, instanceId, orderedMessages, telemetryAgentIds]);

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
  // Every work burst keeps the same container identity from its first tool.
  // When more tools join, the row gains expandable details in place instead
  // of being unmounted and replaced. Bursts are bounded by chat messages and
  // by a long idle gap.
  const timeline = useMemo(
    () => buildChatTimeline(orderedMessages, liveTools.values()),
    [orderedMessages, liveTools],
  );
  const timelineTail = timeline[timeline.length - 1];
  // The provisional assistant row must use the same role-transition spacing
  // as the durable response that replaces it. This keeps the transcript from
  // shifting when Thinking becomes streaming text or a persisted message.
  const pendingAssistantMargin =
    timelineTail?.kind === "message" && timelineTail.message.role === "user"
      ? "mt-4"
      : "mt-2";

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
  const telemetryThreadId = chatConversationThreadId(chatId) || "main";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
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
                  <ChatStatusDot subscribe={subscribe} threadId={telemetryThreadId} />
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
                    onClick={toggleConnection}
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
              <ChatStatusDot subscribe={subscribe} threadId={telemetryThreadId} />
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
                  onClick={toggleConnection}
                  className="text-[10px] text-text-muted hover:text-red transition-colors"
                  title={t("chat.panel.disconnectTitle")}
                >
                  {t("chat.panel.disconnect")}
                </button>
              ) : (
                <button
                  onClick={toggleConnection}
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
            <button type="button" onClick={() => { toggleConnection(); setShowMobileActions(false); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text hover:bg-bg-hover">
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
        className={`scroll-safe-bottom flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4 min-w-0 transition-opacity duration-300 ${connected ? "" : "opacity-40"}`}
      >
        {!chatId && (
          <p className="text-text-muted text-xs text-center py-8">{t("chat.panel.loading")}</p>
        )}
        {chatId && timeline.length === 0 && streamingText === null && thinkingPlaceholder === null && !startingResponse && (
          <p className="text-text-muted text-xs text-center py-8">
            {t("chat.panel.empty")}
          </p>
        )}
        {timeline.map((item, index) => {
          const previousItem = timeline[index - 1];
          if (item.kind === "day") return <TimelineDayMarker key={item.key} timestamp={item.ts} />;
          if (item.kind === "time") return <TimelineTimeMarker key={item.key} timestamp={item.ts} />;
          if (item.kind === "message") {
            const followsTool = previousItem?.kind === "tool" || previousItem?.kind === "toolGroup";
            return (
              <div
                key={item.key}
                className={`${item.compactBefore ? "mt-1.5" : followsTool ? "mt-2" : "mt-4"} first:mt-0`}
                title={formatExactTimestamp(item.ts)}
              >
                <time dateTime={new Date(item.ts).toISOString()} className="sr-only">
                  {formatExactTimestamp(item.ts)}
                </time>
                <MessageRow
                  msg={item.message}
                  projectId={projectId}
                  apps={installedApps}
                  agentName={item.message.agent_id ? agentNames[item.message.agent_id] : undefined}
                  showAgentName={Object.keys(agentNames).length > 1}
                  onMessageUpdated={handleMessageUpdated}
                />
              </div>
            );
          }
          if (item.kind === "toolGroup") {
            const followsUser = previousItem?.kind === "message" && previousItem.message.role === "user";
            return (
              <div key={item.key} className={`${followsUser ? "mt-4" : "mt-2"} first:mt-0`} title={formatExactTimestamp(item.ts)}>
                <ChatToolActivity
                  tools={item.tools}
                  parallel={item.parallel}
                  expanded={expandedToolGroups.has(item.key)}
                  onToggle={() => toggleToolGroup(item.key)}
                  registry={toolVisualRegistry}
                  detailsId={`chat-${instanceId}-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                />
              </div>
            );
          }
          const followsUser = previousItem?.kind === "message" && previousItem.message.role === "user";
          return (
            <div key={item.key} className={`${followsUser ? "mt-4" : "mt-2"} first:mt-0`} title={formatExactTimestamp(item.ts)}>
              <ChatToolActivity tools={[item.tool]} registry={toolVisualRegistry} />
            </div>
          );
        })}
        {streamingText !== null && <div className={`${pendingAssistantMargin} first:mt-0`}><StreamingBubble text={streamingText} /></div>}
        {startingResponse && streamingText === null && thinkingPlaceholder === null && (
          <div className={`${pendingAssistantMargin} first:mt-0`}>
            <StartingResponsePlaceholder conversation={startingConversation} />
          </div>
        )}
        {thinkingPlaceholder !== null && streamingText === null && (
          <div
            className={`${pendingAssistantMargin} first:mt-0`}
            title={formatExactTimestamp(thinkingPlaceholder.since)}
          >
            <ThinkingMessagePlaceholder />
          </div>
        )}
      </div>

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

      {!activeVoiceHere && completedVoiceHere && completedVoiceHere.transcripts.length > 0 && (
        <details className="mx-2 mb-1 shrink-0 rounded-lg border border-border/70 bg-bg-card/40 sm:mx-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] text-text-muted">
            <span className="text-accent"><MicrophoneIcon /></span>
            <span className="font-semibold text-text">Voice session ended</span>
            <span>{completedVoiceHere.transcripts.length} transcript lines</span>
            <span className="ml-auto text-text-dim">View</span>
          </summary>
          <div className="max-h-40 space-y-2 overflow-y-auto border-t border-border/70 px-3 py-2">
            {completedVoiceHere.transcripts.map((line) => (
              <p key={line.id} className="text-[11px] leading-relaxed text-text-muted">
                <span className="mr-2 text-[9px] font-bold uppercase text-text-dim">{line.role === "user" ? "You" : "Agent"}</span>{line.text}
              </p>
            ))}
          </div>
        </details>
      )}
      {activeVoiceHere && (
        <div className="mx-2 mb-1 shrink-0 rounded-lg border border-accent/25 bg-accent/[0.04] px-3 py-2 sm:mx-5">
          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full bg-accent ${activeVoiceHere.state === "speaking" ? "animate-pulse" : ""}`} />
            <span>{activeVoiceHere.state === "speaking" ? "Agent speaking" : activeVoiceHere.muted ? "Microphone muted" : "Voice session live"}</span>
            {activeVoiceHere.activeToolReason && <span className="min-w-0 truncate text-text-dim">· {activeVoiceHere.activeToolReason}</span>}
          </div>
          {activeVoiceHere.transcripts.slice(-2).map((line) => (
            <p key={line.id} className="mt-1 truncate text-[11px] text-text-muted">
              <span className="mr-2 text-[9px] font-bold uppercase text-text-dim">{line.role === "user" ? "You" : "Agent"}</span>{line.text}
            </p>
          ))}
        </div>
      )}
      {voiceError && <p className="mx-3 mb-1 shrink-0 text-[10px] text-red sm:mx-5">{voiceError}</p>}

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
          {realtime?.enabled && realtime.available && (
            <button
              type="button"
              onClick={() => void handleVoice()}
              disabled={!!voice.session && !activeVoiceHere}
              className={`touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-30 sm:h-8 sm:w-8 ${
                activeVoiceHere
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:bg-bg-subtle hover:text-accent"
              }`}
              aria-label={activeVoiceHere ? (activeVoiceHere.muted ? "Unmute voice session" : "Mute voice session") : "Start voice session"}
              title={activeVoiceHere ? (activeVoiceHere.muted ? "Unmute" : "Mute") : "Talk to this agent"}
            >
              <MicrophoneIcon muted={!!activeVoiceHere?.muted} />
            </button>
          )}
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
  agentName,
  showAgentName,
  onMessageUpdated,
}: {
  msg: ChatMessageRow;
  projectId: string;
  apps: ReturnType<typeof useInstalledApps>;
  agentName?: string;
  showAgentName?: boolean;
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
    <div className="flex min-h-[42px] min-w-0 flex-col justify-center">
      {showAgentName && agentName && (
        <div className="mb-1 text-[10px] font-semibold uppercase text-text-muted">{agentName}</div>
      )}
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
    <div className="flex min-h-[42px] min-w-0 flex-col justify-center">
      <div
        className="chat-md text-text text-[15px] sm:text-sm break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// Inline placeholder for the next assistant turn. It occupies transcript
// space like a message and is swapped in the same React commit as the first
// tool block, streaming text, or durable response. Keeping it inside the
// scroller avoids changing the composer/viewport geometry.
function ThinkingMessagePlaceholder() {
  const { t } = useTranslation();
  return (
    <div
      className="grid min-h-[42px] min-w-0 grid-cols-[1.9rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-0.5"
      role="status"
      aria-live="polite"
      aria-label={t("chat.panel.thinking")}
    >
      <span className="chat-thinking-dots inline-flex h-7 w-7 shrink-0 items-center justify-center gap-1" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="text-[13px] leading-5 text-text-muted">{t("chat.panel.thinking")}</span>
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
    </div>
  );
}

function StartingResponsePlaceholder({ conversation }: { conversation: boolean }) {
  const { t } = useTranslation();
  const label = conversation
    ? t("chat.panel.startingConversation")
    : t("chat.panel.startingResponse");
  return (
    <div
      className="grid min-h-[42px] min-w-0 grid-cols-[1.9rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-0.5"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-dim" />
      </span>
      <span className="text-[13px] leading-5 text-text-muted">{label}</span>
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
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

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatExactTimestamp(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function TimelineDayMarker({ timestamp }: { timestamp: number }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const day = sameLocalDay(date, today)
    ? t("chat.panel.today")
    : sameLocalDay(date, yesterday)
      ? t("chat.panel.yesterday")
      : new Intl.DateTimeFormat(locale, {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
        }).format(date);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
  return (
    <div className="my-5 flex items-center gap-3 first:mt-0" role="separator">
      <span className="h-px flex-1 bg-border/70" />
      <time dateTime={date.toISOString()} className="shrink-0 text-[10px] font-medium text-text-dim sm:text-[11px]">
        {day} · {time}
      </time>
      <span className="h-px flex-1 bg-border/70" />
    </div>
  );
}

function TimelineTimeMarker({ timestamp }: { timestamp: number }) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || undefined;
  const date = new Date(timestamp);
  return (
    <div className="my-4 flex justify-center" role="separator">
      <time dateTime={date.toISOString()} className="rounded-full bg-bg-subtle px-2.5 py-1 text-[10px] text-text-dim sm:text-[11px]">
        {new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date)}
      </time>
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
