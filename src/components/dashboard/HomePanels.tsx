import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Agent, CurrentStatusMessageRow, InstanceStats } from "../../api";

export function HomeLiveAgents({
  agents,
  statuses,
}: {
  agents: Agent[];
  statuses: CurrentStatusMessageRow[];
}) {
  const statusByAgent = useMemo(
    () => new Map(statuses.map((row) => [row.instance_id, row])),
    [statuses],
  );
  const live = useMemo(() => agents
    .map((agent) => {
      const reported = statusByAgent.get(agent.id);
      const activeStatus = reported && reported.state !== "completed" && !reported.stale ? reported : undefined;
      return { agent, status: activeStatus };
    })
    .filter(({ agent, status }) => !!status || agent.status === "running")
    .sort((a, b) => {
      return liveRank(a.agent, a.status) - liveRank(b.agent, b.status) || a.agent.name.localeCompare(b.agent.name);
    })
    .slice(0, 5), [agents, statusByAgent]);

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-card xl:h-[460px]">
      <PanelHeader
        title="Live now"
        subtitle="Current work and running agents"
        count={live.length}
        to="/monitor"
      />
      {live.length === 0 ? (
        <EmptyState title="No active work reported" detail="Running agents and new work will appear here." />
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {live.map(({ agent, status }) => (
            <LiveAgentRow key={agent.id} agent={agent} status={status} />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomeUsageSummary({ agents, stats }: { agents: Agent[]; stats: InstanceStats[] }) {
  const totals = stats.reduce(
    (acc, row) => ({
      llmCalls: acc.llmCalls + row.llm_calls,
      toolCalls: acc.toolCalls + row.tool_calls,
      tokens: acc.tokens + row.tokens_in + row.tokens_out,
      cost: acc.cost + row.cost,
      errors: acc.errors + row.errors,
    }),
    { llmCalls: 0, toolCalls: 0, tokens: 0, cost: 0, errors: 0 },
  );
  const running = agents.filter((agent) => agent.status === "running").length;

  return (
    <section className="rounded-lg border border-border bg-bg-card px-3 py-2.5 sm:px-4">
      <div className="grid gap-3 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-center">
        <h2 className="whitespace-nowrap text-[10px] font-bold uppercase tracking-wide text-text-dim">Last 24 hours</h2>
        <div className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-x-3">
          <Metric label="Agents" value={`${running} / ${agents.length}`} warn={agents.length > 0 && running === 0} />
          <Metric label="LLM calls" value={formatNumber(totals.llmCalls)} />
          <Metric label="Tool calls" value={formatNumber(totals.toolCalls)} />
          <Metric label="Tokens" value={formatTokens(totals.tokens)} />
          <Metric label="Errors" value={String(totals.errors)} warn={totals.errors > 0} />
          <Metric label="Cost" value={formatCost(totals.cost)} />
        </div>
        <Link to="/analytics" className="text-[11px] text-text-muted hover:text-text">View usage →</Link>
      </div>
    </section>
  );
}

function PanelHeader({
  title,
  subtitle,
  count,
  to,
  linkLabel = "View operations",
}: {
  title: string;
  subtitle: string;
  count: number;
  to: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-text">{title}</h2>
          {count > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-text-muted">
              {count}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-text-dim">{subtitle}</p>
      </div>
      <Link to={to} className="shrink-0 pt-0.5 text-[11px] text-text-muted hover:text-text">
        {linkLabel} →
      </Link>
    </div>
  );
}

function LiveAgentRow({ agent, status }: { agent: Agent; status?: CurrentStatusMessageRow }) {
  const state = status?.state || "running";
  const tone = stateTone(state);
  return (
    <Link
      to={`/agents/${agent.id}`}
      className="grid min-h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-bg-hover"
    >
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold ${tone.badge}`}>
        {state === "blocked" ? "!" : state === "waiting" ? "◷" : "›"}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-semibold text-text">{agent.name}</span>
          <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide ${tone.text}`}>{state}</span>
          {status?.progress != null && (
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-text-dim">{Math.round(status.progress)}%</span>
          )}
        </div>
        <p className="mt-1 truncate text-[11px] text-text-muted" title={status?.detail || undefined}>
          {status?.title || "Running without active work reported"}
        </p>
        {status?.progress != null && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-hover">
            <div className={`h-full ${tone.bar}`} style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }} />
          </div>
        )}
      </div>
      {status ? (
        <time className="text-[10px] tabular-nums text-text-dim" title={formatExact(status.message.created_at)}>
          {formatAge(status.message.created_at)}
        </time>
      ) : (
        <span className="text-sm text-text-dim">→</span>
      )}
    </Link>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-[112px] items-center px-4 py-5">
      <div>
        <p className="text-xs font-medium text-text-muted">{title}</p>
        <p className="mt-1 text-[11px] text-text-dim">{detail}</p>
      </div>
    </div>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-l border-border/70 pl-2.5 first:border-l-0 first:pl-0 xl:justify-start">
      <div className="truncate text-[9px] uppercase tracking-wide text-text-dim">{label}</div>
      <div className={`shrink-0 text-sm font-bold tabular-nums ${warn ? "text-red" : "text-text"}`}>{value}</div>
    </div>
  );
}

function liveRank(agent: Agent, status?: CurrentStatusMessageRow) {
  if (status?.state === "blocked") return 0;
  if (status?.state === "working") return 1;
  if (status?.state === "waiting") return 2;
  if (agent.status === "running") return 3;
  return 4;
}

function stateTone(state: string) {
  if (state === "blocked" || state === "error") return { badge: "bg-red/15 text-red", text: "text-red", bar: "bg-red" };
  if (state === "waiting") return { badge: "bg-blue/15 text-blue", text: "text-blue", bar: "bg-blue" };
  if (state === "completed") return { badge: "bg-green/15 text-green", text: "text-green", bar: "bg-green" };
  return { badge: "bg-accent/15 text-accent", text: "text-accent", bar: "bg-accent" };
}

function formatAge(value: string) {
  const ms = Date.now() - Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function formatExact(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatNumber(value: number) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatTokens(value: number) {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

function formatCost(value: number) {
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}
