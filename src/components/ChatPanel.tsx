import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { marked } from "marked";
import { chat, type ChatMessageRow, type TelemetryEvent } from "../api";
import { ChatStatusDot } from "./ChatStatusDot";
import { markChatSeen } from "../state/chatNotifications";
import { chatConnections } from "../state/chatConnections";
import type { SubscribeFn } from "./InstanceView";

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
  // onEvent is the legacy callback the InstanceView wires up to fan
  // events to sibling panels. Kept for backward compatibility — we
  // forward nothing from the chat path, but the prop signature stays
  // stable so InstanceView doesn't need a conditional.
  onEvent?: (event: TelemetryEvent) => void;
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
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Explicit connect/disconnect. Persistence across reloads is handled
  // by remembering the last choice in localStorage — so a user who
  // wants to stay connected doesn't have to click every page load,
  // but a user who went offline stays offline until they click back.
  //
  // Why explicit at all? The agent is proactive — when chat is
  // "connected" it may greet, ping, push a status update unprompted.
  // We want the user to own that "I'm available to be poked" signal,
  // not have it toggle silently as browser tabs open and close.
  const [connected, setConnected] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(`chat.connected.${instanceId}`);
      // Default: DISCONNECTED on first visit. Connecting is an
      // explicit opt-in because a connected chat channel lets the
      // proactive agent push unprompted messages at you — the user
      // should own that signal. localStorage remembers your last
      // choice so returning users don't have to re-click every visit.
      return v === "1";
    } catch {
      return false;
    }
  });

  // SSE "is the stream actually open?" — distinct from `connected`,
  // which is the user's INTENT. readyState transitions on retry are
  // surfaced here so the presence dot can say "reconnecting" instead
  // of a stale "connected".
  const [sseOpen, setSseOpen] = useState(false);

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
        // Reading the chat clears its tray entry across this tab AND
        // every other tab open to the same chat (storage event).
        if (maxId > 0) markChatSeen(chatId, maxId);
      })
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => { cancelled = true; };
  }, [chatId]);

  // --- 3. Hook into the global chat-connections manager ----------------
  //
  // The SSE no longer lives inside this component. The Layout-level
  // chatConnections singleton owns one EventSource per chat the user
  // has marked connected, so navigating away from this instance does
  // NOT close the connection — the agent keeps seeing chat as IsActive
  // and can ping the user while they're on another page. ChatPanel is
  // a viewer for the singleton's state.
  //
  // Three things to wire:
  //   1. connect/disconnect toggle → manager.connect/disconnect
  //      (also persists intent in localStorage and emits the
  //      [chat] user connected/disconnected events to the agent).
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

  // --- 4. Auto-scroll on new messages -----------------------------------
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // --- 5. Send handler ---------------------------------------------------
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !chatId || sending || !connected) return;
    setSending(true);
    setError(null);
    try {
      await chat.post(chatId, text);
      // Server echoes the inserted row back on the SSE stream — no
      // optimistic insert, no dedup needed. The row will show up
      // naturally in <200 ms once the SSE delivers.
      setInput("");
      // Reset textarea height.
      const el = document.getElementById("chat-input") as HTMLTextAreaElement | null;
      if (el) el.style.height = "auto";
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSending(false);
    }
  }, [input, chatId, sending]);

  // --- 6. Clear history -------------------------------------------------
  const handleClear = async () => {
    setShowClearModal(false);
    if (!chatId) return;
    try {
      await chat.clear(chatId);
      setMessages([]);
      sinceRef.current = 0;
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a.id - b.id),
    [messages],
  );

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
        {orderedMessages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}
      </div>

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
                  ? 'Click "Connect to chat" to talk with the agent'
                  : "Message the agent…"
            }
            disabled={!chatId || sending || !connected}
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
function MessageRow({ msg }: { msg: ChatMessageRow }) {
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
  // Agent — markdown.
  const html = renderMarkdown(msg.content);
  return (
    <div className="min-w-0">
      <div
        className="chat-md text-text text-xs break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {msg.status === "streaming" && <span className="tool-cursor">▊</span>}
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
