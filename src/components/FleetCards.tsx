import { useState, useEffect } from "react";
import type { Thread } from "../api";
import type { FleetEvent } from "./FleetGraph";

interface FleetCardsProps {
  threads: Thread[];
  activeTools: Record<string, string>;
  thoughts: Record<string, string>;
  events?: FleetEvent[];
}

interface RecentTool {
  threadId: string;
  name: string;
  done: boolean;
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

// Tree connector lines
function TreePrefix({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <div className="flex items-center shrink-0 text-text-dim select-none" style={{ width: `${depth * 20}px` }}>
      {Array.from({ length: depth - 1 }).map((_, i) => (
        <span key={i} className="w-5 inline-block border-l border-border h-full" />
      ))}
      <span className="w-5 inline-block">├─</span>
    </div>
  );
}

export function FleetCards({ threads, activeTools, thoughts, events = [] }: FleetCardsProps) {
  const [messageFlash, setMessageFlash] = useState<Record<string, number>>({});
  const [recentTools, setRecentTools] = useState<RecentTool[]>([]);

  // Track messages
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    if (!latest || latest.type !== "message") return;
    setMessageFlash((prev) => ({ ...prev, [latest.to]: Date.now() + 3000 }));
  }, [events.length]);

  // Track tool calls from events
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    if (!latest || latest.type !== "tool") return;
    setRecentTools((prev) => [
      ...prev.slice(-20),
      { threadId: latest.from, name: latest.text || "", done: false, time: Date.now() },
    ]);
    // Auto-mark done after 3s
    setTimeout(() => {
      setRecentTools((prev) =>
        prev.map((t) =>
          t.time === latest.time && t.name === latest.text ? { ...t, done: true } : t
        )
      );
    }, 3000);
  }, [events.length]);

  // Decay flashes
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
      // Clean old tools
      setRecentTools((prev) => prev.filter((t) => Date.now() - t.time < 30000));
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

  // Recent tools per thread
  const toolsByThread: Record<string, RecentTool[]> = {};
  for (const t of recentTools) {
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
          <div key={t.id} className="flex" style={{ paddingLeft: `${depth * 24}px` }}>
            {/* Tree connector */}
            {depth > 0 && (
              <div className="flex items-start pt-3 mr-1 text-border select-none text-xs">
                ├─
              </div>
            )}

            {/* Card */}
            <div
              className={`
                flex-1 rounded-xl border-l-[3px] border border-border
                transition-all duration-500
                ${hasMessage ? "border-l-green bg-green/8 shadow-[0_0_16px_rgba(34,197,94,0.2)]" : ""}
                ${isActive && !hasMessage ? "border-l-accent bg-accent/8 shadow-[0_0_16px_rgba(249,115,22,0.15)]" : ""}
                ${!isActive && !hasMessage && isMain ? "border-l-accent/50 bg-bg-card" : ""}
                ${!isActive && !hasMessage && !isMain ? "border-l-border bg-bg-card" : ""}
              `}
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300 ${
                    hasMessage ? "bg-green animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]" :
                    isActive ? "bg-accent animate-pulse shadow-[0_0_6px_rgba(249,115,22,0.5)]" :
                    "bg-green/40"
                  }`}
                />
                <span className="text-text font-bold text-sm">{t.id}</span>
                {isMain && <span className="text-text-dim text-[10px] bg-accent/10 px-1.5 py-0.5 rounded">coordinator</span>}

                <div className="ml-auto flex items-center gap-3 text-text-muted text-xs">
                  <span>#{t.iteration}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    t.rate === "reactive" || t.rate === "fast" ? "bg-accent/15 text-accent" :
                    t.rate === "sleep" ? "bg-border text-text-dim" :
                    "bg-border text-text-muted"
                  }`}>
                    {t.rate}
                  </span>
                </div>
              </div>

              {/* Active tool — prominent */}
              {isActive && (
                <div className="px-4 pb-2">
                  <div className="flex items-center gap-2 text-accent text-sm font-medium">
                    <span className="animate-spin text-xs">⟳</span>
                    <span>{tool}</span>
                  </div>
                </div>
              )}

              {/* Recent tool calls for this thread */}
              {threadTools.length > 0 && !isActive && (
                <div className="px-4 pb-2">
                  <div className="flex flex-wrap gap-1.5">
                    {threadTools.slice(-4).map((tt, i) => (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all ${
                          tt.done
                            ? "bg-green/10 text-green/70"
                            : "bg-accent/15 text-accent"
                        }`}
                      >
                        {tt.done ? "✓" : "⟳"} {tt.name.replace("onboarding_", "").replace("cms_", "")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Thought */}
              {thought && !hasMessage && (
                <div className="px-4 pb-3">
                  <p className="text-text-dim text-xs italic leading-relaxed line-clamp-2">
                    {thought}
                  </p>
                </div>
              )}

              {/* Message flash */}
              {hasMessage && (
                <div className="px-4 pb-3">
                  <p className="text-green text-xs font-medium">
                    ← message received
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
