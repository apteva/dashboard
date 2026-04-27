// Cross-instance live activity feed. Subscribes to the existing
// project-wide telemetry SSE (/telemetry/stream?all=1&project_id=…)
// and renders a rolling window of the most recent events as a single
// timeline. Filter tabs let the user narrow to tools / thoughts /
// errors. Each row links to the originating instance.
//
// Two design choices worth flagging:
//   1. We keep at most MAX_ROWS in memory, dropping the oldest as new
//      ones arrive. The dashboard isn't a log search tool — it's a
//      live pulse. /agents/:id has the deep telemetry view.
//   2. Filtering is purely client-side. The SSE delivers everything,
//      tabs just show/hide rows. Switching tabs is instant and the
//      counts stay accurate.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { instances, BASE, type Instance, type TelemetryEvent } from "../../api";
import { useProjects } from "../../hooks/useProjects";

const MAX_ROWS = 200;

type Tab = "all" | "tools" | "thoughts" | "errors";

interface Row {
  id: string;
  instanceId: number;
  threadId: string;
  type: string;
  time: number;
  category: "tool" | "thought" | "channel" | "error" | "other";
  icon: string;
  title: string;
  detail?: string;
  ok?: boolean;
}

export function ActivityFeed() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [rows, setRows] = useState<Row[]>([]);
  const [nameById, setNameById] = useState<Map<number, string>>(new Map());
  const [tab, setTab] = useState<Tab>("all");
  const [connected, setConnected] = useState(false);

  // Resolve instance id → name once on mount and every 30s. The SSE
  // doesn't carry names; we annotate rows on render.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      instances.list(projectId).then((list: Instance[]) => {
        if (cancelled) return;
        setNameById(new Map(list.map((i) => [i.id, i.name])));
      }).catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Single SSE for the whole project. Reconnect handled by the
  // browser's EventSource implementation; we just rebuild the URL
  // when the project changes.
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    const url = `${BASE}/telemetry/stream?all=1${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ""}`;
    // Cookie-based session auth — same-origin so no withCredentials.
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const ev: TelemetryEvent = JSON.parse(e.data);
        const row = toRow(ev);
        if (!row) return;
        setRows((prev) => {
          // Prepend, cap. Newest first.
          const next = [row, ...prev];
          return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
        });
      } catch {
        // malformed frame — EventSource auto-reconnects.
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [projectId]);

  const filtered = rows.filter((r) => matches(r, tab));

  return (
    <div className="border border-border rounded-lg flex flex-col min-h-[300px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="text-xs text-text-dim uppercase tracking-wide">
            Activity
          </div>
          <div
            className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green" : "bg-text-dim"}`}
            title={connected ? "live" : "disconnected"}
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(["all", "tools", "thoughts", "errors"] as Tab[]).map((t) => {
            const count = t === "all" ? rows.length : rows.filter((r) => matches(r, t)).length;
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2 py-1 rounded ${active ? "text-text bg-bg-hover" : "text-text-muted hover:text-text"}`}
              >
                {t}{count > 0 && <span className="ml-1 text-text-dim">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[420px]">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-text-dim text-sm">
              {connected ? "waiting for events…" : "connecting…"}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => (
              <li
                key={r.id}
                className="px-3 py-1.5 hover:bg-bg-hover transition-colors text-xs flex items-start gap-2 font-mono"
              >
                <span className="text-text-dim w-12 shrink-0">{fmtTime(r.time)}</span>
                <span className={`shrink-0 ${iconColor(r)}`}>{r.icon}</span>
                <Link
                  to={`/instances/${r.instanceId}`}
                  className="shrink-0 text-text-muted hover:text-text truncate max-w-[100px]"
                  title={nameById.get(r.instanceId) || `#${r.instanceId}`}
                >
                  {nameById.get(r.instanceId) || `#${r.instanceId}`}
                </Link>
                <span className={`flex-1 truncate ${r.category === "error" ? "text-yellow" : "text-text"}`}>
                  {r.title}
                  {r.detail && (
                    <span className="text-text-muted ml-2">{r.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// toRow normalises the heterogenous telemetry event types into a
// single shape the feed renders. Returns null for events we don't
// want to surface (e.g. `llm.thinking` mid-token chunks would flood
// the feed; only `llm.start` / `llm.done` are worth showing).
function toRow(ev: TelemetryEvent): Row | null {
  const t = Date.parse(ev.time) || Date.now();
  const id = ev.id || `${ev.instance_id}-${t}-${ev.type}`;

  switch (ev.type) {
    case "tool.call":
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: "tool",
        icon: "⚡",
        title: String(ev.data?.name || ev.data?.tool || "tool"),
        detail: argsPreview(ev.data?.args),
      };
    case "tool.result":
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: ev.data?.is_error ? "error" : "tool",
        icon: ev.data?.is_error ? "✗" : "✓",
        ok: !ev.data?.is_error,
        title: String(ev.data?.name || ev.data?.tool || "tool"),
        detail: ev.data?.is_error ? truncate(String(ev.data?.error || ev.data?.content || ""), 80) : undefined,
      };
    case "llm.done":
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: "thought",
        icon: "✦",
        title: String(ev.data?.model || "llm"),
        detail: `${ev.data?.tokens_in ?? 0}↑ ${ev.data?.tokens_out ?? 0}↓ ${ev.data?.duration_ms ?? 0}ms`,
      };
    case "event.received": {
      const msg = String(ev.data?.message || "");
      // Only surface user-facing channel events, not internal signals
      // like [admin] / [system].
      const m = msg.match(/^\[(\w+)\] (.*)$/s);
      if (!m) return null;
      const channel = m[1];
      if (!channel) return null;
      if (["admin", "system", "inject"].includes(channel)) return null;
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: "channel",
        icon: "↑",
        title: `[${channel}]`,
        detail: truncate(m[2] || "", 80),
      };
    }
    case "thread.spawn":
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: "thought",
        icon: "→",
        title: "spawn",
        detail: String(ev.data?.name || ev.data?.thread_id || ""),
      };
    case "thread.done":
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: "thought",
        icon: "✓",
        title: "thread done",
        detail: String(ev.data?.thread_id || ev.thread_id),
      };
    case "error":
      return {
        id, instanceId: ev.instance_id, threadId: ev.thread_id, type: ev.type, time: t,
        category: "error",
        icon: "⚠",
        title: "error",
        detail: truncate(String(ev.data?.message || ev.data?.error || ""), 100),
      };
    default:
      return null; // skip noise (llm.thinking, llm.start, llm.tool_chunk, etc.)
  }
}

function matches(r: Row, tab: Tab): boolean {
  switch (tab) {
    case "all": return true;
    case "tools": return r.category === "tool";
    case "thoughts": return r.category === "thought";
    case "errors": return r.category === "error";
  }
}

function iconColor(r: Row): string {
  switch (r.category) {
    case "tool": return "text-accent";
    case "thought": return "text-text-muted";
    case "channel": return "text-blue";
    case "error": return "text-yellow";
    default: return "text-text-dim";
  }
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toTimeString().slice(0, 5); // HH:MM in local time
}

function argsPreview(args: any): string | undefined {
  if (!args) return undefined;
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    return truncate(s, 60);
  } catch {
    return undefined;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
