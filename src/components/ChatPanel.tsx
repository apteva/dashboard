import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { marked } from "marked";
import { chat, type ChatMessageRow, type TelemetryEvent } from "../api";
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

// Markdown setup — marked.parse is synchronous with async: false. Chat
// content comes from the agent and is already sanitized at the message
// level (no external HTML allowed to reach it); we trust the rendered
// output the same way every other agent surface in the dashboard does.
marked.setOptions({ breaks: true, gfm: true });
function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false }) as string;
}

interface Props {
  instanceId: number;
  // Telemetry subscribe — used ONLY for the status dot. Chat messages
  // come from the channel-chat app's SSE stream, not telemetry.
  subscribe: SubscribeFn;
  // onEvent is the legacy callback the AgentView wires up to fan
  // events to sibling panels. Kept for backward compatibility — we
  // forward nothing from the chat path, but the prop signature stays
  // stable so AgentView doesn't need a conditional.
  onEvent?: (event: TelemetryEvent) => void;
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
//   channels_respond — IS the response; surfacing it as a separate
//     tool call is pure noise (the user already sees the message it
//     produced as an assistant turn).
const HIDDEN_TOOLS = new Set(["pace", "done", "channels_respond"]);

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
export function ChatPanel({ instanceId, subscribe }: Props) {
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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ephemeral tool-activity strip. NEVER enters `messages` — that's
  // the previous implementation's mistake. The strip is pinned above
  // the input; in-flight tools appear there, completed ones fade out.
  // Keyed by call id (falls back to thread:name when id is absent
  // mid-stream), so the same tool transitions cleanly through its
  // streaming → called → done lifecycle without duplicating rows.
  const [liveTools, setLiveTools] = useState<Map<string, LiveTool>>(() => new Map());

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
  const [connected, setConnected] = useState<boolean>(false);

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

  // --- 1. Resolve the chat for this instance -----------------------------
  useEffect(() => {
    setChatId(null);
    setMessages([]);
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
    chat.messages(chatId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        const maxId = rows.reduce((m, r) => (r.id > m ? r.id : m), 0);
        sinceRef.current = maxId;
        // Reading the chat clears its tray entry — but ONLY if the
        // tab is actually visible. A backgrounded tab that finishes
        // its history fetch shouldn't silently mark messages read
        // before the user has had a chance to see them.
        const visible = typeof document === "undefined" || document.visibilityState === "visible";
        if (maxId > 0 && visible) markChatSeen(chatId, maxId);
      })
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => { cancelled = true; };
  }, [chatId]);

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
      if (row.id <= sinceRef.current) return;
      sinceRef.current = row.id;
      setMessages((prev) => [...prev, row]);
      // Live messages while the panel is open + tab is visible count
      // as "seen" — this keeps the global tray quiet for the chat the
      // user is actively reading. A backgrounded tab still gets the
      // tray badge + (if enabled) a desktop notification.
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        markChatSeen(chatId, row.id);
      }
    });
  }, [chatId]);

  // Claim "focused chat" on the notifications driver whenever the
  // panel is mounted AND the tab is visible. The wildcard SSE that
  // feeds the tray skips messages for the focused chat (and silently
  // advances the watermark), so a user staring at the chat panel never
  // sees a tray badge for messages that are already on screen — even
  // when the per-chat SSE isn't connected (Connect toggle off).
  useEffect(() => {
    if (!chatId || typeof document === "undefined") return;
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
  }, [chatId]);

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

  // Pin to bottom when the timeline grows OR the viewport shrinks
  // and the user is at bottom. Deps cover three things:
  //   - messages / liveTools (timeline growth)
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
  }, [messages, liveTools, atBottom, activity.phase]);

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
  }, [subscribe]);

  // Reset tool list when switching chats / instances. Otherwise stale
  // entries from a previous instance briefly leak into the new view.
  useEffect(() => {
    setLiveTools(new Map());
    setStreamingText(null);
  }, [instanceId, chatId]);

  // Subscribe to streaming-frame updates for this chat. Frames carry
  // monotonically growing text; setting state to the latest is enough,
  // no reducer needed. A null payload (chatConnections fires that on
  // real-message-arrival and on SSE drop) clears the bubble.
  useEffect(() => {
    if (!chatId) return;
    return chatConnections.subscribeStream(chatId, (f) => {
      setStreamingText(f ? f.text : null);
    });
  }, [chatId]);

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
  }, [instanceId, chatId]);

  // Only the MAIN thread drives the strip — sub-thread activity is
  // interesting on the fleet view, but in chat the user cares about
  // whether THEIR conversation partner is working.
  useTelemetryEvents(instanceId, (ev) => {
    if (ev.thread_id !== "main" && ev.thread_id !== "") return;
    if (ev.type === "llm.start") {
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
      setActivity({ phase: "idle" });
      return;
    }
  });

  // --- 5. Send handler ---------------------------------------------------
  const handleSend = useCallback(async () => {
    const raw = input.trim();
    if (!raw || !chatId || sending || !connected) return;
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
      await chat.post(chatId, text);
      // Server echoes the inserted row back on the SSE stream — no
      // optimistic insert, no dedup needed. The row will show up
      // naturally in <200 ms once the SSE delivers.
      setInput("");
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
  }, [input, chatId, sending, connected, planMode]);

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
        await chat.post(chatId, text);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setSending(false);
      }
    },
    [chatId, sending, connected],
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

  // Interleaved timeline of messages + tools.
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
  const timeline = useMemo(() => {
    type Item =
      | { kind: "msg"; ts: number; msg: ChatMessageRow }
      | { kind: "tool"; ts: number; tool: LiveTool };
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
    return items;
  }, [orderedMessages, liveTools]);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header — presence dot, Connect/Disconnect toggle, agent
          status, clear button. Presence is a first-class signal: the
          agent is proactive and may greet / push status updates when
          it sees the user as connected, so the user owns that signal
          via this button instead of it being silently derived from
          browser tab state. */}
      <div className="border-b border-border px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {(() => {
            // Three visible presence states:
            //   connected + SSE open     → green, "Connected"
            //   connected + SSE retrying → amber pulse, "Reconnecting"
            //   disconnected             → gray, "Not connected"
            const color = !connected
              ? "bg-text-dim"
              : sseOpen
                ? "bg-green"
                : "bg-yellow animate-pulse";
            const label = !connected
              ? "Not connected"
              : sseOpen
                ? "Connected"
                : "Reconnecting";
            const title = !connected
              ? "Click Connect to rejoin chat. While disconnected, the agent does not advertise chat and won't respond there."
              : sseOpen
                ? "The agent sees you as present. Proactive responses and status pings enabled."
                : "SSE stream is retrying — agent may briefly see you as offline.";
            return (
              <span
                className="flex items-center gap-1.5 shrink-0"
                title={title}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
                <span className="text-text-muted text-[10px] uppercase tracking-wide">
                  {label}
                </span>
              </span>
            );
          })()}
          <ChatStatusDot subscribe={subscribe} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setPlanMode((v) => !v)}
            title={
              planMode
                ? "Plan mode ON — your next message asks the agent to plan first. Approve / Reject / Refine shortcuts appear above the input."
                : "Plan mode OFF — turn on to make the agent investigate and return a plan before executing writes."
            }
            className={`text-[10px] uppercase tracking-wide transition-colors ${
              planMode ? "text-accent font-bold" : "text-text-muted hover:text-text"
            }`}
          >
            {planMode ? "Plan ✓" : "Plan"}
          </button>
          {chatId && messages.length > 0 && (
            <button
              onClick={() => setShowClearModal(true)}
              title="Delete all messages in this chat (agent memory kept)"
              className="text-[10px] text-text-muted hover:text-red transition-colors"
            >
              Clear
            </button>
          )}
          {connected ? (
            <button
              onClick={() => setConnected(false)}
              className="text-[10px] text-text-muted hover:text-red transition-colors"
              title="Go offline. The agent will stop advertising chat as a connected channel and won't respond on it until you reconnect."
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setConnected(true)}
              className="text-[10px] text-accent hover:text-accent-hover transition-colors font-bold"
              title="Join chat. The agent will see you as present and may greet or push status updates."
            >
              Connect to chat
            </button>
          )}
        </div>
      </div>

      {/* Error banner — dismissible */}
      {error && (
        <div className="shrink-0 border-b border-red/40 bg-red/10 px-4 py-2 flex items-start gap-2">
          <span className="text-red text-[11px] font-bold shrink-0 mt-0.5">Error</span>
          <pre className="flex-1 min-w-0 text-[10px] text-red leading-snug whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
            {error}
          </pre>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-red/70 hover:text-red text-xs px-1"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 min-w-0 transition-opacity duration-300 ${connected ? "" : "opacity-40"}`}
      >
        {!chatId && (
          <p className="text-text-muted text-xs text-center py-8">Loading chat…</p>
        )}
        {chatId && orderedMessages.length === 0 && (
          <p className="text-text-muted text-xs text-center py-8">
            No messages yet. Say hi.
          </p>
        )}
        {timeline.map((item) =>
          item.kind === "msg" ? (
            <MessageRow
              key={`m${item.msg.id}`}
              msg={item.msg}
              projectId={projectId}
              apps={installedApps}
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
          <div className="shrink-0 px-3 pt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">
              Plan
            </span>
            <button
              onClick={() => postCanned("Approved. Execute the plan now.")}
              disabled={sending}
              className="text-[11px] px-2 py-1 rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 transition-colors"
              title="Tell the agent to execute the plan."
            >
              ✓ Approve
            </button>
            <button
              onClick={() =>
                postCanned("Rejected. Don't execute that plan — try a different approach.")
              }
              disabled={sending}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-muted hover:border-red hover:text-red disabled:opacity-40 transition-colors"
              title="Discard this plan and ask the agent to try a different approach."
            >
              ✗ Reject
            </button>
            <button
              onClick={() =>
                postCanned("Refine the plan. Keep the overall approach but address the points I'll list next.")
              }
              disabled={sending}
              className="text-[11px] px-2 py-1 rounded border border-border text-text-muted hover:border-text hover:text-text disabled:opacity-40 transition-colors"
              title="Tell the agent to revise the plan. Follow up with what to change."
            >
              ↻ Refine
            </button>
            <span className="text-[10px] text-text-dim ml-1">
              or just type a reply
            </span>
          </div>
        )}

      {/* Input */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 rounded-2xl border border-border focus-within:border-accent/60 transition-colors px-3 py-1.5 shadow-lg bg-bg-card/90 backdrop-blur-sm"
        >
          <span className="font-bold text-sm text-accent shrink-0 self-center">&gt;</span>
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
            rows={1}
            style={{ lineHeight: "20px", minHeight: "32px" }}
            className="flex-1 bg-transparent text-sm text-text focus:outline-none min-w-0 resize-none placeholder:text-text-dim font-mono py-1.5 block"
            placeholder={
              !chatId
                ? "Loading…"
                : !connected
                  ? "Connect to chat…"
                  : "Message the agent…"
            }
            disabled={!chatId || !connected}
            autoFocus={!!chatId}
          />
          <button
            type="submit"
            disabled={!chatId || !input.trim() || sending || !connected}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all bg-accent text-bg disabled:opacity-20 disabled:cursor-not-allowed enabled:hover:bg-accent-hover enabled:active:scale-95"
            aria-label="Send"
            title="Send (Enter)"
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
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowClearModal(false)}>
          <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />
          <div className="relative bg-bg-card border border-border rounded-lg shadow-lg w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 space-y-3">
              <h3 className="text-text text-sm font-bold">Clear chat</h3>
              <p className="text-text-muted text-xs leading-relaxed">
                All messages in this chat will be deleted from the database.
                The agent's memory and sub-thread state are untouched.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setShowClearModal(false)}
                  className="px-3 py-1.5 text-xs text-text-muted border border-border rounded-lg hover:border-text-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 text-xs text-bg bg-red hover:bg-red/80 rounded-lg font-bold transition-colors"
                >
                  Clear messages
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
}: {
  msg: ChatMessageRow;
  projectId: string;
  apps: ReturnType<typeof useInstalledApps>;
}) {
  // Memoize the parsed HTML against the message content so the
  // marked() call doesn't run on a re-render that survived the memo
  // (e.g. apps array reference changed but msg.content didn't).
  // The role check matches the original fall-through: user + system
  // get bespoke layouts above; everything else (agent and any future
  // role) renders as markdown.
  const isMarkdown = msg.role !== "user" && msg.role !== "system";
  const html = useMemo(
    () => (isMarkdown ? renderMarkdown(msg.content) : ""),
    [msg.content, isMarkdown],
  );

  if (msg.role === "user") {
    return (
      <div className="flex justify-end min-w-0">
        <div className="bg-accent/15 border border-accent/30 rounded-xl rounded-br-sm px-3 py-1.5 max-w-[80%] min-w-0">
          <p className="text-text text-xs whitespace-pre-wrap break-words">{msg.content}</p>
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
        className="chat-md text-text text-xs break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {msg.status === "streaming" && <span className="tool-cursor">▊</span>}
      {msg.components && msg.components.length > 0 && (
        <ChatComponentList
          components={msg.components}
          apps={apps}
          projectId={projectId}
        />
      )}
    </div>
  );
});

// StreamingBubble — ephemeral agent-style bubble pinned to the bottom
// of the timeline while the LLM is composing a respond() call. The
// text grows as new server frames arrive. Replaced (not transitioned)
// by the real DB message once the tool actually runs — chatConnections
// fires a null stream payload at that moment, which clears the bubble
// in the same React commit as MessageRow renders the final row.
//
// Markdown: we parse on every chunk via the same renderMarkdown used
// by final messages, so lists/code/bold render live. Unterminated
// tokens (a `**bold` mid-stream) get auto-closed by closeOpenMarkdown
// before parse — keeps marked from emitting literal asterisks one
// chunk and bold the next. Memoized against text so unrelated
// re-renders (e.g. other state changes in ChatPanel) don't re-parse.
function StreamingBubble({ text }: { text: string }) {
  const html = useMemo(
    () => renderMarkdown(closeOpenMarkdown(text)),
    [text],
  );
  return (
    <div className="min-w-0">
      <div
        className="chat-md text-text text-xs break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <span className="tool-cursor">▊</span>
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
function ToolRow({ t }: { t: LiveTool }) {
  const icon =
    t.state === "streaming"
      ? <span className="text-yellow shrink-0 animate-pulse">◐</span>
      : t.state === "called"
      ? <span className="text-accent shrink-0 animate-spin">⟳</span>
      : <span className={`shrink-0 ${t.success ? "text-green" : "text-red"}`}>{t.success ? "✓" : "✗"}</span>;
  const label =
    t.reason || (t.state === "streaming" ? "Starting..." : "Working...");
  const dur =
    t.state === "done" && t.durationMs != null
      ? t.durationMs >= 1000
        ? `${(t.durationMs / 1000).toFixed(1)}s`
        : `${t.durationMs}ms`
      : "";

  return (
    <div className="flex items-center gap-1.5 min-w-0 leading-tight pl-3 text-[10px] text-text-dim">
      {icon}
      <span
        className={t.state === "streaming" ? "truncate italic" : "truncate"}
        title={label}
      >
        {label}
      </span>
      {dur && <span className="shrink-0">({dur})</span>}
      {t.state === "done" && t.success === false && (
        <span className="shrink-0 text-red">failed</span>
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

function ActivityStrip({ activity }: { activity: ActivityForStrip }) {
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
      <span className="text-text shrink-0">Thinking…</span>
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
