import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import { instances, channels, type TelemetryEvent } from "../api";

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
    const data = event.data || {};

    // channels_respond tool.call — this is the agent's final reply. Render
    // directly from the complete args, same as the CLI console logger does.
    // We used to try to stream this from llm.tool_chunk deltas via an
    // extractor, but it was fragile (escape handling, field ordering, JSON
    // state across chunks) and easy to desync. The tool.call event always
    // carries the fully-assembled args so there's no need to reassemble.
    if (event.type === "tool.call" && data.name === "channels_respond") {
      const args = data.args as Record<string, any> | undefined;
      const text = String(args?.text || "").trim();
      if (text) {
        setMessages((prev) => [...prev, {
          id: nextId(), role: "agent", text, time: Date.now(),
        }]);
      }
      return;
    }

    // channels_ask — agent is asking a question
    if (event.type === "tool.call" && data.name === "channels_ask") {
      setAsking(true);
      const args = data.args as Record<string, any> | undefined;
      const question = String(args?.question || args?.text || "").trim();
      if (question) {
        setMessages((prev) => [...prev, {
          id: nextId(), role: "agent", text: question, time: Date.now(),
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
          level: args.level || "info", time: Date.now(),
        }]);
      }
      return;
    }

    // Tool call (visible tools only) — show indicator
    if (event.type === "tool.call" && data.name && !hiddenTools.has(String(data.name))) {
      setMessages((prev) => [...prev, {
        id: `${event.thread_id}:${data.id || ""}:${nextId()}`, role: "tool", text: data.reason || "",
        toolName: data.name, time: Date.now(),
      }]);
      return;
    }

    // Tool result (visible tools only) — update indicator
    if (event.type === "tool.result" && data.name && !hiddenTools.has(String(data.name))) {
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === "tool" && updated[i].toolName === data.name && !updated[i].toolDone) {
            updated[i] = {
              ...updated[i], toolDone: true,
              toolDurationMs: data.duration_ms, toolSuccess: data.success !== false,
            };
            return updated;
          }
        }
        // No matching start — add done entry
        return [...updated, {
          id: `${event.thread_id}:${data.id || ""}:done:${nextId()}`, role: "tool", text: "", toolName: data.name,
          toolDone: true, toolDurationMs: data.duration_ms, toolSuccess: data.success !== false,
          time: Date.now(),
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

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Connection header — mirrors CLI: click to attach/detach */}
      <div className="border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green" : "bg-text-dim"}`} />
          <span className="text-text-muted text-[10px] uppercase tracking-wide">
            {connected ? "Connected to chat" : "Not connected"}
          </span>
        </div>
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

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3 min-w-0">
        {messages.length === 0 && (
          <p className="text-text-muted text-xs text-center py-8">
            {connected ? "Send a message to start chatting" : 'Click "Connect to chat" to talk with the agent'}
          </p>
        )}
        {messages.map((msg) => {
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
            if (msg.toolDone) {
              const dur = msg.toolDurationMs != null
                ? msg.toolDurationMs >= 1000 ? `${(msg.toolDurationMs / 1000).toFixed(1)}s` : `${msg.toolDurationMs}ms`
                : "";
              return (
                <div key={msg.id} className="flex items-center gap-2 px-1 text-[10px] min-w-0">
                  <span className={msg.toolSuccess ? "text-green" : "text-red"}>✓</span>
                  <span className="text-text-dim truncate">{msg.toolName}</span>
                  {dur && <span className="text-text-muted shrink-0">({dur})</span>}
                </div>
              );
            }
            return (
              <div key={msg.id} className="flex items-center gap-2 px-1 text-[10px] tool-active-line min-w-0">
                <span className="text-accent shrink-0">⟳</span>
                <span className="text-accent shrink-0">{msg.toolName}</span>
                {msg.text && <span className="text-text-muted truncate">— {msg.text}</span>}
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

      {/* Ask banner */}
      {asking && (
        <div className="border-t border-accent/30 bg-accent/5 px-4 py-1.5 text-xs text-accent">
          The agent is asking you a question — type your answer below
        </div>
      )}

      {/* Input — only active when connected to chat */}
      <div className="border-t border-border px-4 py-2">
        <form
          onSubmit={(e) => { e.preventDefault(); if (connected) handleSend(); }}
          className="flex items-center gap-2"
        >
          <span className={`font-bold text-xs ${connected ? "text-accent" : "text-text-dim"}`}>&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!connected}
            className="flex-1 bg-transparent text-xs text-text focus:outline-none min-w-0 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={!connected ? "Connect to chat to send messages" : asking ? "Type your answer..." : "Type a message..."}
            autoFocus={connected}
          />
          <button type="submit" className="text-text-muted hover:text-accent text-[10px] transition-colors shrink-0">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
