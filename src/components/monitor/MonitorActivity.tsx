import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { telemetry, type Agent, type TelemetryEvent } from "../../api";
import { useTelemetryEvents } from "../../hooks/useTelemetryBus";

const HISTORY_PER_AGENT = 40;
const MAX_ROWS = 320;
const HIDDEN_SYSTEM_TOOLS = new Set([
  "pace",
  "done",
  "channels_respond",
  "channels_send",
  "channels_status",
  "channels_publish",
  "channels_set_status",
]);

type ActivityCategory = "tool" | "message" | "thread" | "model" | "error";
type ActivityFilter = "significant" | "tools" | "messages" | "threads" | "errors";

interface ActivityRow {
  id: string;
  instanceId: number;
  threadId: string;
  time: number;
  category: ActivityCategory;
  title: string;
  detail?: string;
}

export function MonitorActivity({
  agents,
  scopeKey,
  projectNames,
  showProjects,
  wallboard = false,
}: {
  agents: Agent[];
  scopeKey: string;
  projectNames: Map<string, string>;
  showProjects: boolean;
  wallboard?: boolean;
}) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>("significant");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  const [lastLiveEvent, setLastLiveEvent] = useState<number | null>(null);
  const agentIds = useMemo(() => agents.map((agent) => agent.id).sort((a, b) => a - b).join(","), [agents]);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setLastLiveEvent(null);
    if (agents.length === 0) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    loadHistory(agents)
      .then((events) => {
        if (cancelled) return;
        setRows(mergeRows([], events.map(toActivityRow).filter((row): row is ActivityRow => row !== null)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // agentIds is intentionally the stable dependency: the 30-second
    // overview refresh returns new Agent objects even when membership did not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIds, scopeKey]);

  useTelemetryEvents(null, (event) => {
    if (!agentById.has(event.instance_id)) return;
    const row = toActivityRow(event);
    if (!row) return;
    setLastLiveEvent(Date.now());
    setRows((previous) => mergeRows(previous, [row]));
  });

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesFilter(row, filter)) return false;
      if (!normalized) return true;
      const agent = agentById.get(row.instanceId);
      return [row.title, row.detail, agent?.name, row.threadId]
        .some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [agentById, filter, query, rows]);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg-card">
      <header className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-text">Activity</h2>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-text-dim">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-40 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
                </span>
                {lastLiveEvent ? `live · ${formatRelative(lastLiveEvent, now)}` : "live updates"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-text-dim">Agent actions, messages, threads, and failures</p>
          </div>
          <label className="relative min-w-[190px] flex-1 sm:max-w-[270px]">
            <span className="sr-only">Search activity</span>
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search activity"
              className="h-8 w-full rounded-md border border-border bg-bg-input pl-8 pr-3 text-xs text-text outline-none placeholder:text-text-dim focus:border-accent"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-0.5">
          {([
            ["significant", "All"],
            ["tools", "Tools"],
            ["messages", "Messages"],
            ["threads", "Threads"],
            ["errors", "Errors"],
          ] as Array<[ActivityFilter, string]>).map(([value, label]) => {
            const count = rows.filter((row) => matchesFilter(row, value)).length;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${filter === value ? "bg-bg-hover text-text" : "text-text-muted hover:text-text"}`}
              >
                {label}{count > 0 && <span className="ml-1 text-[10px] text-text-dim">{count}</span>}
              </button>
            );
          })}
        </div>
      </header>

      <div className={`overflow-auto ${wallboard ? "max-h-[46vh]" : "max-h-[520px]"}`}>
        {loading && visible.length === 0 ? (
          <div className="flex min-h-[160px] items-center px-4 text-xs text-text-dim">Loading activity…</div>
        ) : visible.length === 0 ? (
          <div className="flex min-h-[160px] items-center px-4 py-6">
            <div>
              <p className="text-xs font-medium text-text-muted">No matching activity</p>
              <p className="mt-1 text-[11px] text-text-dim">New agent actions appear here in real time.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((row) => {
              const agent = agentById.get(row.instanceId);
              const tone = activityTone(row.category);
              const projectName = agent?.project_id ? projectNames.get(agent.project_id) : undefined;
              return (
                <li key={row.id}>
                  <Link
                    to={`/agents/${row.instanceId}`}
                    className="grid min-h-[62px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-hover"
                  >
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold ${tone.badge}`}>
                      {activitySymbol(row.category)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-medium text-text">{row.title}</span>
                        <span className="shrink-0 text-[10px] text-text-dim">·</span>
                        <span className="shrink-0 truncate text-[10px] text-text-muted">{agent?.name || `Agent #${row.instanceId}`}</span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-text-dim">
                        {row.detail && <span className="truncate text-text-muted">{row.detail}</span>}
                        {showProjects && projectName && (
                          <>
                            {row.detail && <span>·</span>}
                            <span className="shrink-0">{projectName}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <time className="text-[10px] tabular-nums text-text-dim" title={new Date(row.time).toLocaleString()}>
                      {formatRelative(row.time, now)}
                    </time>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

async function loadHistory(agents: Agent[]) {
  const events: TelemetryEvent[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(6, agents.length) }, async () => {
    while (nextIndex < agents.length) {
      const agent = agents[nextIndex++];
      const rows = await telemetry.query(agent.id, undefined, HISTORY_PER_AGENT).catch(() => [] as TelemetryEvent[]);
      events.push(...rows);
    }
  });
  await Promise.all(workers);
  return events;
}

function toActivityRow(event: TelemetryEvent): ActivityRow | null {
  const time = Date.parse(event.time) || Date.now();
  const base = {
    id: event.id || `${event.instance_id}-${event.thread_id}-${time}-${event.type}`,
    instanceId: event.instance_id,
    threadId: event.thread_id,
    time,
  };

  if (event.type === "tool.call") {
    const tool = String(event.data?.name || event.data?.tool || "");
    if (!tool || HIDDEN_SYSTEM_TOOLS.has(tool)) return null;
    const reason = extractReason(event.data?.args);
    return {
      ...base,
      category: "tool",
      title: reason || "Using a connected tool",
      detail: reason ? undefined : "Agent action",
    };
  }

  if (event.type === "tool.result" && event.data?.is_error) {
    const tool = String(event.data?.name || event.data?.tool || "tool");
    if (HIDDEN_SYSTEM_TOOLS.has(tool)) return null;
    return {
      ...base,
      category: "error",
      title: "Tool action failed",
      detail: truncate(String(event.data?.error || event.data?.content || "The tool returned an error"), 140),
    };
  }

  if (event.type === "event.received") {
    const message = String(event.data?.message || "");
    const match = message.match(/^\[(\w+)]\s*(.*)$/s);
    const channel = match?.[1] || "";
    const detail = match?.[2] || "";
    if (!match || ["admin", "system", "inject", "console", "chat"].includes(channel.toLowerCase())) return null;
    return {
      ...base,
      category: "message",
      title: `Message received via ${humanize(channel)}`,
      detail: truncate(detail, 140),
    };
  }

  if (event.type === "thread.spawn") {
    return {
      ...base,
      category: "thread",
      title: "Started a new thread",
      detail: String(event.data?.name || event.data?.thread_id || event.thread_id || "").trim() || undefined,
    };
  }

  if (event.type === "thread.done") {
    return {
      ...base,
      category: "thread",
      title: "Agent work completed",
      detail: String(event.data?.name || event.data?.thread_id || event.thread_id || "").trim() || undefined,
    };
  }

  if (event.type === "llm.done") {
    const tokens = Number(event.data?.tokens_out || 0);
    return {
      ...base,
      category: "model",
      title: "Response completed",
      detail: tokens > 0 ? `${tokens.toLocaleString()} output tokens` : undefined,
    };
  }

  if (event.type === "error") {
    return {
      ...base,
      category: "error",
      title: "Agent error",
      detail: truncate(String(event.data?.message || event.data?.error || "An agent error was reported"), 140),
    };
  }

  return null;
}

function matchesFilter(row: ActivityRow, filter: ActivityFilter) {
  if (filter === "significant") return true;
  if (filter === "tools") return row.category === "tool";
  if (filter === "messages") return row.category === "message";
  if (filter === "threads") return row.category === "thread";
  return row.category === "error";
}

function mergeRows(previous: ActivityRow[], incoming: ActivityRow[]) {
  const byId = new Map<string, ActivityRow>();
  for (const row of [...previous, ...incoming]) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.time - a.time).slice(0, MAX_ROWS);
}

function extractReason(args: unknown) {
  if (!args) return "";
  if (typeof args === "object") {
    const value = (args as Record<string, unknown>)._reason;
    return typeof value === "string" ? truncate(value.trim(), 140) : "";
  }
  if (typeof args !== "string") return "";
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return typeof parsed._reason === "string" ? truncate(parsed._reason.trim(), 140) : "";
  } catch {
    return "";
  }
}

function activityTone(category: ActivityCategory) {
  if (category === "error") return { badge: "bg-red/15 text-red" };
  if (category === "message") return { badge: "bg-blue/15 text-blue" };
  if (category === "thread") return { badge: "bg-green/15 text-green" };
  if (category === "model") return { badge: "bg-bg-hover text-text-muted" };
  return { badge: "bg-accent/15 text-accent" };
}

function activitySymbol(category: ActivityCategory) {
  if (category === "error") return "!";
  if (category === "message") return "↑";
  if (category === "thread") return "✓";
  if (category === "model") return "✦";
  return "›";
}

function formatRelative(time: number, now: number) {
  const age = Math.max(0, now - time);
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}
