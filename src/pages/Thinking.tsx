import { useState, useEffect, useRef } from "react";
import { useSSE } from "../hooks/useSSE";
import { core, type Status } from "../api";

export function Thinking() {
  const events = useSSE();
  const [status, setStatus] = useState<Status | null>(null);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("main");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const poll = () => core.status().then(setStatus).catch(() => {});
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const sendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      core.sendEvent(input.trim());
      setInput("");
    }
  };

  // Group thoughts by thread
  const thoughts = events.filter(
    (e) => e.type === "thought" && e.thread_id === activeTab
  );

  // Get unique thread IDs
  const threadIds = [...new Set(events.filter((e) => e.type === "thought").map((e) => e.thread_id))];
  if (!threadIds.includes("main")) threadIds.unshift("main");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-text-muted text-xs">// THINKING</span>
          {status && (
            <span className="text-text-dim text-xs">
              {status.rate}/{status.model} │ iter #{status.iteration} │ {status.threads} thr │ {status.memories} mem
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border px-4 py-1 flex gap-1 overflow-x-auto">
        {threadIds.map((id) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-3 py-1 text-xs rounded-t transition-colors ${
              activeTab === id
                ? "text-accent bg-bg-hover border-b-2 border-accent"
                : "text-text-muted hover:text-text"
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      {/* Thought stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {thoughts.length === 0 && (
          <div className="text-text-muted text-xs">waiting for thoughts...</div>
        )}
        {thoughts.map((t, i) => (
          <div key={i}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-accent text-xs font-bold">━━━ #{t.iteration}</span>
              {t.duration && (
                <span className="text-text-muted text-xs">({t.duration})</span>
              )}
            </div>
            <div className="text-sm text-text whitespace-pre-wrap leading-relaxed">
              {t.message}
            </div>
          </div>
        ))}
      </div>

      {/* Console input */}
      <form onSubmit={sendCommand} className="border-t border-border px-4 py-3 flex gap-2">
        <span className="text-accent text-sm">{">"}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-transparent text-sm text-text focus:outline-none"
          placeholder="send command..."
        />
        <button
          type="submit"
          className="text-xs text-text-muted hover:text-accent transition-colors"
        >
          [send]
        </button>
      </form>
    </div>
  );
}
