import { useState, useEffect } from "react";
import type { Thread } from "../api";
import type { SubscribeFn } from "./InstanceView";

interface FleetCardsProps {
  threads: Thread[];
  subscribe: SubscribeFn; // synchronous event fan-out from InstanceView
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

export function FleetCards({ threads, subscribe, activeTools, thoughts }: FleetCardsProps) {
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [messageFlash, setMessageFlash] = useState<Record<string, { from: string; text: string; expiry: number }>>({});

  // Process SSE events — subscribe synchronously so no chunks are lost.
  useEffect(() => {
    return subscribe((event) => {
      const data = event.data || {};

    const hiddenTools = new Set(["send", "pace", "done", "evolve", "remember", "channels_respond", "channels_status"]);
    const toolName = String(data.name || "");
    const showTool = event.thread_id && toolName && !hiddenTools.has(toolName) && !toolName.startsWith("channels_");

    if (event.type === "tool.call" && showTool) {
      setTools((prev) => [...prev, {
        threadId: event.thread_id, name: toolName, done: false, time: Date.now(),
      }].slice(-30));
    }

    if (event.type === "tool.result" && showTool) {
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
      const match = msg.match(/\[from:(\S+)\]\s*(.*)/);
      if (match) {
        const from = match[1];
        let text = match[2] || "";
        if (text.length > 80) text = text.slice(0, 80) + "…";
        setMessageFlash((prev) => ({ ...prev, [event.thread_id]: { from, text, expiry: Date.now() + 4000 } }));
      }
    }
    });
  }, [subscribe]);

  // Decay flashes + prune old tools
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessageFlash((prev) => {
        const next: Record<string, { from: string; text: string; expiry: number }> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiry > now) next[k] = v;
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
        const msgData = messageFlash[t.id];
        const hasMessage = !!msgData && msgData.expiry > Date.now();
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
                flex-1 rounded-xl border-l-[3px] border border-border transition-colors duration-500 min-h-[64px]
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

              {/* MCP servers */}
              {(t.mcp_names?.length || 0) > 0 && (
                <div className="px-4 pb-2">
                  <div className="flex flex-wrap gap-1">
                    {t.mcp_names!.map((mcp) => (
                      <span key={mcp} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-accent/8 text-accent/70 border border-accent/20">
                        ⚡ {mcp}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Directive preview — always show unless message flash */}
              {t.directive && !hasMessage && (
                <div className="px-4 pb-1">
                  <p className="text-text-dim text-[10px] leading-relaxed line-clamp-1 opacity-60">{t.directive}</p>
                </div>
              )}

              {/* Thought */}
              {thought && !hasMessage && (
                <div className="px-4 pb-3">
                  <p className="text-text-dim text-xs italic leading-relaxed line-clamp-2">{thought}</p>
                </div>
              )}

              {/* Message flash */}
              {hasMessage && msgData && (
                <div className="px-4 pb-3">
                  <p className="text-green text-xs">
                    <span className="font-medium">← {msgData.from}</span>
                    {msgData.text && <span className="text-green/70 ml-1.5 italic">{msgData.text}</span>}
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
