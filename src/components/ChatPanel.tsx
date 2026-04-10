import { useState, useEffect, useRef } from "react";
import { instances, channels, type TelemetryEvent } from "../api";

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

// Text extractor for streaming tool args (same logic as CLI)
class TextExtractor {
  private buf = "";
  private inText = false;
  private emitted = 0;

  feed(chunk: string): string {
    this.buf += chunk;
    if (!this.inText) {
      const idx = this.buf.indexOf('"text":"');
      if (idx >= 0) {
        this.inText = true;
        this.emitted = 0;
        this.buf = this.buf.slice(idx + 8);
      } else {
        return "";
      }
    }
    // Extract text content, handling escapes
    let result = "";
    let i = this.emitted;
    while (i < this.buf.length) {
      if (this.buf[i] === "\\") {
        if (i + 1 < this.buf.length) {
          const next = this.buf[i + 1];
          if (next === "n") result += "\n";
          else if (next === "t") result += "\t";
          else if (next === '"') result += '"';
          else if (next === "\\") result += "\\";
          else result += next;
          i += 2;
        } else {
          break; // incomplete escape
        }
      } else if (this.buf[i] === '"') {
        break; // end of text value
      } else {
        result += this.buf[i];
        i++;
      }
    }
    this.emitted = i;
    return result;
  }

  reset() {
    this.buf = "";
    this.inText = false;
    this.emitted = 0;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const extractorRef = useRef(new TextExtractor());
  const msgIdRef = useRef(0);

  const nextId = () => String(++msgIdRef.current);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource(`/telemetry/stream?instance_id=${instanceId}`);
    es.onmessage = (e) => {
      try {
        const event: TelemetryEvent = JSON.parse(e.data);
        handleSSEEvent(event);
        onEvent(event);
      } catch {}
    };
    return () => es.close();
  }, [instanceId]);

  const handleSSEEvent = (event: TelemetryEvent) => {
    const data = event.data || {};

    // Streaming text for channels_respond
    if (event.type === "llm.tool_chunk") {
      const tool = data.tool as string;
      const chunk = data.chunk as string;
      if (tool !== "channels_respond" || !chunk) return;

      const newText = extractorRef.current.feed(chunk);
      if (!newText) return;

      setMessages((prev) => {
        // Find existing streaming agent message
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "agent" && prev[i].streaming) {
            const updated = [...prev];
            updated[i] = { ...updated[i], text: updated[i].text + newText };
            return updated;
          }
        }
        // Start new streaming message
        return [...prev, { id: nextId(), role: "agent", text: newText, streaming: true, time: Date.now() }];
      });
      return;
    }

    // channels_respond tool result — finalize stream
    if (event.type === "tool.result" && data.name === "channels_respond") {
      extractorRef.current.reset();
      setMessages((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === "agent" && updated[i].streaming) {
            updated[i] = { ...updated[i], streaming: false };
            return updated;
          }
        }
        return updated;
      });
      return;
    }

    // channels_ask — agent is asking a question
    if (event.type === "tool.call" && data.name === "channels_ask") {
      setAsking(true);
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

    // Tool call (non-channels) — show indicator
    if (event.type === "tool.call" && data.name && !String(data.name).startsWith("channels_")) {
      setMessages((prev) => [...prev, {
        id: `${event.thread_id}:${data.id || ""}:${nextId()}`, role: "tool", text: data.reason || "",
        toolName: data.name, time: Date.now(),
      }]);
      return;
    }

    // Tool result (non-channels) — update indicator
    if (event.type === "tool.result" && data.name && !String(data.name).startsWith("channels_")) {
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
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-text-muted text-sm text-center py-8">Send a message to start chatting</p>
        )}
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="bg-accent/15 border border-accent/30 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[75%]">
                  <p className="text-text text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            );
          }

          if (msg.role === "agent") {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[75%]">
                  <p className="text-text text-sm whitespace-pre-wrap leading-relaxed">
                    {msg.text}
                    {msg.streaming && <span className="tool-cursor">▊</span>}
                  </p>
                </div>
              </div>
            );
          }

          if (msg.role === "tool") {
            if (msg.toolDone) {
              const dur = msg.toolDurationMs != null
                ? msg.toolDurationMs >= 1000 ? `${(msg.toolDurationMs / 1000).toFixed(1)}s` : `${msg.toolDurationMs}ms`
                : "";
              return (
                <div key={msg.id} className="flex items-center gap-2 px-2 text-xs">
                  <span className={msg.toolSuccess ? "text-green" : "text-red"}>✓</span>
                  <span className="text-text-dim">{msg.toolName}</span>
                  {dur && <span className="text-text-muted">({dur})</span>}
                </div>
              );
            }
            return (
              <div key={msg.id} className="flex items-center gap-2 px-2 text-xs tool-active-line">
                <span className="text-accent">⟳</span>
                <span className="text-accent">{msg.toolName}</span>
                {msg.text && <span className="text-text-muted">— {msg.text}</span>}
              </div>
            );
          }

          if (msg.role === "status") {
            const icon = msg.level === "alert" ? "🚨" : msg.level === "warn" ? "⚠️" : "ℹ";
            return (
              <div key={msg.id} className="text-center text-xs text-text-muted py-1">
                {icon} {msg.text}
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Ask banner */}
      {asking && (
        <div className="border-t border-accent/30 bg-accent/5 px-4 py-2 text-sm text-accent">
          The agent is asking you a question — type your answer below
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border px-4 py-3">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-3"
        >
          <span className="text-accent font-bold text-sm">&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-transparent text-sm text-text focus:outline-none"
            placeholder={asking ? "Type your answer..." : "Type a message..."}
            autoFocus
          />
          <button type="submit" className="text-text-muted hover:text-accent text-sm transition-colors">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
