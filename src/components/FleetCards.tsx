import { useState, useEffect } from "react";
import type { Thread } from "../api";
import type { FleetEvent } from "./FleetGraph";

interface FleetCardsProps {
  threads: Thread[];
  activeTools: Record<string, string>;
  thoughts: Record<string, string>;
  events?: FleetEvent[];
}

// Sort threads into depth-first tree order
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

export function FleetCards({ threads, activeTools, thoughts, events = [] }: FleetCardsProps) {
  // Track recent messages for green flash (threadId → expiry)
  const [messageFlash, setMessageFlash] = useState<Record<string, number>>({});

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];
    if (!latest || latest.type !== "message") return;
    setMessageFlash((prev) => ({ ...prev, [latest.to]: Date.now() + 3000 }));
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
    }, 500);
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

  return (
    <div className="h-full overflow-y-auto p-3 space-y-1.5">
      {ordered.map((t) => {
        const depth = t.depth || 0;
        const tool = activeTools[t.id];
        const thought = thoughts[t.id];
        const hasMessage = (messageFlash[t.id] || 0) > Date.now();
        const isActive = !!tool;
        const isMain = t.id === "main";

        const borderColor = hasMessage
          ? "border-l-green"
          : isActive
          ? "border-l-accent"
          : isMain
          ? "border-l-accent/40"
          : "border-l-border";

        const bgColor = hasMessage
          ? "bg-green/5"
          : isActive
          ? "bg-accent/5"
          : "bg-bg-card";

        return (
          <div
            key={t.id}
            style={{ marginLeft: `${depth * 16}px` }}
            className={`
              border border-border ${borderColor} border-l-2 rounded-lg px-3 py-2 ${bgColor}
              transition-all duration-300 text-xs
              ${hasMessage ? "shadow-[0_0_8px_rgba(34,197,94,0.15)]" : ""}
              ${isActive ? "shadow-[0_0_8px_rgba(249,115,22,0.1)]" : ""}
            `}
          >
            {/* Header row */}
            <div className="flex items-center gap-2">
              {depth > 0 && <span className="text-text-dim text-[10px]">├</span>}
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  hasMessage
                    ? "bg-green animate-pulse"
                    : isActive
                    ? "bg-accent animate-pulse"
                    : "bg-green/50"
                }`}
              />
              <span className="text-text font-bold">{t.id}</span>

              {/* Status */}
              <div className="ml-auto flex items-center gap-2 text-text-muted">
                {isActive ? (
                  <span className="text-accent">⟳ {tool}</span>
                ) : (
                  <span>#{t.iteration} {t.rate}</span>
                )}
              </div>
            </div>

            {/* Thought */}
            {thought && !hasMessage && (
              <p className="text-text-dim mt-1 text-[10px] italic leading-relaxed line-clamp-2">
                {thought}
              </p>
            )}

            {/* Message flash */}
            {hasMessage && (
              <p className="text-green mt-1 text-[10px]">
                ← message received
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
