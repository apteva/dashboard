import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { telemetry, type UsageGroup, type UsageGroupBy, type UsageReport } from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { AgentUsagePanel } from "../components/usage/AgentUsagePanel";
import { UsageBreakdown } from "../components/usage/UsageBreakdown";
import { UsageChart } from "../components/usage/UsageChart";
import {
  MAX_RANGE_DAYS,
  PRESET_LABELS,
  cacheShare,
  chartSeries,
  errorRate,
  formatCount,
  formatMoney,
  formatPercent,
  formatRangeLabel,
  isLocalDate,
  localDate,
  percentChange,
  presetRange,
  previousLabel,
  rangeDays,
  type UsageMetric,
  type UsagePreset,
} from "../components/usage/usageFormat";

// Usage: what the agents cost and consumed over a date range, for every
// project or one of them. All numbers come from one /telemetry/usage report
// so totals, the chart and the breakdown always agree. The server picks
// hourly, daily or weekly bars from the length of the range.

const PRESETS: UsagePreset[] = ["today", "7d", "30d", "90d", "custom"];
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const REFRESH_MS = 60_000;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function Delta({ current, previous, against }: { current: number; previous: number; against: string }) {
  const change = percentChange(current, previous);
  if (current === 0 && previous === 0) return <span className="text-text-dim">None {against === "yesterday" ? "yesterday" : `in the ${against}`} either</span>;
  if (change === null) return <span className="text-text-dim">New vs {against}</span>;
  const rounded = Math.round(change);
  if (rounded === 0) return <span className="text-text-dim">Flat vs {against}</span>;
  return (
    <span className="text-text-dim">
      <span className="text-text-muted">{rounded > 0 ? "▲" : "▼"} {Math.abs(rounded) > 999 ? ">999" : Math.abs(rounded)}%</span> vs {against}
    </span>
  );
}

function shiftDate(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

// From/to date inputs for a custom range. Keeps from <= to <= today and the
// span within what the server accepts.
function DateRangeInputs({ from, to, today, onChange }: {
  from: string;
  to: string;
  today: string;
  onChange: (from: string, to: string) => void;
}) {
  const input = "h-8 rounded-md border border-border bg-bg-input px-2 text-xs text-text focus:border-accent focus:outline-none";
  const set = (nextFrom: string, nextTo: string, moved: "from" | "to") => {
    if (!isLocalDate(nextFrom) || !isLocalDate(nextTo)) return;
    if (nextTo > today) nextTo = today;
    if (nextFrom > nextTo) [nextFrom, nextTo] = moved === "from" ? [nextFrom, nextFrom] : [nextTo, nextTo];
    if (rangeDays(nextFrom, nextTo) > MAX_RANGE_DAYS) {
      if (moved === "from") nextTo = shiftDate(nextFrom, MAX_RANGE_DAYS - 1);
      else nextFrom = shiftDate(nextTo, -(MAX_RANGE_DAYS - 1));
    }
    onChange(nextFrom, nextTo);
  };
  return (
    <div className="flex items-center gap-1.5 text-xs text-text-dim">
      <input type="date" aria-label="From" className={input} value={from} max={today} onChange={(e) => set(e.target.value, to, "from")} />
      <span aria-hidden="true">–</span>
      <input type="date" aria-label="To" className={input} value={to} max={today} onChange={(e) => set(from, e.target.value, "to")} />
    </div>
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
  const { projects } = useProjects();
  const [params, setParams] = useSearchParams();

  const today = localDate(new Date());
  const projectId = projects.find((p) => p.id === params.get("project"))?.id;
  const groupings: UsageGroupBy[] = projectId ? ["agent", "model", "provider"] : ["agent", "model", "provider", "project"];
  const groupBy = pick(params.get("group"), groupings, "agent");
  const preset = pick(params.get("range"), PRESETS, "7d");
  const custom = preset === "custom" && isLocalDate(params.get("from")) && isLocalDate(params.get("to"))
    ? { from: params.get("from")!, to: params.get("to")! }
    : null;
  const { from, to } = custom || presetRange(preset === "custom" ? "7d" : preset);
  const queryKey = `${projectId || ""}|${from}|${to}|${groupBy}`;

  const [report, setReport] = useState<{ key: string; data: UsageReport } | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      telemetry.usage({ projectId, from, to, tz: TIMEZONE, groupBy })
        .then((next) => { if (!cancelled) { setReport({ key: queryKey, data: next }); setError(""); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load usage"); });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, from, to, groupBy, queryKey]);

  // A report for other controls is stale.
  const current = report && report.key === queryKey ? report.data : null;
  const totals = current?.totals;
  const hasIncluded = Boolean(totals && totals.included_cost > 0);
  // Tokens by default: every call has them, while spend is often $0 for
  // subscription models or models without a list price.
  const metrics: UsageMetric[] = hasIncluded ? ["tokens", "calls", "cost", "value"] : ["tokens", "calls", "cost"];
  const metric = metricChoice && metrics.includes(metricChoice) ? metricChoice : "tokens";
  const series = useMemo(() => (current ? chartSeries(current, metric) : []), [current, metric]);

  const selected = current && groupBy === "agent" ? current.groups.find((g) => g.key === selectedKey) : undefined;
  const selectGroup = (group: UsageGroup) => setSelectedKey(group.key);
  const scopeName = projects.find((p) => p.id === projectId)?.name || "All projects";
  const against = previousLabel(from, to);
  const monthly = current ? current.daily_run_rate * 30 : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text">Usage</h1>
          <p className="mt-0.5 text-xs text-text-dim">
            {scopeName} · {formatRangeLabel(from, to)}
            {current && ` · ${current.bucket === "hour" ? "hourly" : current.bucket === "week" ? "weekly" : "daily"}`}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <select
            aria-label="Project"
            value={projectId || ""}
            onChange={(e) => update({ project: e.target.value || null, group: e.target.value && groupBy === "project" ? null : params.get("group") })}
            className="h-8 max-w-[14rem] rounded-md border border-border bg-bg-card px-2 text-xs text-text focus:border-accent focus:outline-none"
          >
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Segmented
            label="Date range"
            value={preset}
            options={PRESETS}
            labels={PRESET_LABELS}
            onChange={(value) => update(value === "custom"
              ? { range: "custom", from, to }
              : { range: value === "7d" ? null : value, from: null, to: null })}
          />
          {preset === "custom" && (
            <DateRangeInputs from={from} to={to} today={today} onChange={(nextFrom, nextTo) => update({ range: "custom", from: nextFrom, to: nextTo })} />
          )}
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
                  : totals.unpriced_calls > 0 ? `${formatCount(totals.unpriced_calls)} calls not priced`
                  : totals.cost === 0 && totals.calls > 0 ? "Covered by subscriptions" : "Billed per token"}
                delta={<Delta current={totals.cost} previous={current.previous.cost} against={against} />}
              />
              <Tile
                label="Tokens"
                value={formatCount(totals.tokens_in + totals.tokens_out)}
                note={`${formatPercent(cacheShare(totals))} of input from cache`}
                delta={<Delta current={totals.tokens_in + totals.tokens_out} previous={current.previous.tokens_in + current.previous.tokens_out} against={against} />}
              />
              <Tile
                label="Calls"
                value={formatCount(totals.calls)}
                note={totals.errors > 0
                  ? <span className="text-red">{formatCount(totals.errors)} errors · {formatPercent(errorRate(totals.errors, totals.calls))}</span>
                  : `${totals.active_agents} of ${current.agents} agents active`}
                delta={<Delta current={totals.calls} previous={current.previous.calls} against={against} />}
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
