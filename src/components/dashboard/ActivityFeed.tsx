import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { telemetry, type Agent, type TelemetryEvent } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { useTelemetryEvents } from "../../hooks/useTelemetryBus";

const MAX_ROWS = 80;
const HISTORY_PER_AGENT = 10;
const HIDDEN_SYSTEM_TOOLS = new Set([
  "pace",
  "done",
  "channels_respond",
  "channels_send",
  "channels_status",
  "channels_publish",
  "channels_set_status",
]);

interface Row {
  id: string;
  instanceId: number;
  type: string;
  time: number;
  category: "tool" | "channel" | "error" | "thread";
  title: string;
  detail?: string;
}

export function ActivityFeed({
  agents,
}: {
  agents: Agent[];
}) {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const nameById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    if (!projectId || agents.length === 0) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    Promise.all(
      agents.map((agent) => telemetry.query(agent.id, undefined, HISTORY_PER_AGENT).catch(() => [] as TelemetryEvent[])),
    ).then((history) => {
      if (cancelled) return;
      const initial = history
        .flat()
        .map(toSignificantRow)
        .filter((row): row is Row => row !== null);
      setRows(mergeRows([], initial));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [agents, projectId]);

  useTelemetryEvents(projectId ? null : undefined, (event: TelemetryEvent) => {
    const row = toSignificantRow(event);
    if (!row) return;
    setRows((previous) => mergeRows(previous, [row]));
  });

  const visible = rows.slice(0, 8);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-text">Recent activity</h2>
            {visible.length > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted">
                {visible.length}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-text-dim">Significant agent and tool events</p>
        </div>
        <Link to="/monitor?view=activity" className="shrink-0 pt-0.5 text-[11px] text-text-muted hover:text-text">
          View operations →
        </Link>
      </div>

      {loading && visible.length === 0 ? (
        <div className="flex min-h-[112px] items-center px-4 text-xs text-text-dim">Loading recent activity…</div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[112px] items-center px-4 py-5">
          <div>
            <p className="text-xs font-medium text-text-muted">No significant activity yet</p>
            <p className="mt-1 text-[11px] text-text-dim">Agent actions and errors will appear here.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((row) => {
            const tone = rowTone(row.category);
            return (
              <li key={row.id}>
                <Link
                  to={`/agents/${row.instanceId}`}
                  className="grid min-h-[58px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-hover"
                >
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold ${tone.badge}`}>
                    {row.category === "error" ? "!" : row.category === "channel" ? "↑" : row.category === "thread" ? "✓" : "›"}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs font-medium text-text">{row.title}</span>
                      <span className="shrink-0 text-[10px] text-text-dim">·</span>
                      <span className="shrink-0 text-[10px] text-text-muted">
                        {nameById.get(row.instanceId) || `Agent #${row.instanceId}`}
                      </span>
                    </div>
                    {row.detail && <p className="mt-1 truncate text-[11px] text-text-muted">{row.detail}</p>}
                  </div>
                  <time className="text-[10px] tabular-nums text-text-dim" title={new Date(row.time).toLocaleString()}>
                    {formatRelative(row.time)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function toSignificantRow(event: TelemetryEvent): Row | null {
  const time = Date.parse(event.time) || Date.now();
  const id = event.id || `${event.instance_id}-${time}-${event.type}`;

  if (event.type === "tool.call") {
    const tool = String(event.data?.name || event.data?.tool || "");
    if (!tool || HIDDEN_SYSTEM_TOOLS.has(tool)) return null;
    const reason = extractReason(event.data?.args);
    if (!reason) return null;
    return {
      id,
      instanceId: event.instance_id,
      type: event.type,
      time,
      category: "tool",
      title: reason,
      detail: humanizeTool(tool),
    };
  }

  if (event.type === "tool.result" && event.data?.is_error) {
    const tool = String(event.data?.name || event.data?.tool || "tool");
    if (HIDDEN_SYSTEM_TOOLS.has(tool)) return null;
    return {
      id,
      instanceId: event.instance_id,
      type: event.type,
      time,
      category: "error",
      title: `${humanizeTool(tool)} failed`,
      detail: truncate(String(event.data?.error || event.data?.content || ""), 100),
    };
  }

  if (event.type === "event.received") {
    const message = String(event.data?.message || "");
    const match = message.match(/^\[(\w+)]\s*(.*)$/s);
    const channel = match?.[1] || "";
    const detail = match?.[2] || "";
    if (!match || ["admin", "system", "inject", "console"].includes(channel) || /^\[(chat|system|admin)]/i.test(detail)) return null;
    return {
      id,
      instanceId: event.instance_id,
      type: event.type,
      time,
      category: "channel",
      title: `Message received via ${channel}`,
      detail: truncate(detail, 100),
    };
  }

  if (event.type === "thread.done") {
    return {
      id,
      instanceId: event.instance_id,
      type: event.type,
      time,
      category: "thread",
      title: "Agent work completed",
      detail: String(event.data?.name || "").trim() || undefined,
    };
  }

  if (event.type === "error") {
    return {
      id,
      instanceId: event.instance_id,
      type: event.type,
      time,
      category: "error",
      title: "Agent error",
      detail: truncate(String(event.data?.message || event.data?.error || ""), 100),
    };
  }

  return null;
}

function mergeRows(previous: Row[], incoming: Row[]) {
  const byId = new Map<string, Row>();
  for (const row of [...previous, ...incoming]) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.time - a.time).slice(0, MAX_ROWS);
}

function extractReason(args: unknown) {
  if (!args) return "";
  if (typeof args === "object") {
    const reason = (args as Record<string, unknown>)._reason;
    return typeof reason === "string" ? truncate(reason.trim(), 110) : "";
  }
  if (typeof args !== "string") return "";
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    return typeof parsed._reason === "string" ? truncate(parsed._reason.trim(), 110) : "";
  } catch {
    return "";
  }
}

function humanizeTool(tool: string) {
  const leaf = tool.includes("__") ? tool.split("__").pop() || tool : tool;
  return leaf.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rowTone(category: Row["category"]) {
  if (category === "error") return { badge: "bg-red/15 text-red" };
  if (category === "channel") return { badge: "bg-blue/15 text-blue" };
  if (category === "thread") return { badge: "bg-green/15 text-green" };
  return { badge: "bg-accent/15 text-accent" };
}

function formatRelative(time: number) {
  const age = Math.max(0, Date.now() - time);
  if (age < 60_000) return "now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

function truncate(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}
