import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { telemetry, type UsageGroup, type UsageGroupBy, type UsagePeriod, type UsageReport } from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { AgentUsagePanel } from "../components/usage/AgentUsagePanel";
import { UsageBreakdown } from "../components/usage/UsageBreakdown";
import { UsageChart } from "../components/usage/UsageChart";
import {
  PERIOD_LABELS,
  PREVIOUS_LABELS,
  cacheShare,
  chartSeries,
  defaultMetric,
  errorRate,
  formatCount,
  formatMoney,
  formatPercent,
  percentChange,
  type UsageMetric,
} from "../components/usage/usageFormat";

// Usage: what the agents cost and consumed over a period, for the current
// project or every project. All numbers come from one /telemetry/usage
// report so totals, the chart and the breakdown always agree.

const PERIODS: UsagePeriod[] = ["24h", "7d", "30d"];
const REFRESH_MS = 60_000;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function Delta({ current, previous, period }: { current: number; previous: number; period: UsagePeriod }) {
  const change = percentChange(current, previous);
  if (current === 0 && previous === 0) return <span className="text-text-dim">No activity in {PREVIOUS_LABELS[period]} either</span>;
  if (change === null) return <span className="text-text-dim">New vs {PREVIOUS_LABELS[period]}</span>;
  const rounded = Math.round(change);
  if (rounded === 0) return <span className="text-text-dim">Flat vs {PREVIOUS_LABELS[period]}</span>;
  return (
    <span className="text-text-dim">
      <span className="text-text-muted">{rounded > 0 ? "▲" : "▼"} {Math.abs(rounded) > 999 ? ">999" : Math.abs(rounded)}%</span> vs {PREVIOUS_LABELS[period]}
    </span>
  );
}

function Tile({ label, value, note, delta }: { label: string; value: string; note?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-4 py-3">
      <p className="text-xs text-text-dim">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-text">{value}</p>
      {note && <p className="mt-0.5 text-xs text-text-muted">{note}</p>}
      {delta && <p className="mt-1.5 text-[11px]">{delta}</p>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, labels, onChange, label }: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 rounded-md border border-border bg-bg-card p-0.5" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={value === option}
          onClick={() => onChange(option)}
          className={`touch-target rounded px-3 py-1 text-xs transition-colors ${
            value === option ? "bg-bg-hover font-semibold text-text" : "text-text-muted hover:text-text"
          }`}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

export function Analytics() {
  usePageTitle("Usage");
  const { currentProject } = useProjects();
  const [params, setParams] = useSearchParams();

  const allProjects = params.get("scope") === "all";
  const period = pick(params.get("period"), PERIODS, "7d");
  const groupings: UsageGroupBy[] = allProjects ? ["agent", "model", "provider", "project"] : ["agent", "model", "provider"];
  const groupBy = pick(params.get("group"), groupings, "agent");
  const projectId = allProjects ? undefined : currentProject?.id;

  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState("");
  const [metricChoice, setMetricChoice] = useState<UsageMetric | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const update = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }, [params, setParams]);

  const waitingForProject = !allProjects && !currentProject;
  useEffect(() => {
    if (waitingForProject) return;
    let cancelled = false;
    const load = () => {
      telemetry.usage(projectId, period, groupBy)
        .then((next) => { if (!cancelled) { setReport(next); setError(""); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load usage"); });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, period, groupBy, waitingForProject]);

  // A report for another grouping is stale for the current controls.
  const current = report && report.group_by === groupBy && report.period === period ? report : null;
  const totals = current?.totals;
  const hasIncluded = Boolean(totals && totals.included_cost > 0);
  const metrics: UsageMetric[] = hasIncluded ? ["cost", "value", "tokens", "calls"] : ["cost", "tokens", "calls"];
  const metric = metricChoice && metrics.includes(metricChoice) ? metricChoice : totals ? defaultMetric(totals) : "cost";
  const series = useMemo(() => (current ? chartSeries(current, metric) : []), [current, metric]);

  const selected = current && groupBy === "agent" ? current.groups.find((g) => g.key === selectedKey) : undefined;
  const selectGroup = (group: UsageGroup) => setSelectedKey(group.key);
  const scopeName = allProjects ? "All projects" : currentProject?.name || "Current project";
  const monthly = current ? current.daily_run_rate * 30 : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text">Usage</h1>
          <p className="mt-0.5 text-xs text-text-dim">{scopeName} · {PERIOD_LABELS[period]}</p>
        </div>
        <div className="flex max-w-full flex-wrap gap-2">
          <Segmented
            label="Scope"
            value={allProjects ? "all" : "project"}
            options={["project", "all"] as const}
            labels={{ project: "This project", all: "All projects" }}
            onChange={(value) => update({ scope: value === "all" ? "all" : null, group: value === "project" && groupBy === "project" ? null : params.get("group") })}
          />
          <Segmented
            label="Period"
            value={period}
            options={PERIODS}
            labels={{ "24h": "24h", "7d": "7 days", "30d": "30 days" }}
            onChange={(value) => update({ period: value === "7d" ? null : value })}
          />
        </div>
      </header>

      <div className="page-safe-bottom flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {error && !current && (
          <div className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{error}</div>
        )}
        {!current && !error && <p className="text-sm text-text-muted">Loading…</p>}

        {current && totals && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Tile
                label="Spend"
                value={formatMoney(totals.cost)}
                note={hasIncluded
                  ? `+${formatMoney(totals.included_cost)} covered by subscriptions`
                  : totals.unpriced_calls > 0 ? `${formatCount(totals.unpriced_calls)} calls not priced` : "Billed per token"}
                delta={<Delta current={totals.cost} previous={current.previous.cost} period={period} />}
              />
              <Tile
                label="Tokens"
                value={formatCount(totals.tokens_in + totals.tokens_out)}
                note={`${formatPercent(cacheShare(totals))} of input from cache`}
                delta={<Delta current={totals.tokens_in + totals.tokens_out} previous={current.previous.tokens_in + current.previous.tokens_out} period={period} />}
              />
              <Tile
                label="Calls"
                value={formatCount(totals.calls)}
                note={totals.errors > 0
                  ? <span className="text-red">{formatCount(totals.errors)} errors · {formatPercent(errorRate(totals.errors, totals.calls))}</span>
                  : `${totals.active_agents} of ${current.agents} agents active`}
                delta={<Delta current={totals.calls} previous={current.previous.calls} period={period} />}
              />
              <Tile
                label="Monthly estimate"
                value={monthly > 0 ? formatMoney(monthly) : "–"}
                note={monthly > 0
                  ? `Billed run-rate of the last ${current.run_rate_days >= 7 ? "7" : Math.max(1, Math.round(current.run_rate_days))} days`
                  : "No billed spend in the last 7 days"}
              />
            </div>

            <UsageChart report={current} metric={metric} metrics={metrics} onMetricChange={setMetricChoice} />

            <UsageBreakdown
              report={current}
              metric={metric}
              groupBy={groupBy}
              groupings={groupings}
              onGroupByChange={(value) => { setSelectedKey(null); update({ group: value === "agent" ? null : value }); }}
              onSelect={groupBy === "agent" ? selectGroup : undefined}
            />

            {totals.unpriced_calls > 0 && (
              <p className="text-[11px] text-text-dim">
                Spend excludes {formatCount(totals.unpriced_calls)} calls whose model has no price in the pricing table.
              </p>
            )}
          </>
        )}
      </div>

      {current && selected && (
        <AgentUsagePanel
          report={current}
          group={selected}
          metric={metric}
          color={series.find((s) => s.key === selected.key)?.color || "var(--series-other)"}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
}
