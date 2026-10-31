import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UsageReport } from "../../api";
import {
  chartRows,
  chartSeries,
  formatBucketLabel,
  formatCount,
  formatMoney,
  formatMoneyTick,
  type UsageMetric,
} from "./usageFormat";

const METRIC_LABELS: Record<UsageMetric, string> = {
  cost: "Billed spend",
  value: "Spend incl. subscriptions",
  tokens: "Tokens",
  calls: "Calls",
};

function formatMetric(metric: UsageMetric, value: number): string {
  return metric === "cost" || metric === "value" ? formatMoney(value) : formatCount(value);
}

export function UsageChart({
  report,
  metric,
  metrics,
  onMetricChange,
}: {
  report: UsageReport;
  metric: UsageMetric;
  metrics: UsageMetric[];
  onMetricChange: (metric: UsageMetric) => void;
}) {
  const series = chartSeries(report, metric);
  const rows = chartRows(report, metric, series);
  const money = metric === "cost" || metric === "value";
  const empty = series.length === 0;
  const label = (time: string) => formatBucketLabel(time, report.bucket_minutes);

  return (
    <section className="rounded-lg border border-border bg-bg-card" aria-label={`${METRIC_LABELS[metric]} over time`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-text">{METRIC_LABELS[metric]} over time</h2>
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Chart metric">
          {metrics.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={metric === value}
              onClick={() => onMetricChange(value)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${
                metric === value ? "bg-bg-hover font-semibold text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {value === "value" ? "Incl. subscriptions" : METRIC_LABELS[value].replace("Billed spend", "Spend")}
            </button>
          ))}
        </div>
      </div>

      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex min-w-0 items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="max-w-[12rem] truncate">{s.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="relative px-2 pb-2 pt-3" style={{ height: 260 }}>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-text-dim">
            No {metric === "calls" ? "calls" : metric === "tokens" ? "tokens" : "spend"} in this period
          </p>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 4 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis
              dataKey="time"
              tickFormatter={label}
              tick={{ fill: "var(--text-dim)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => (money ? formatMoneyTick(v) : formatCount(v))}
              tick={{ fill: "var(--text-dim)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
              allowDecimals={!money ? false : true}
            />
            {!empty && (
              <Tooltip
                cursor={{ fill: "var(--bg-hover)", opacity: 0.6 }}
                content={({ active, payload, label: time }) => {
                  if (!active || !payload?.length) return null;
                  const items = payload.filter((p) => Number(p.value) > 0).reverse();
                  const total = payload.reduce((sum, p) => sum + Number(p.value || 0), 0);
                  return (
                    <div className="min-w-[11rem] rounded-md border border-border bg-bg-card px-3 py-2 text-xs shadow-[var(--shadow-popover)]">
                      <p className="mb-1.5 text-text-dim">{label(String(time))}</p>
                      {items.map((p) => (
                        <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
                          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: String(p.color) }} />
                          <span className="min-w-0 flex-1 truncate text-text-muted">{p.name}</span>
                          <span className="tabular-nums text-text">{formatMetric(metric, Number(p.value))}</span>
                        </div>
                      ))}
                      {items.length > 1 && (
                        <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold text-text">
                          <span>Total</span>
                          <span className="tabular-nums">{formatMetric(metric, total)}</span>
                        </div>
                      )}
                      {items.length === 0 && <p className="text-text-dim">Nothing recorded</p>}
                    </div>
                  );
                }}
              />
            )}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="usage"
                fill={s.color}
                stroke="var(--bg-card)"
                strokeWidth={1}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
