import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import { instances, core, type TelemetryEvent } from "../api";

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
  // Monotonic insertion sequence. Used as the sort key at render time so
  // the rendered order stays deterministic even if later state updates
  // mutate earlier rows in place. Once assigned on first insert, seq is
  // never changed — updates preserve the row's original position.
  seq: number;
  role: "user" | "agent" | "tool" | "status";
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
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Local counter for user-typed messages (the only role whose id isn't
  // derived from a telemetry event). Telemetry-driven rows use stable keys
  // computed from event fields so they dedup naturally across reconnects.
  const userCounterRef = useRef(0);
  // Monotonic seq assigned on first insert; preserved on updates so rows
  // stay in their original position regardless of later mutations.
  const seqRef = useRef(0);
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

  // Streaming state for channels_respond. Chunks are buffered in
  // the extractor and only rendered when tool.call finalizes, so
  // the agent message appears AFTER any tool calls from the same turn.
  const extractorRef = useRef<TextExtractor>(new TextExtractor());
  // Stable key of the current channels_respond streaming row (if any).
  // Set on the first llm.tool_chunk of a turn; tool.call channels_respond
  // converts that exact row into the final agent message in place so the
  // text keeps its original seq / visual position.
  const streamingKeyRef = useRef<string | null>(null);

  // Live "thinking" indicator for the main thread. Driven by llm.start /
  // llm.thinking / llm.done / llm.error — gives the user visible feedback
  // that something is happening even when the agent is mid-reasoning and
  // hasn't emitted any visible tool calls or response chunks yet.
  const [thinking, setThinking] = useState<{ active: boolean; preview: string }>({
    active: false,
    preview: "",
  });
  // Ring buffer of recent llm.thinking text so we can show the tail without
  // keeping a full transcript around.
  const thinkingBufRef = useRef<string>("");

  // Stable ref for onEvent so the SSE effect doesn't re-run on parent re-render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const nextSeq = () => ++seqRef.current;
  const nextUserId = () => `user:${++userCounterRef.current}`;

  // upsertMessage — the single mutation primitive for telemetry-driven
  // rows. Every handler uses this so the same event can arrive twice (SSE
  // reconnect, StrictMode remount) and the render output stays identical:
  // the second arrival just updates the existing row in place instead of
  // appending a duplicate.
  //
  // The mutator receives either the existing row or undefined (in which
  // case it must return a freshly-built row). We assign `seq` here, not in
  // the mutator, so callers can't accidentally disturb ordering.
  const upsertMessage = (
    id: string,
    mutator: (prev: ChatMessage | undefined) => Omit<ChatMessage, "id" | "seq">,
  ) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], ...mutator(next[idx]), id, seq: next[idx].seq };
        return next;
      }
      const fresh = mutator(undefined);
      return [...prev, { ...fresh, id, seq: nextSeq() }];
    });
  };

  // Render-time ordering: sort by seq defensively. Insertion already keeps
  // the array sorted (seq is monotonic and we append), so this is normally
  // a no-op — but it guarantees order even if a future handler inserts
  // out-of-order or another code path mutates the array.
  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a.seq - b.seq),
    [messages],
  );

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
        onEventRef.current(event);
      } catch {}
    };
    return () => es.close();
  }, [instanceId]);

  // Reset connection state when switching instances. The user has to
  // explicitly "Connect to chat" per instance, mirroring the CLI's explicit
  // attach model.
  useEffect(() => {
    setConnected(false);
    connectedRef.current = false;
    setMessages([]);
    seenEventsRef.current = new Set();
    seenOrderRef.current = [];
    seenToolCallsRef.current = new Set();
    seenToolCallsOrderRef.current = [];
    extractorRef.current.reset();
    streamingKeyRef.current = null;
    thinkingBufRef.current = "";
    setThinking({ active: false, preview: "" });
  }, [instanceId]);

  // Connect — mirrors the CLI handshake in apteva/client.go:91. Sends the
  // "RULES" bootstrap that tells the agent to reply via channels_respond
  // and greet the user. Only fires on explicit button click; nothing
  // happens on panel mount.
  const handleConnect = async () => {
    setMessages([]);
    const bootstrap = '[cli] root user connected via dashboard. RULES: 1) Reply to ALL [cli] messages using channels_respond(channel="cli"). 2) When the user asks you to do something, IMMEDIATELY acknowledge what you will do BEFORE doing it, then follow up with the result. 3) Never leave a message unanswered. Greet them now.';
    try {
      await instances.sendEvent(instanceId, bootstrap);
      setConnected(true);
      connectedRef.current = true;
    } catch {}
  };

  const handleDisconnect = async () => {
    try {
      await instances.sendEvent(instanceId, "[cli] root user disconnected from terminal");
    } catch {}
    setConnected(false);
    connectedRef.current = false;
  };

  // Tools that are noisy internal housekeeping — hide from the chat UI.
  // Matches the CLI's conToolRender filter spirit: keep the chat focused on
  // user-visible work (real tool calls + agent replies), not pace/done/evolve.
  const hiddenTools = new Set([
    "pace", "done", "evolve", "remember", "send",
    "channels_respond", "channels_status",
  ]);

  const handleSSEEvent = (event: TelemetryEvent) => {
    if (!connectedRef.current) return;

    // Only show main-thread events in the chat. Sub-thread tool calls
    // are internal work and would interleave confusingly with the
    // conversation.
    const threadId = event.thread_id || "main";
    if (threadId !== "main" && threadId !== "") return;

    // Monotonic insertion counter — events arrive in correct order via
    // SSE, so we use arrival order rather than server timestamps.
    // Server timestamps mixed with client Date.now() on user messages
    // caused ordering bugs due to clock skew.
    const eventTime = Date.now();

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

    // Live "thinking" indicator. llm.start opens the window; llm.thinking
    // chunks update the preview tail; llm.done / llm.error close it. Only
    // runs for the main thread (sub-threads filtered out above). The
    // indicator itself is rendered just above the input bar.
    if (event.type === "llm.start") {
      thinkingBufRef.current = "";
      setThinking({ active: true, preview: "" });
      return;
    }
    if (event.type === "llm.thinking") {
      const chunk = String(data.text || "");
      if (chunk) {
        // Keep the last ~400 chars so the preview tail stays fresh without
        // growing unbounded during long reasoning phases.
        thinkingBufRef.current = (thinkingBufRef.current + chunk).slice(-400);
        setThinking({ active: true, preview: thinkingBufRef.current });
      }
      return;
    }
    if (event.type === "llm.done" || event.type === "llm.error" || event.type === "llm.err") {
      thinkingBufRef.current = "";
      setThinking({ active: false, preview: "" });
      // fall through so future handlers can still act on llm.done if needed
    }


    // llm.tool_chunk — stream text incrementally for channels_respond.
    // The streaming row is keyed on (thread, iteration) — stable across
    // reconnects within the same turn, so duplicate/late chunks update
    // the same row instead of creating phantoms. tool.call channels_respond
    // below converts this exact row into the final agent message in place,
    // preserving its seq (and therefore its visual position).
    if (event.type === "llm.tool_chunk" && data.tool === "channels_respond") {
      const chunk = String(data.chunk || "");
      if (!chunk) return;
      const newText = extractorRef.current.feed(chunk);
      if (newText === "") return;
      const iteration = data.iteration ?? "?";
      const streamKey = `stream:${threadId}:${iteration}`;
      streamingKeyRef.current = streamKey;
      upsertMessage(streamKey, (prev) => ({
        role: "agent",
        text: (prev?.text || "") + newText,
        streaming: true,
        time: prev?.time ?? eventTime,
      }));
      return;
    }

    // channels_respond tool.call — finalize the agent reply with the
    // canonical text from the tool args. If a streaming row exists from
    // the same turn, mutate it in place (keep its seq) so the reply stays
    // where the user first saw it appear. Otherwise append fresh.
    if (event.type === "tool.call" && data.name === "channels_respond") {
      const args = data.args as Record<string, any> | undefined;
      const text = String(args?.text || "").trim();
      const channel = String(args?.channel || "cli");
      const isCli = channel === "cli";
      const streamKey = streamingKeyRef.current;
      const agentKey = `agent:${threadId}:${data.id || ""}`;

      // Non-CLI channel — the response was addressed elsewhere. Drop any
      // streaming preview we rendered and don't keep an agent row.
      if (!isCli) {
        if (streamKey) {
          setMessages((prev) => prev.filter((m) => m.id !== streamKey));
        }
        streamingKeyRef.current = null;
        extractorRef.current.reset();
        return;
      }

      setMessages((prev) => {
        // Already finalized (duplicate tool.call delivery) — update text.
        const finalIdx = prev.findIndex((m) => m.id === agentKey);
        if (finalIdx >= 0) {
          const next = prev.slice();
          next[finalIdx] = { ...next[finalIdx], text, streaming: false };
          return next;
        }
        // Streaming row present — rename to agentKey in place, keeping seq.
        if (streamKey) {
          const sIdx = prev.findIndex((m) => m.id === streamKey);
          if (sIdx >= 0) {
            const next = prev.slice();
            next[sIdx] = { ...next[sIdx], id: agentKey, text, streaming: false };
            return next;
          }
        }
        // No streaming row (no chunks ever arrived) — insert fresh.
        if (!text) return prev;
        return [...prev, {
          id: agentKey, seq: nextSeq(), role: "agent",
          text, streaming: false, time: eventTime,
        }];
      });
      streamingKeyRef.current = null;
      extractorRef.current.reset();
      return;
    }

    // channels_status — one-line agent status breadcrumb. Keyed on the
    // telemetry event id so reconnects don't duplicate the row.
    if (event.type === "tool.call" && data.name === "channels_status") {
      const args = data.args as Record<string, string> | undefined;
      if (!args?.line) return;
      const statusKey = `status:${event.id || `${threadId}:${event.time}:${data.id || ""}`}`;
      upsertMessage(statusKey, () => ({
        role: "status",
        text: args.line,
        level: args.level || "info",
        time: eventTime,
      }));
      return;
    }

    // Tool call (visible tools only) — show indicator.
    //
    // Keyed on the core's stable call id (e.g. "functions.google-sheets_read_range:87"),
    // so the matching tool.result lands on the same row. upsertMessage
    // preserves seq on update — the row stays where it first appeared.
    if (event.type === "tool.call" && data.name && !hiddenTools.has(String(data.name))) {
      const callKey = `tool:${threadId}:${data.id || ""}`;
      upsertMessage(callKey, (prev) => ({
        role: "tool",
        text: data.reason || prev?.text || "",
        toolName: data.name,
        toolDone: prev?.toolDone,
        toolDurationMs: prev?.toolDurationMs,
        toolSuccess: prev?.toolSuccess,
        time: prev?.time ?? eventTime,
      }));
      return;
    }

    // Tool result (visible tools only) — flip the matching call row to
    // done. If the result somehow precedes the call, upsertMessage still
    // inserts a placeholder; the later call handler fills in the reason
    // without disturbing toolDone/duration.
    if (event.type === "tool.result" && data.name && !hiddenTools.has(String(data.name))) {
      const callKey = `tool:${threadId}:${data.id || ""}`;
      upsertMessage(callKey, (prev) => ({
        role: "tool",
        text: prev?.text || "",
        toolName: prev?.toolName || data.name,
        toolDone: true,
        toolDurationMs: data.duration_ms,
        toolSuccess: data.success !== false,
        time: prev?.time ?? eventTime,
      }));
      return;
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");

    setMessages((prev) => [...prev, {
      id: nextUserId(), seq: nextSeq(), role: "user", text, time: Date.now(),
    }]);
    await instances.sendEvent(instanceId, `[cli] ${text}`);
  };

  // Clear the chat — mirrors the CLI's /clear command. Wipes the local
  // visible messages AND tells the agent to reset its LLM message
  // history. Memory and sub-threads are untouched, so the agent keeps
  // remembered facts but forgets the back-and-forth conversation. Useful
  // when the agent gets stuck in a tangent or you want a fresh context
  // window without losing learned state.
  const handleClear = async () => {
    setShowClearModal(false);
    setMessages([]);
    seenEventsRef.current = new Set();
    seenOrderRef.current = [];
    seenToolCallsRef.current = new Set();
    seenToolCallsOrderRef.current = [];
    try {
      await core.reset(instanceId, { history: true });
    } catch (err) {
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
          {connected && messages.length > 0 && (
            <button
              onClick={() => setShowClearModal(true)}
              title="Clear conversation history"
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

      {/* Messages — grayed out when disconnected */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 min-w-0 transition-opacity duration-300 ${connected ? "" : "opacity-30 pointer-events-none"}`}>
        {messages.length === 0 && (
          <p className="text-text-muted text-xs text-center py-8">
            {connected ? "Send a message to start chatting" : 'Click "Connect to chat" to talk with the agent'}
          </p>
        )}
        {orderedMessages.map((msg) => {
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

      {/* Thinking indicator — pinned just above the input bar whenever
          the main thread has an open llm.start window. Gives the user
          visible proof that reasoning is happening between (or before)
          tool calls and response chunks. The preview is the tail of the
          most recent llm.thinking text so the user can see WHAT the agent
          is reasoning about, not just that it's alive. */}
      {connected && thinking.active && (
        <div className="shrink-0 px-4 py-1.5 border-t border-border/50 bg-bg-card/40 flex items-start gap-2 min-w-0">
          <span className="text-accent text-[10px] shrink-0 mt-0.5 animate-pulse">●</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-accent uppercase tracking-wide font-bold">
              Thinking…
            </div>
            {thinking.preview && (
              <div className="text-[10px] text-text-muted italic leading-snug break-words line-clamp-2">
                {thinking.preview}
              </div>
            )}
          </div>
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

      {/* Clear conversation modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowClearModal(false)}>
          <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />
          <div className="relative bg-bg-card border border-border rounded-lg shadow-lg w-80 mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 space-y-3">
              <h3 className="text-text text-sm font-bold">Clear conversation</h3>
              <p className="text-text-muted text-xs leading-relaxed">
                The agent will forget the chat history. Memory and sub-threads are kept.
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
                  Clear history
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
