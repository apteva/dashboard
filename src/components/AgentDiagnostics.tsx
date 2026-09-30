import type { Agent, ExecutionControlStatus, Status } from "../api";
import type { AgentUsage } from "./AgentSummaryBar";
import { sleepLabel } from "../utils/sleepStatus";

function uptime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function AgentDiagnostics({ instance, status, execution, connection, usage, onActivity, onConfig }: {
  instance: Agent;
  status: Status | null;
  execution: ExecutionControlStatus;
  connection: string;
  usage: AgentUsage;
  onActivity: () => void;
  onConfig: () => void;
}) {
  const { stats, error } = usage;
  const metrics = [
    ["Model calls", stats?.llm_calls.toLocaleString()],
    ["Input tokens", stats?.total_tokens_in.toLocaleString()],
    ["Output tokens", stats?.total_tokens_out.toLocaleString()],
    ["Tool calls", stats?.tool_calls.toLocaleString()],
    ["Average model duration", stats ? `${(stats.avg_duration_ms / 1000).toFixed(2)}s` : undefined],
    ["Errors", stats?.errors.toLocaleString()],
  ];
  const runtime = [
    ["Agent", `#${instance.id}`],
    ["Status", instance.status],
    ["Telemetry", connection === "open" ? "Connected" : connection],
    ["Mode", status?.mode || instance.mode],
    ["Execution", execution.mode],
    ["Model", status?.model || "—"],
    ["Uptime", status ? uptime(status.uptime_seconds) : "—"],
    ["Iteration", status?.iteration.toLocaleString() || "—"],
    ["Threads", status?.threads.toLocaleString() || "—"],
    ["Memories", status?.memories.toLocaleString() || "—"],
    ["Wake state", status ? sleepLabel(status, { compact: true }) : "—"],
  ];
  return <div className="page-safe-bottom h-full overflow-y-auto p-3 sm:p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-text">Diagnostics</h2><p className="mt-1 text-xs text-text-muted">Runtime health, model usage and execution controls.</p></div>
      <div className="flex gap-2">
        <button type="button" onClick={onActivity} className="min-h-9 rounded-md border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-accent">View activity</button>
        <button type="button" onClick={onConfig} className="min-h-9 rounded-md border border-border px-3 text-xs text-text-muted hover:border-accent hover:text-accent">Configuration</button>
      </div>
    </div>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <section className="min-w-0 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-text">Runtime</h3>
        {!status && <p className="mt-2 text-xs text-text-muted">Live runtime stats are unavailable.</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4">{runtime.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-1 break-words text-sm text-text">{value}</dd></div>)}</dl>
      </section>
      <section className="min-w-0 rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-text">Model &amp; tool usage</h3>
        <p className="mt-1 text-xs text-text-muted">Last 24 hours · recorded telemetry</p>
        {error && <p role="status" className="mt-3 text-xs text-yellow">{stats ? "Refresh unavailable; showing the last update." : "Usage is temporarily unavailable."}</p>}
        {!stats && !error && <p className="mt-3 text-xs text-text-muted">Loading usage…</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4">{metrics.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-1 break-words text-lg font-medium tabular-nums text-text">{value ?? "—"}</dd></div>)}</dl>
      </section>
    </div>
  </div>;
}
