import { useMemo, useState } from "react";
import type { UsageGroup, UsageGroupBy, UsageReport } from "../../api";
import {
  cacheShare,
  chartSeries,
  errorRate,
  formatCount,
  formatMoney,
  formatPercent,
  groupTrend,
  type UsageMetric,
} from "./usageFormat";

type SortKey = "spend" | "calls" | "tokens" | "errors" | "label";

const GROUP_NOUNS: Record<UsageGroupBy, string> = {
  agent: "Agent",
  model: "Model",
  provider: "Provider",
  project: "Project",
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) return <span className="block h-5 w-20" aria-hidden="true" />;
  const step = 80 / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(18 - (v / max) * 16).toFixed(1)}`).join(" ");
  return (
    <svg width="80" height="20" viewBox="0 0 80 20" className="block" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SpendCell({ group }: { group: UsageGroup }) {
  if (group.billing === "subscription") {
    return (
      <span className="flex flex-col items-end leading-tight">
        <span className="text-text-muted">Included</span>
        <span className="text-[11px] text-text-dim">{formatMoney(group.included_cost)} list</span>
      </span>
    );
  }
  if (group.cost === 0 && group.calls > 0 && group.unpriced_calls === group.calls) {
    return <span className="text-text-dim">Not priced</span>;
  }
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="font-semibold text-text">{formatMoney(group.cost)}</span>
      {group.included_cost > 0 && <span className="text-[11px] text-text-dim">+{formatMoney(group.included_cost)} incl.</span>}
    </span>
  );
}

export function UsageBreakdown({
  report,
  metric,
  groupBy,
  groupings,
  onGroupByChange,
  onSelect,
}: {
  report: UsageReport;
  metric: UsageMetric;
  groupBy: UsageGroupBy;
  groupings: UsageGroupBy[];
  onGroupByChange: (groupBy: UsageGroupBy) => void;
  onSelect?: (group: UsageGroup) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "spend", desc: true });
  const series = useMemo(() => chartSeries(report, metric), [report, metric]);
  const colorByKey = useMemo(() => new Map(series.map((s) => [s.key, s.color])), [series]);
  const totalSpend = report.totals.cost + report.totals.included_cost;

  const rows = useMemo(() => {
    const value = (g: UsageGroup): number | string => {
      switch (sort.key) {
        case "spend": return g.cost + g.included_cost;
        case "calls": return g.calls;
        case "tokens": return g.tokens_in + g.tokens_out;
        case "errors": return errorRate(g.errors, g.calls);
        case "label": return g.label.toLowerCase();
      }
    };
    return [...report.groups].sort((a, b) => {
      const av = value(a), bv = value(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  }, [report.groups, sort]);

  const header = (key: SortKey, text: string, align = "text-right") => (
    <th scope="col" className={`px-3 py-2 font-medium ${align}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : key !== "label" }))}
        className="inline-flex items-center gap-1 hover:text-text"
      >
        {text}
        {sort.key === key && <span aria-hidden="true">{sort.desc ? "↓" : "↑"}</span>}
      </button>
    </th>
  );

  return (
    <section className="rounded-lg border border-border bg-bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-text">Breakdown</h2>
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Group by">
          {groupings.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={groupBy === value}
              onClick={() => onGroupByChange(value)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                groupBy === value ? "bg-bg-hover font-semibold text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {GROUP_NOUNS[value]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-text-dim">No usage recorded in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-text-dim">
              <tr className="border-b border-border">
                {header("label", GROUP_NOUNS[groupBy], "text-left")}
                {header("spend", "Spend")}
                <th scope="col" className="px-3 py-2 text-left font-medium">Share</th>
                {header("calls", "Calls")}
                {header("tokens", "Tokens")}
                <th scope="col" className="px-3 py-2 text-right font-medium">Cache</th>
                {header("errors", "Errors")}
                <th scope="col" className="px-3 py-2 text-left font-medium">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((group) => {
                const spend = group.cost + group.included_cost;
                const share = totalSpend > 0 ? (spend / totalSpend) * 100 : 0;
                const rate = errorRate(group.errors, group.calls);
                const color = colorByKey.get(group.key) || "var(--series-other)";
                const clickable = Boolean(onSelect);
                return (
                  <tr
                    key={group.key}
                    onClick={clickable ? () => onSelect?.(group) : undefined}
                    className={clickable ? "cursor-pointer hover:bg-bg-hover" : ""}
                  >
                    <td className="max-w-[16rem] px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                        {clickable ? (
                          <button type="button" className="truncate text-left font-semibold text-text hover:underline" onClick={(e) => { e.stopPropagation(); onSelect?.(group); }}>
                            {group.label}
                          </button>
                        ) : (
                          <span className="truncate font-semibold text-text" title={group.label}>{group.label}</span>
                        )}
                        {group.status && group.status !== "running" && (
                          <span className="shrink-0 rounded border border-border px-1 text-[10px] text-text-dim">{group.status}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums"><SpendCell group={group} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-hover">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(share, 100)}%`, background: color }} />
                        </div>
                        <span className="w-9 tabular-nums text-text-muted">{formatPercent(share)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text">{formatCount(group.calls)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text">
                      {formatCount(group.tokens_in + group.tokens_out)}
                      <span className="block text-[11px] text-text-dim">{formatCount(group.tokens_in)} in · {formatCount(group.tokens_out)} out</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{group.calls > 0 ? formatPercent(cacheShare(group)) : "–"}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${group.errors > 0 ? "text-red" : "text-text-dim"}`}>
                      {group.errors > 0 ? `${group.errors} · ${formatPercent(rate)}` : "0"}
                    </td>
                    <td className="px-3 py-2.5"><Sparkline values={groupTrend(report, group.key, metric)} color={color} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
