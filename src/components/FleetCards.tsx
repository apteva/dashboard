import { useState, useEffect } from "react";
import type { Thread, TelemetryEvent } from "../api";

interface FleetCardsProps {
  threads: Thread[];
  event: TelemetryEvent | null; // same SSE event that ActivityPanel gets
  activeTools: Record<string, string>;
  thoughts: Record<string, string>;
}

interface ToolEntry {
  threadId: string;
  name: string;
  done: boolean;
  durationMs?: number;
  success?: boolean;
  time: number;
}

function orderTree(threads: Thread[]): Thread[] {
  const children: Record<string, Thread[]> = {};
  const roots: Thread[] = [];
  for (const t of threads) {
    if (t.id === "main" || (!t.parent_id && !t.depth)) {
      roots.push(t);
    } else {
      const pid = t.parent_id || "main";
      if (!children[pid]) children[pid] = [];
      children[pid].push(t);
    }
  }
  const result: Thread[] = [];
  const walk = (node: Thread) => {
    result.push(node);
    for (const child of children[node.id] || []) walk(child);
  };
  for (const root of roots) walk(root);
  const seen = new Set(result.map((t) => t.id));
  for (const t of threads) {
    if (!seen.has(t.id)) result.push(t);
  }
  return result;
}

export function FleetCards({ threads, event, activeTools, thoughts }: FleetCardsProps) {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [messageFlash, setMessageFlash] = useState<Record<string, number>>({});

  // Process SSE events — same logic as ActivityPanel
  useEffect(() => {
    if (!event) return;
    const data = event.data || {};

    if (event.type === "tool.call" && data.name && !String(data.name).startsWith("channels_")) {
      setTools((prev) => [...prev, {
        threadId: event.thread_id, name: data.name, done: false, time: Date.now(),
      }].slice(-30));
    }

    if (event.type === "tool.result" && data.name && !String(data.name).startsWith("channels_")) {
      setTools((prev) => {
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (!updated[i].done && updated[i].name === data.name && updated[i].threadId === event.thread_id) {
            updated[i] = { ...updated[i], done: true, durationMs: data.duration_ms, success: data.success !== false };
            return updated;
          }
        }
        return updated;
      });
    }

    // Message flash from event.received
    if (event.type === "event.received" && data.source === "thread") {
      const msg = String(data.message || "");
      const match = msg.match(/\[from:(\S+)\]/);
      if (match) {
        setMessageFlash((prev) => ({ ...prev, [event.thread_id]: Date.now() + 3000 }));
      }
    }
  }, [event]);

  // Decay flashes + prune old tools
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessageFlash((prev) => {
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v > now) next[k] = v;
        }
        return Object.keys(next).length !== Object.keys(prev).length ? next : prev;
      });
      setTools((prev) => prev.filter((t) => Date.now() - t.time < 30000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No threads running
      </div>
    );
  }

  const ordered = orderTree(threads);

  // Group tools by thread
  const toolsByThread: Record<string, ToolEntry[]> = {};
  for (const t of tools) {
    if (!toolsByThread[t.threadId]) toolsByThread[t.threadId] = [];
    toolsByThread[t.threadId].push(t);
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-2">
      {ordered.map((t) => {
        const depth = t.id === "main" ? 0 : (t.depth || 0) + 1;
        const tool = activeTools[t.id];
        const thought = thoughts[t.id];
        const hasMessage = (messageFlash[t.id] || 0) > Date.now();
        const isActive = !!tool;
        const isMain = t.id === "main";
        const threadTools = toolsByThread[t.id] || [];

        return (
          <div key={t.id} className="flex" style={{ paddingLeft: `${depth * 14}px` }}>
            {depth > 0 && (
              <div className="flex items-start pt-3 mr-1 text-border select-none text-xs">├─</div>
            )}

            <div
              className={`
                flex-1 rounded-xl border-l-[3px] border border-border transition-all duration-500
                ${hasMessage ? "border-l-green bg-green/8 shadow-[0_0_16px_rgba(34,197,94,0.2)]" : ""}
                ${isActive && !hasMessage ? "border-l-accent bg-accent/8 shadow-[0_0_16px_rgba(249,115,22,0.15)]" : ""}
                ${!isActive && !hasMessage && isMain ? "border-l-accent/50 bg-bg-card" : ""}
                ${!isActive && !hasMessage && !isMain ? "border-l-border bg-bg-card" : ""}
              `}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300 ${
                  hasMessage ? "bg-green animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]" :
                  isActive ? "bg-accent animate-pulse shadow-[0_0_6px_rgba(249,115,22,0.5)]" :
                  "bg-green/40"
                }`} />
                <span className="text-text font-bold text-sm">{t.id}</span>
                {isMain && <span className="text-text-dim text-[10px] bg-accent/10 px-1.5 py-0.5 rounded">coordinator</span>}
                <div className="ml-auto flex items-center gap-3 text-text-muted text-xs">
                  <span>#{t.iteration}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    t.rate === "reactive" || t.rate === "fast" ? "bg-accent/15 text-accent" :
                    t.rate === "sleep" ? "bg-border text-text-dim" :
                    "bg-border text-text-muted"
                  }`}>{t.rate}</span>
                </div>
              </div>

              {/* Active tool */}
              {isActive && (
                <div className="px-4 pb-2">
                  <div className="flex items-center gap-2 text-accent text-sm font-medium">
                    <span className="animate-spin text-xs">⟳</span>
                    <span>{tool}</span>
                  </div>
                </div>
              )}

              {/* Recent tool calls */}
              {threadTools.length > 0 && (
                <div className="px-4 pb-2">
                  <div className="flex flex-wrap gap-1.5">
                    {threadTools.slice(-6).map((tt, i) => {
                      const dur = tt.durationMs != null
                        ? tt.durationMs >= 1000 ? `${(tt.durationMs / 1000).toFixed(1)}s` : `${tt.durationMs}ms`
                        : "";
                      const shortName = tt.name.replace(/^onboarding_|^cms_/, "");
                      return (
                        <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-all ${
                          tt.done
                            ? tt.success !== false ? "bg-green/10 text-green" : "bg-red/10 text-red"
                            : "bg-accent/15 text-accent animate-pulse"
                        }`}>
                          {tt.done ? (tt.success !== false ? "✓" : "✗") : "⟳"}
                          {" "}{shortName}
                          {dur && <span className="text-text-dim ml-0.5">({dur})</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Thought */}
              {thought && !hasMessage && (
                <div className="px-4 pb-3">
                  <p className="text-text-dim text-xs italic leading-relaxed line-clamp-2">{thought}</p>
                </div>
              )}

              {/* Message flash */}
              {hasMessage && (
                <div className="px-4 pb-3">
                  <p className="text-green text-xs font-medium">← message received</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
