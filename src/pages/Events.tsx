import { useEffect, useRef } from "react";
import { useSSE } from "../hooks/useSSE";

export function Events() {
  const events = useSSE();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const typeColor = (type: string) => {
    switch (type) {
      case "thought": return "text-text";
      case "reply": return "text-accent";
      case "thread_started": return "text-green";
      case "thread_done": return "text-red";
      case "error": return "text-red";
      case "evolved": return "text-blue";
      default: return "text-text-muted";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <span className="text-text-muted text-xs">// EVENTS</span>
          <span className="text-text-dim text-xs ml-3">{events.length} events</span>
        </div>
        <span className="text-green text-xs">● live</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono">
        {events.length === 0 && (
          <div className="text-text-muted text-xs">waiting for events...</div>
        )}
        {events.map((e, i) => {
          const time = e.time ? new Date(e.time).toLocaleTimeString() : "";
          const msg = e.message && e.message.length > 120
            ? e.message.substring(0, 120) + "..."
            : e.message;

          return (
            <div key={i} className="flex gap-3 py-0.5 text-xs hover:bg-bg-hover">
              <span className="text-text-muted w-16 shrink-0">{time}</span>
              <span className={`w-20 shrink-0 ${typeColor(e.type)}`}>{e.type}</span>
              <span className="text-text-dim w-20 shrink-0 truncate">{e.thread_id}</span>
              <span className="text-text truncate">{msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
