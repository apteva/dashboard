import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import { instances, channels, core, type TelemetryEvent } from "../api";

// Markdown renderer — marked.parse is synchronous when we pass `async: false`.
// We trust core's output (agent-generated) so we don't need a sanitizer; the
// dashboard is already gated behind auth. Keep line breaks tight with
// `breaks: true` so single newlines in replies render as <br>.
marked.setOptions({ breaks: true, gfm: true });
function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false }) as string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "tool" | "ask" | "status";
  text: string;
  streaming?: boolean;
  toolName?: string;
  toolDone?: boolean;
  toolDurationMs?: number;
  toolSuccess?: boolean;
  level?: string;
  time: number;
}

// AgentMessage renders an agent reply as full-width markdown. Memoized on
// text+streaming so long replies don't re-parse on every unrelated update.
function AgentMessage({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div className="min-w-0">
      <div
        className="chat-md text-text text-xs break-words leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {streaming && <span className="tool-cursor">▊</span>}
    </div>
  );
}

// TextExtractor incrementally extracts the value of the "text" field from a
// streaming JSON fragment like {"text": "hello"} that arrives in pieces:
//   chunk 1: {"te    chunk 2: xt": "He    chunk 3: llo
// Once "text":" is found the inner string is emitted character-by-character
// as new chunks arrive. Handles escape sequences split across chunk
// boundaries (a chunk ending in \, then the next chunk starts with " or n).
//
// Direct port of textExtractor in apteva/client.go — keep both in sync.
class TextExtractor {
  private buf = "";
  private inText = false;
  private emitted = 0;
  private pendingEsc = false;

  reset() {
    this.buf = "";
    this.inText = false;
    this.emitted = 0;
    this.pendingEsc = false;
  }

  feed(chunk: string): string {
    this.buf += chunk;
    const s = this.buf;

    if (!this.inText) {
      // Look for "text":" or "text": " in accumulated buffer.
      let idx = s.indexOf('"text":"');
      let start = 0;
      if (idx >= 0) {
        start = idx + 8;
      } else {
        idx = s.indexOf('"text": "');
        if (idx >= 0) start = idx + 9;
      }
      if (idx < 0) return "";
      this.inText = true;
      this.emitted = start;
    }

    // Walk from emitted position, handling escape sequences.
    let result = "";
    let i = this.emitted;
    while (i < s.length) {
      const ch = s[i];
      if (this.pendingEsc) {
        this.pendingEsc = false;
        switch (ch) {
          case '"': result += '"'; break;
          case "\\": result += "\\"; break;
          case "n": result += "\n"; break;
          case "r": result += "\r"; break;
          case "t": result += "\t"; break;
          case "/": result += "/"; break;
          default: result += "\\" + ch; break;
        }
        i++;
        continue;
      }
      if (ch === "\\") {
        if (i + 1 >= s.length) {
          // Backslash at end of buffer — wait for next chunk.
          this.pendingEsc = true;
          i++;
          continue;
        }
        const next = s[i + 1];
        switch (next) {
          case '"': result += '"'; break;
          case "\\": result += "\\"; break;
          case "n": result += "\n"; break;
          case "r": result += "\r"; break;
          case "t": result += "\t"; break;
          case "/": result += "/"; break;
          default: result += "\\" + next; break;
        }
        i += 2;
        continue;
      }
      if (ch === '"') {
        // End of string value — reset for next tool call.
        this.buf = "";
        this.inText = false;
        this.emitted = 0;
        this.pendingEsc = false;
        break;
      }
      result += ch;
      i++;
    }
    this.emitted = i;
    return result;
  }
}

interface Props {
  instanceId: number;
  onEvent: (event: TelemetryEvent) => void;
}

