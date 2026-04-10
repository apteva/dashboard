import { useState, useEffect, useRef } from "react";
import { telemetry, type TelemetryEvent, type Thread } from "../api";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  thread: Thread | null;
  instanceId: number;
  liveEvents: TelemetryEvent[]; // live SSE events filtered to this thread
}

type Tab = "live" | "history";

export function ThreadDetailModal({ open, onClose, thread, instanceId, liveEvents }: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [history, setHistory] = useState<TelemetryEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll live feed
  useEffect(() => {
    if (tab === "live" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveEvents, tab]);

  // Load history when switching to history tab
  useEffect(() => {
    if (!open || !thread || tab !== "history") return;
    setLoadingHistory(true);
    telemetry.query(instanceId, undefined, 200, thread.id).then((events) => {
      setHistory(events.reverse()); // oldest first
      setLoadingHistory(false);
    }).catch(() => setLoadingHistory(false));
  }, [open, thread?.id, tab, instanceId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTab("live");
      setHistory([]);
    }
  }, [open]);

  if (!thread) return null;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green/60" />
              <h3 className="text-text font-bold text-sm">{thread.id}</h3>
              <span className="text-text-dim text-[10px] bg-border px-1.5 py-0.5 rounded">#{thread.iteration}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                thread.rate === "fast" || thread.rate === "reactive" ? "bg-accent/15 text-accent" :
                thread.rate === "sleep" ? "bg-border text-text-dim" : "bg-border text-text-muted"
              }`}>{thread.rate}</span>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text text-sm">x</button>
          </div>
          {/* Meta row */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-dim">
            {thread.parent_id && <span>parent: <span className="text-text-muted">{thread.parent_id}</span></span>}
            {thread.model && <span>model: <span className="text-text-muted">{thread.model}</span></span>}
            {thread.mcp_names && thread.mcp_names.length > 0 && (
              <span className="flex gap-1">
                {thread.mcp_names.map((m) => (
                  <span key={m} className="px-1 py-0.5 rounded bg-accent/10 text-accent/70">MCP {m}</span>
                ))}
              </span>
            )}
          </div>
          {/* Directive */}
          {thread.directive && (
            <p className="mt-2 text-[10px] text-text-dim leading-relaxed line-clamp-2">{thread.directive}</p>
          )}
          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {(["live", "history"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 text-xs rounded-t transition-colors capitalize ${
                  tab === t ? "bg-bg text-accent border border-border border-b-0" : "text-text-muted hover:text-text"
                }`}
              >
                {t}{t === "live" ? ` (${liveEvents.length})` : ""}
              </button>
            ))}
          </div>
        </div>

        {/* Event feed */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {tab === "live" && liveEvents.length === 0 && (
            <p className="text-text-muted text-xs text-center py-8">Waiting for events...</p>
          )}
          {tab === "history" && loadingHistory && (
            <p className="text-text-muted text-xs text-center py-8">Loading...</p>
          )}
          {(tab === "live" ? liveEvents : history).map((ev, i) => (
            <EventRow key={ev.id || i} event={ev} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function EventRow({ event }: { event: TelemetryEvent }) {
  const data = event.data || {};
  const time = event.time ? new Date(event.time).toLocaleTimeString() : "";

  // Tool call
  if (event.type === "tool.call") {
    const name = data.name || "?";
    const reason = data.reason || "";
    return (
      <div className="flex items-start gap-2 text-xs py-1">
        <span className="text-accent shrink-0">></span>
        <div className="min-w-0">
          <span className="text-accent font-medium">{name}</span>
          {reason && <span className="text-text-dim ml-1.5">{reason}</span>}
        </div>
        <span className="text-text-muted text-[10px] ml-auto shrink-0">{time}</span>
      </div>
    );
  }

  // Tool result
  if (event.type === "tool.result") {
    const name = data.name || "?";
    const dur = data.duration_ms != null
      ? data.duration_ms >= 1000 ? `${(data.duration_ms / 1000).toFixed(1)}s` : `${data.duration_ms}ms`
      : "";
    const ok = data.success !== false;
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span className={ok ? "text-green" : "text-red"}>
          {ok ? "+" : "x"}
        </span>
        <span className="text-text-dim">{name}</span>
        {dur && <span className="text-text-muted text-[10px]">({dur})</span>}
        <span className="text-text-muted text-[10px] ml-auto">{time}</span>
      </div>
    );
  }

  // LLM done (thought)
  if (event.type === "llm.done") {
    const msg = String(data.message || "").slice(0, 120);
    const tokens = (data.tokens_in || 0) + (data.tokens_out || 0);
    return (
      <div className="flex items-start gap-2 text-xs py-1">
        <span className="text-text-muted shrink-0">~</span>
        <div className="min-w-0">
          <p className="text-text-dim italic leading-relaxed truncate">{msg || "(no output)"}</p>
          {tokens > 0 && (
            <span className="text-text-muted text-[10px]">
              {data.tokens_in}in/{data.tokens_out}out
              {data.cost_usd ? ` $${data.cost_usd.toFixed(4)}` : ""}
            </span>
          )}
        </div>
        <span className="text-text-muted text-[10px] ml-auto shrink-0">{time}</span>
      </div>
    );
  }

  // Thread spawn/done
  if (event.type === "thread.spawn" || event.type === "thread.done") {
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span className={event.type === "thread.spawn" ? "text-green" : "text-red"}>
          {event.type === "thread.spawn" ? "+" : "-"}
        </span>
        <span className="text-text-dim">{event.type}</span>
        <span className="text-text-muted text-[10px] ml-auto">{time}</span>
      </div>
    );
  }

  // Event received (messages from other threads)
  if (event.type === "event.received") {
    const msg = String(data.message || "").slice(0, 100);
    return (
      <div className="flex items-start gap-2 text-xs py-1">
        <span className="text-green shrink-0">@</span>
        <p className="text-text-dim min-w-0 truncate">{msg}</p>
        <span className="text-text-muted text-[10px] ml-auto shrink-0">{time}</span>
      </div>
    );
  }

  // Generic fallback
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <span className="text-text-muted">.</span>
      <span className="text-text-dim">{event.type}</span>
      <span className="text-text-muted text-[10px] ml-auto">{time}</span>
    </div>
  );
}
