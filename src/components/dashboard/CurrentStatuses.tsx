import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { chat, type CurrentStatusMessageRow } from "../../api";

export function useCurrentStatuses(projectId?: string) {
  const [rows, setRows] = useState<CurrentStatusMessageRow[]>([]);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    chat.currentStatuses(projectId).then(setRows).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    load();
    const onStatus = () => {
      setNow(Date.now());
      load();
    };
    window.addEventListener("apteva.statusMessage", onStatus);
    window.addEventListener("apteva.chatStreamRecovered", onStatus);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      load();
    }, 60_000);
    return () => {
      window.removeEventListener("apteva.statusMessage", onStatus);
      window.removeEventListener("apteva.chatStreamRecovered", onStatus);
      window.clearInterval(timer);
    };
  }, [load]);

  return useMemo(() => ageCurrentStatusRows(rows, now), [rows, now]);
}

export function CurrentStatuses({ projectId }: { projectId?: string }) {
  const rows = useCurrentStatuses(projectId);
  const ordered = useMemo(
    () => [...rows].sort((a, b) => statusRank(a) - statusRank(b) || Date.parse(b.message.created_at) - Date.parse(a.message.created_at)),
    [rows],
  );

  return (
    <section className="border border-border rounded-lg bg-bg-card overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-text text-sm font-bold">Latest status</h2>
            <p className="mt-0.5 text-[11px] text-text-dim">Latest work reported by agents</p>
          </div>
          <span className="text-[11px] tabular-nums text-text-dim">{ordered.length} reported</span>
        </div>
      </div>
      {ordered.length === 0 ? (
        <div className="px-4 py-6 text-xs text-text-dim">No agent status reported yet.</div>
      ) : (
        <div className="divide-y divide-border">
          {ordered.map((row) => (
            <Link
              key={row.instance_id}
              to={`/agents/${row.instance_id}`}
              className="grid min-h-[68px] grid-cols-[minmax(120px,0.8fr)_minmax(0,2fr)_auto] items-center gap-4 px-4 py-2.5 hover:bg-bg-hover transition-colors"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-text">{row.instance_name}</div>
                <div className="mt-1 text-[10px] text-text-dim">#{row.instance_id}</div>
              </div>
              <StatusContent status={row} />
              <time className="text-[10px] tabular-nums text-text-dim" title={formatExact(row.message.created_at)}>
                {formatAge(row.message.created_at)}
              </time>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function AgentCurrentStatus({
  status,
  compact = false,
  embedded = false,
  showFallback = false,
  showAge = false,
  showNextFallback = false,
}: {
  status?: CurrentStatusMessageRow;
  compact?: boolean;
  embedded?: boolean;
  showFallback?: boolean;
  showAge?: boolean;
  showNextFallback?: boolean;
}) {
  if (!status && !showFallback) return null;
  const containerClass = compact
    ? `min-w-0 ${showAge && showNextFallback ? "min-h-[66px]" : ""}`
    : embedded
      ? "min-w-0"
      : "mt-2 max-w-3xl min-w-0";
  return (
    <div className={containerClass}>
      {showAge && (
        <div className="mb-1.5 min-h-3 text-left text-[9px] text-text-dim">
          {status && (
            <time title={formatExact(status.message.created_at)}>
              {status.stale ? "last reported" : "updated"} {formatRelativeAge(status.message.created_at)}
            </time>
          )}
        </div>
      )}
      {status ? (
        <StatusContent status={status} compact={compact} showNextFallback={showNextFallback} />
      ) : (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-xs text-text-dim">
            <StatusMarker stale />
            <span className="truncate">No current status reported</span>
          </div>
          {showNextFallback && <NextStepRow />}
        </div>
      )}
    </div>
  );
}

function StatusContent({
  status,
  compact = false,
  showNextFallback = false,
}: {
  status: CurrentStatusMessageRow;
  compact?: boolean;
  showNextFallback?: boolean;
}) {
  const tone = statusTone(status.state, status.stale);
  return (
    <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
      <div className={status.progress != null ? "-mt-0.5 self-start" : "self-center"}>
        <StatusMarker state={status.state} stale={status.stale} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 text-[10px] font-bold uppercase ${tone.text}`}>{status.state}</span>
          <span className={`truncate text-xs ${compact ? "text-text-muted" : "font-medium text-text"}`}>{status.title}</span>
          {status.progress != null && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-text-dim">{Math.round(status.progress)}%</span>}
        </div>
        {!compact && status.detail && <p className="mt-1 truncate text-[11px] text-text-muted">{status.detail}</p>}
        {status.progress != null && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-hover">
            <div className={`h-full ${tone.bar}`} style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }} />
          </div>
        )}
        {(status.next || showNextFallback) && <NextStepRow next={status.next} nextAt={status.next_at} />}
      </div>
    </div>
  );
}

function NextStepRow({ next, nextAt }: { next?: string; nextAt?: string }) {
  const label = next?.trim() || "No pending work";
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-4">
      <span className="shrink-0 font-bold uppercase text-text-dim">Next</span>
      <span className={`truncate ${next ? "text-text-muted" : "text-text-dim"}`} title={next || undefined}>{label}</span>
      {next && nextAt && (
        <time className="ml-auto shrink-0 tabular-nums text-text-dim" title={formatExact(nextAt)}>
          {formatNextAt(nextAt)}
        </time>
      )}
    </div>
  );
}

function StatusMarker({
  state,
  stale = false,
}: {
  state?: CurrentStatusMessageRow["state"];
  stale?: boolean;
}) {
  const tone = statusTone(state || "waiting", stale);
  const symbol = !state ? "–" : state === "completed" ? "✓" : state === "blocked" ? "!" : "…";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none ${tone.badge}`}
    >
      {state === "working" ? (
        <span
          className={`h-2.5 w-2.5 rounded-full border ${
            stale
              ? "border-text-dim/30 border-t-text-dim"
              : "animate-spin border-accent/30 border-t-accent motion-reduce:animate-none"
          }`}
        />
      ) : state === "waiting" ? (
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6" cy="6" r="4.25" />
          <path d="M6 3.75V6l1.75 1" />
        </svg>
      ) : (
        symbol
      )}
    </span>
  );
}

function statusTone(state: CurrentStatusMessageRow["state"], stale: boolean) {
  if (stale) return { bar: "bg-text-dim", badge: "bg-text-dim/15 text-text-dim", text: "text-text-dim" };
  if (state === "blocked") return { bar: "bg-red", badge: "bg-red/15 text-red", text: "text-red" };
  if (state === "waiting") return { bar: "bg-blue", badge: "bg-blue/15 text-blue", text: "text-blue" };
  if (state === "completed") return { bar: "bg-green", badge: "bg-green/15 text-green", text: "text-green" };
  return { bar: "bg-accent", badge: "bg-accent/15 text-accent", text: "text-accent" };
}

function statusRank(row: CurrentStatusMessageRow) {
  if (row.stale) return 4;
  if (row.state === "blocked") return 0;
  if (row.state === "working") return 1;
  if (row.state === "waiting") return 2;
  return 3;
}

const CURRENT_STATUS_STALE_MS = 30 * 60_000;

export function ageCurrentStatusRows(rows: CurrentStatusMessageRow[], now: number) {
  return rows.map((row) => {
    const createdAt = Date.parse(row.message.created_at);
    if (!Number.isFinite(createdAt)) return row;
    const age = Math.max(0, now - createdAt);
    if (row.state !== "completed" && age > CURRENT_STATUS_STALE_MS && !row.stale) {
      return { ...row, stale: true };
    }
    if (row.state === "completed" && row.stale) return { ...row, stale: false };
    return row;
  });
}

function formatAge(value: string) {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function formatRelativeAge(value: string) {
  const age = formatAge(value);
  return age === "now" ? "just now" : `${age} ago`;
}

function formatNextAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const remaining = timestamp - Date.now();
  if (remaining > 0) {
    const minutes = Math.max(1, Math.ceil(remaining / 60_000));
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `in ${hours}h`;
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExact(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
