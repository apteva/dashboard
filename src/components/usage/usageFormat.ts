import type { UsageBucket, UsageGroup, UsagePeriod, UsageReport, UsageTotals } from "../../api";

// Money reads at the precision a person would say it: whole cents, with
// sub-cent amounts shown as "<$0.01" instead of four decimals of noise.
export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs < 0.01) return `${sign}<$0.01`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Axis ticks: short and never more precise than the scale needs.
export function formatMoneyTick(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  if (value >= 1) return `$${value.toFixed(value >= 10 ? 0 : 1)}`;
  return `$${value.toFixed(2)}`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)}K`;
  if (abs >= 1_000) return `${trim(value / 1000)}K`;
  return String(Math.round(value));
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

// Relative change against the previous window. null when there is no
// baseline to compare with, so the UI can say "new" instead of "+∞%".
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

export const PERIOD_LABELS: Record<UsagePeriod, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export const PREVIOUS_LABELS: Record<UsagePeriod, string> = {
  "24h": "previous 24h",
  "7d": "previous 7 days",
  "30d": "previous 30 days",
};

export function formatBucketLabel(iso: string, bucketMinutes: number): string {
  const date = new Date(iso);
  if (bucketMinutes >= 1440) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (bucketMinutes >= 360) {
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${date.toLocaleTimeString(undefined, { hour: "numeric" })}`;
  }
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function cacheShare(totals: Pick<UsageTotals, "tokens_in" | "tokens_cached">): number {
  return totals.tokens_in > 0 ? (totals.tokens_cached / totals.tokens_in) * 100 : 0;
}

export function errorRate(errors: number, calls: number): number {
  const attempts = calls + errors;
  return attempts > 0 ? (errors / attempts) * 100 : 0;
}

// ─── Chart series ────────────────────────────────────────────────────────

export type UsageMetric = "cost" | "value" | "tokens" | "calls";

export const SERIES_SLOTS = 5;
export const OTHER_KEY = "__other";

export function seriesColor(index: number): string {
  return index < SERIES_SLOTS ? `var(--series-${index + 1})` : "var(--series-other)";
}

export function metricValue(point: { cost: number; included_cost: number; calls: number; tokens: number } | undefined, metric: UsageMetric): number {
  if (!point) return 0;
  switch (metric) {
    case "cost": return point.cost;
    case "value": return point.cost + point.included_cost;
    case "tokens": return point.tokens;
    case "calls": return point.calls;
  }
}

export function groupMetric(group: UsageGroup, metric: UsageMetric): number {
  return metricValue({ ...group, tokens: group.tokens_in + group.tokens_out }, metric);
}

// The groups the chart draws as their own series, in a stable order: the
// top entries by the selected metric, everything else folded into "Other".
// Colors follow the group (its index in report order), not its rank.
export function chartSeries(report: UsageReport, metric: UsageMetric): Array<{ key: string; label: string; color: string }> {
  const ranked = report.groups
    .map((group, index) => ({ group, index, value: groupMetric(group, metric) }))
    .filter((entry) => entry.value > 0);
  ranked.sort((a, b) => b.value - a.value);
  const shown = ranked.slice(0, SERIES_SLOTS).sort((a, b) => a.index - b.index);
  const series = shown.map(({ group }, slot) => ({ key: group.key, label: group.label, color: seriesColor(slot) }));
  if (ranked.length > SERIES_SLOTS) series.push({ key: OTHER_KEY, label: "Other", color: seriesColor(SERIES_SLOTS) });
  return series;
}

export function chartRows(report: UsageReport, metric: UsageMetric, series: Array<{ key: string }>) {
  const named = new Set(series.map((s) => s.key).filter((key) => key !== OTHER_KEY));
  return report.timeline.map((bucket: UsageBucket) => {
    const row: Record<string, number | string> = { time: bucket.time };
    let other = 0;
    for (const [key, point] of Object.entries(bucket.series || {})) {
      const value = metricValue(point, metric);
      if (named.has(key)) row[key] = value;
      else other += value;
    }
    for (const key of named) if (row[key] === undefined) row[key] = 0;
    if (series.some((s) => s.key === OTHER_KEY)) row[OTHER_KEY] = other;
    return row;
  });
}

// Per-group values for the breakdown table's sparkline.
export function groupTrend(report: UsageReport, key: string, metric: UsageMetric): number[] {
  return report.timeline.map((bucket) => metricValue(bucket.series?.[key], metric));
}

// Pick the chart metric a reader cares about: billed spend when there is
// any, subscription value when all usage is covered, else tokens.