export function ChatPanel({ instanceId, onEvent }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgIdRef = useRef(0);
  // Dedup layers, strongest first. Each rendering path consults both sets;
  // adding to either short-circuits the handler.
  //
  // 1) `seenEventsRef` keyed on telemetry event.id. The core guarantees
  //    uniqueness per event, so this catches the StrictMode double-mount
  //    and SSE reconnect cases. Bounded at 500.
  //
  // 2) `seenToolCallsRef` keyed on `thread_id|data.id`. The core assigns
  //    `data.id` sequentially inside each thread (e.g.
  //    "functions.channels_respond:17") — stable, content-independent, and
  //    immune to the event.id race in generateID (seq++ outside the mutex
  //    can collide on rare simultaneous emits). This is the belt to the
  //    event.id's suspenders. Bounded at 500.
  const seenEventsRef = useRef<Set<string>>(new Set());
  const seenOrderRef = useRef<string[]>([]);
  const seenToolCallsRef = useRef<Set<string>>(new Set());
  const seenToolCallsOrderRef = useRef<string[]>([]);

  // Streaming state for channels_respond. The CLI streams each LLM
  // tool_chunk fragment through a JSON extractor and renders text
  // character-by-character. We do the same here:
  //   1. extractorRef holds the current parser state across chunks
  //   2. streamingMsgIdRef points at the chat row we're appending to
  //   3. streamingChannelOkRef tracks whether the in-progress
  //      channels_respond targets the cli channel (we only stream
  //      cli; non-cli responses don't need to render here at all)
  // When tool.call lands with the complete args we replace the
  // streaming row's text with the canonical text — so even if the
  // extractor missed a byte across a chunk boundary, the final
  // rendering is correct. tool.result clears the streaming state.
  const extractorRef = useRef<TextExtractor>(new TextExtractor());
  const streamingMsgIdRef = useRef<string | null>(null);
  const streamingChannelOkRef = useRef<boolean>(true);

  const nextId = () => String(++msgIdRef.current);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // SSE connection — goes through the per-instance proxy straight to the
  // core's in-process /events endpoint, not through the server's
  // TelemetryBroadcaster.
  //
  // Why: the broadcaster path has a bounded 100-slot channel that silently
  // drops events when full (see server/telemetry.go Broadcast — the
  // `select { case ch <- ev: default: }` idiom). During a streaming LLM
  // response that fires 30-150 llm.chunk events in ~2 seconds, any slight
  // slowness in the SSE writer causes chunks to disappear mid-sentence and
  // the dashboard renders garbled thoughts.
  //
  // The core's /events endpoint reads from an in-process ring buffer with
  // proper cursor semantics and flushes each event immediately — it's the
  // same path the CLI TUI uses, which is why the CLI never drops. Going
  // through the instance-proxy route (handleProxy) preserves the SSE frames
  // via per-frame Flush() and adds auth scoping.
  useEffect(() => {
    const es = new EventSource(`/api/instances/${instanceId}/events`);
    es.onmessage = (e) => {
      try {
        const event: TelemetryEvent = JSON.parse(e.data);
        handleSSEEvent(event);
        onEvent(event);
      } catch {}
    };
    return () => es.close();
  }, [instanceId]);

  // Reset connection state when switching instances. The user has to
  // explicitly "Connect to chat" per instance, mirroring the CLI's explicit
  // attach model.
  useEffect(() => {
    setConnected(false);
    setMessages([]);
    setAsking(false);
    seenEventsRef.current = new Set();
    seenOrderRef.current = [];
    seenToolCallsRef.current = new Set();
    seenToolCallsOrderRef.current = [];
    extractorRef.current.reset();
    streamingMsgIdRef.current = null;
    streamingChannelOkRef.current = true;
  }, [instanceId]);

  // Connect — mirrors the CLI handshake in apteva/client.go:91. Sends the
  // "RULES" bootstrap that tells the agent to reply via channels_respond
  // and greet the user. Only fires on explicit button click; nothing
  // happens on panel mount.
  const handleConnect = async () => {
    const bootstrap = '[cli] root user connected via dashboard. RULES: 1) Reply to ALL [cli] messages using channels_respond(channel="cli"). 2) When the user asks you to do something, IMMEDIATELY acknowledge what you will do BEFORE doing it, then follow up with the result. 3) Never leave a message unanswered. Greet them now.';
    try {
      await instances.sendEvent(instanceId, bootstrap);
      setConnected(true);
    } catch {}
  };

  const handleDisconnect = async () => {
    try {
      await instances.sendEvent(instanceId, "[cli] root user disconnected from terminal");
    } catch {}
    setConnected(false);
  };

  // Tools that are noisy internal housekeeping — hide from the chat UI.
  // Matches the CLI's conToolRender filter spirit: keep the chat focused on
  // user-visible work (real tool calls + agent replies), not pace/done/evolve.
  const hiddenTools = new Set([
    "pace", "done", "evolve", "remember", "send",
    "channels_respond", "channels_ask", "channels_status",
  ]);

  const handleSSEEvent = (event: TelemetryEvent) => {
    // Parse the core's emit time once. We use this — NOT Date.now() —
    // for every message timestamp, then sort messages by time at
    // render. This guarantees chronological order regardless of how
    // events are batched, raced, or reordered between core's emit and
    // ChatPanel's processing. Falls back to Date.now() if event.time is
    // missing or malformed (shouldn't happen, but defensive).
    const eventTime = (() => {
      if (event.time) {
        const t = Date.parse(event.time);
        if (!Number.isNaN(t)) return t;
      }
      return Date.now();
    })();

    // Layer 1: telemetry event.id
    if (event.id) {
      if (seenEventsRef.current.has(event.id)) return;
      seenEventsRef.current.add(event.id);
      seenOrderRef.current.push(event.id);
      if (seenOrderRef.current.length > 500) {
        const old = seenOrderRef.current.shift();
        if (old) seenEventsRef.current.delete(old);
      }
    }

    const data = event.data || {};

    // Layer 2: tool call id scoped to thread. For tool.call events the
    // core assigns a stable sequential id like "functions.channels_respond:17"
    // that uniquely identifies the invocation. The ChatPanel ONLY renders
    // on tool.call events, so this layer is sufficient to prevent any
    // duplicate agent message even if layer 1 gets bypassed.
    if (event.type === "tool.call" && data.id) {
      const key = `${event.thread_id || ""}|${data.id}`;
      if (seenToolCallsRef.current.has(key)) return;
      seenToolCallsRef.current.add(key);
      seenToolCallsOrderRef.current.push(key);
      if (seenToolCallsOrderRef.current.length > 500) {
        const old = seenToolCallsOrderRef.current.shift();
        if (old) seenToolCallsRef.current.delete(old);
      }
    }

    // llm.tool_chunk — incremental fragments of the LLM's tool-call
    // arguments JSON. We only care about channels_respond chunks targeting
    // the cli channel. Each chunk gets fed through the extractor which
    // pulls the running text value out of the in-flight JSON. The first
    // non-empty chunk creates a streaming row; subsequent chunks append.
    if (event.type === "llm.tool_chunk" && data.tool === "channels_respond") {
      const chunk = String(data.chunk || "");
      if (!chunk) return;
      // Note: at this point we don't yet know which channel the agent
      // is targeting — tool.call (which carries the channel arg) lands
      // AFTER all the tool_chunk events for that call. So we
      // optimistically stream as cli and the tool.call handler below
      // will discard the row if the channel turned out to be different.
      if (!streamingChannelOkRef.current) return;
      const newText = extractorRef.current.feed(chunk);
      if (newText === "") return;

      if (streamingMsgIdRef.current === null) {
        // Create a fresh streaming row anchored to the core's emit
        // time of the FIRST chunk. We never update this timestamp as
        // more chunks land — that would let the row drift below later
        // tool calls. Tool calls and other messages with later
        // timestamps get sorted to the right position after this row.
        const id = nextId();
        streamingMsgIdRef.current = id;
        setMessages((prev) => [...prev, {
          id,
          role: "agent",
          text: newText,
          streaming: true,
          time: eventTime,
        }]);
      } else {
        // Append to the existing streaming row.
        const id = streamingMsgIdRef.current;
        setMessages((prev) => prev.map((m) =>
          m.id === id ? { ...m, text: m.text + newText } : m,
        ));
      }
      return;
    }

    // channels_respond tool.call — finalizes whichever streaming row was
    // built up by the llm.tool_chunk events. The tool.call args are the
    // canonical text value, so we replace the streaming row's text with
    // them (in case the extractor dropped a byte at a chunk boundary).
    // If no streaming row exists yet (rare — e.g. provider didn't emit
    // tool_chunk events, or the channel is non-cli), we either create a
    // new row from the args or skip rendering.
    if (event.type === "tool.call" && data.name === "channels_respond") {
      const args = data.args as Record<string, any> | undefined;
      const text = String(args?.text || "").trim();
      const channel = String(args?.channel || "cli");
      const isCli = channel === "cli";
      const streamingId = streamingMsgIdRef.current;

      if (!isCli) {
        // Non-cli response (telegram, slack, etc.) — drop any in-flight
        // streaming row (we optimistically streamed it as cli) and skip.
        if (streamingId) {
          setMessages((prev) => prev.filter((m) => m.id !== streamingId));
        }
        streamingMsgIdRef.current = null;
        extractorRef.current.reset();
        return;
      }

      if (streamingId) {
        // Replace the streaming row's text with the canonical args.text
        // and mark it no longer streaming (cursor disappears).
        setMessages((prev) => prev.map((m) =>
          m.id === streamingId ? { ...m, text, streaming: false } : m,
        ));
      } else if (text) {
        // No streaming row — provider didn't emit tool_chunks for this
        // call. Create a finalized row directly.
        setMessages((prev) => [...prev, {
          id: nextId(), role: "agent", text, time: eventTime,
        }]);
      }
      streamingMsgIdRef.current = null;
      extractorRef.current.reset();
      return;
    }

    // channels_ask — agent is asking a question
    if (event.type === "tool.call" && data.name === "channels_ask") {
      setAsking(true);
      const args = data.args as Record<string, any> | undefined;
      const question = String(args?.question || args?.text || "").trim();
      if (question) {
        setMessages((prev) => [...prev, {
          id: nextId(), role: "agent", text: question, time: eventTime,
        }]);
      }
      return;
    }

    // channels_status
    if (event.type === "tool.call" && data.name === "channels_status") {
      const args = data.args as Record<string, string> | undefined;
      if (args?.line) {
        setMessages((prev) => [...prev, {
          id: nextId(), role: "status", text: args.line,
          level: args.level || "info", time: eventTime,
        }]);
      }
      return;
    }

    // Tool call (visible tools only) — show indicator.
    //
    // Critical: the message id is derived from data.id (the core's stable
    // call identifier like "functions.google-sheets_read_range:87"), NOT
    // from a monotonic counter. The matching tool.result event carries
    // the SAME data.id, which lets the result handler below find this
    // exact row and mark it done. Previously we used nextId() which made
    // every event a unique row, and the result handler then matched by
    // tool name — but with multiple concurrent calls of the same tool,
    // results raced against calls and the matcher missed, producing
    // duplicate "done with no reason" rows in the chat.
    if (event.type === "tool.call" && data.name && !hiddenTools.has(String(data.name))) {
      const callKey = `${event.thread_id || ""}:tool:${data.id || ""}`;
      setMessages((prev) => {
        // If a matching row already exists (e.g. result arrived before
        // call due to reordering), update it in place with the reason.
        // Otherwise append a new row.
        const idx = prev.findIndex((m) => m.id === callKey);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            text: data.reason || updated[idx].text || "",
            toolName: data.name,
          };
          return updated;
        }
        return [...prev, {
          id: callKey,
          role: "tool",
          text: data.reason || "",
          toolName: data.name,
          time: eventTime,
        }];
      });
      return;
    }

    // Tool result (visible tools only) — find the matching call row by
    // its stable id and flip it to done. If no row exists yet (result
    // arrived before its call), create one as a placeholder; the call
    // handler above will fill in the reason when it eventually arrives.
    if (event.type === "tool.result" && data.name && !hiddenTools.has(String(data.name))) {
      const callKey = `${event.thread_id || ""}:tool:${data.id || ""}`;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === callKey);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            toolDone: true,
            toolDurationMs: data.duration_ms,
            toolSuccess: data.success !== false,
          };
          return updated;
        }
        return [...prev, {
          id: callKey,
          role: "tool",
          text: "",
          toolName: data.name,
          toolDone: true,
          toolDurationMs: data.duration_ms,
          toolSuccess: data.success !== false,
          time: eventTime,
        }];
      });
      return;
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");

    if (asking) {
      // Reply to an ask
      setAsking(false);
      setMessages((prev) => [...prev, { id: nextId(), role: "user", text, time: Date.now() }]);
      await channels.submitReply(instanceId, text);
    } else {
      // Normal message
      setMessages((prev) => [...prev, { id: nextId(), role: "user", text, time: Date.now() }]);
      await instances.sendEvent(instanceId, `[cli] ${text}`);
    }
  };

  // Clear the chat — mirrors the CLI's /clear command. Wipes the local
  // visible messages AND tells the agent to reset its LLM message
  // history. Memory and sub-threads are untouched, so the agent keeps
  // remembered facts but forgets the back-and-forth conversation. Useful
  // when the agent gets stuck in a tangent or you want a fresh context
  // window without losing learned state.
  const handleClear = async () => {
    if (!confirm("Clear conversation? The agent will forget the chat history (memory and sub-threads are kept).")) {
      return;
    }
    setMessages([]);
    seenEventsRef.current = new Set();
    seenOrderRef.current = [];
    seenToolCallsRef.current = new Set();
    seenToolCallsOrderRef.current = [];
    try {
      await core.reset(instanceId, { history: true });
    } catch (err) {
      // Non-fatal — the local UI is already cleared. Show the error
      // briefly so the user knows the server-side reset didn't land.
      console.error("clear: server reset failed", err);
    }
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Connection header — mirrors CLI: click to attach/detach */}
      <div className="border-b border-border px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-green" : "bg-text-dim"}`} />
          <span className="text-text-muted text-[10px] uppercase tracking-wide truncate">
            {connected ? "Connected to chat" : "Not connected"}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Clear — mirrors the CLI's /clear command. Only meaningful when
              there's something to clear, so hide when chat is empty. Always
              visible when there are messages, regardless of connected state,
              so the user can wipe a finished session before disconnecting. */}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              title="Clear conversation history (agent forgets the chat but keeps memory)"
              className="text-[10px] text-text-muted hover:text-red transition-colors"
            >
              Clear
            </button>
          )}
          {connected ? (
            <button
              onClick={handleDisconnect}
              className="text-[10px] text-text-muted hover:text-red transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              className="text-[10px] text-accent hover:text-accent-hover transition-colors font-bold"
            >
              Connect to chat
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 min-w-0">
        {messages.length === 0 && (
          <p className="text-text-muted text-xs text-center py-8">
            {connected ? "Send a message to start chatting" : 'Click "Connect to chat" to talk with the agent'}
          </p>
        )}
        {/* Sort messages by their core-emit timestamp before rendering.
            Each message stores `time` set from the SSE event.time field
            (or Date.now() for user-typed messages, which always happen
            "now" anyway). Sorting at render handles every case where
            messages were appended out of order — async batching of
            setMessages calls, tool.call events arriving after a later
            iteration's tool_chunks, etc. — without requiring any
            insertion-time logic to find the right slot. The sort is
            stable in modern JS engines, so equal-time messages keep
            insertion order. */}
        {[...messages].sort((a, b) => a.time - b.time).map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end min-w-0">
                <div className="bg-accent/15 border border-accent/30 rounded-xl rounded-br-sm px-3 py-1.5 max-w-[80%] min-w-0">
                  <p className="text-text text-xs whitespace-pre-wrap break-words">{msg.text}</p>
                </div>
              </div>
            );
          }

          if (msg.role === "agent") {
            // Full-width, no bubble — Claude.ai style. Markdown-rendered.
            return (
              <AgentMessage key={msg.id} text={msg.text} streaming={msg.streaming} />
            );
          }

          if (msg.role === "tool") {
            // Prefer the free-text reason ("Re-fetching sheet data as
            // requested") over the raw slug ("google-sheets_read_range").
            // The slug stays in the title attribute so power users can hover
            // to confirm which tool fired. msg.text is where the SSE
            // handler stored data.reason at the call site.
            const label = msg.text || msg.toolName || "";
            if (msg.toolDone) {
              const dur = msg.toolDurationMs != null
                ? msg.toolDurationMs >= 1000 ? `${(msg.toolDurationMs / 1000).toFixed(1)}s` : `${msg.toolDurationMs}ms`
                : "";
              return (
                <div key={msg.id} className="flex items-center gap-2 px-1 text-[10px] min-w-0">
                  <span className={`shrink-0 ${msg.toolSuccess ? "text-green" : "text-red"}`}>✓</span>
                  <span className="text-text-dim truncate" title={msg.toolName}>{label}</span>
                  {dur && <span className="text-text-muted shrink-0">({dur})</span>}
                </div>
              );
            }
            return (
              <div key={msg.id} className="flex items-center gap-2 px-1 text-[10px] tool-active-line min-w-0">
                <span className="text-accent shrink-0">⟳</span>
                <span className="text-accent truncate" title={msg.toolName}>{label}</span>
              </div>
            );
          }

          if (msg.role === "status") {
            const icon = msg.level === "alert" ? "🚨" : msg.level === "warn" ? "⚠️" : "ℹ";
            return (
              <div key={msg.id} className="text-center text-[10px] text-text-muted py-1 break-words">
                {icon} {msg.text}
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Ask banner — sits just above the floating input bar */}
      {asking && (
        <div className="px-4 pt-2 pb-1 text-[10px] text-accent text-center">
          The agent is asking you a question — type your answer below
        </div>
      )}

      {/* Floating input bar — claude.ai-inspired but with the terminal
          ">" prompt preserved. Textarea auto-grows (1-6 rows) so multi-line
          drafts don't need a separate editor. Enter submits; Shift+Enter
          inserts a newline. Send button is a circular arrow on the right
          and stays hidden when the input is empty or disconnected so the
          bar looks clean when idle. */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (connected) handleSend();
          }}
          className={`flex items-center gap-2 rounded-2xl border transition-colors px-3 py-1.5 shadow-lg bg-bg-card/90 backdrop-blur-sm ${
            connected
              ? "border-border focus-within:border-accent/60"
              : "border-border/50 opacity-60"
          }`}
        >
          <span
            className={`font-bold text-sm shrink-0 self-center ${
              connected ? "text-accent" : "text-text-dim"
            }`}
          >
            &gt;
          </span>
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-size: reset then cap at ~6 lines so long drafts
              // stay in a bounded container instead of eating the chat.
              const el = e.target as HTMLTextAreaElement;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 144) + "px";
            }}
            onKeyDown={(e) => {
              // Enter submits. Shift+Enter = newline. Matches the
              // claude.ai convention.
              if (e.key === "Enter" && !e.shiftKey && connected) {
                e.preventDefault();
                handleSend();
                // Reset textarea height after submit.
                const el = e.currentTarget as HTMLTextAreaElement;
                setTimeout(() => {
                  el.style.height = "auto";
                }, 0);
              }
            }}
            disabled={!connected}
            rows={1}
            // block + no extra line-height baggage lines the textarea
            // flush against the rounded-2xl container, and with a fixed
            // single-row starting height (32px ≈ send button) everything
            // lands on the same vertical midline. The auto-size handler
            // above grows it beyond 32px only when the user actually
            // types multiple lines.
            style={{ lineHeight: "20px", minHeight: "32px" }}
            className="flex-1 bg-transparent text-sm text-text focus:outline-none min-w-0 disabled:opacity-50 disabled:cursor-not-allowed resize-none placeholder:text-text-dim font-mono py-1.5 block"
            placeholder={
              !connected
                ? "Click \"Connect to chat\" to start"
                : asking
                  ? "Type your answer…"
                  : "Message the agent…  (Enter to send, Shift+Enter for newline)"
            }
            autoFocus={connected}
          />
          <button
            type="submit"
            disabled={!connected || !input.trim()}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all bg-accent text-bg disabled:opacity-20 disabled:cursor-not-allowed enabled:hover:bg-accent-hover enabled:active:scale-95"
            aria-label="Send message"
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
    </div>
  );
}
