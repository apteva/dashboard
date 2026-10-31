import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { telemetry, type TelemetryEvent, type UsageGroup, type UsageReport } from "../../api";
import {
  errorRate,
  formatBucketLabel,
  formatCount,
  formatMoney,
  formatPercent,
  groupTrend,
  type UsageMetric,
} from "./usageFormat";

const RECENT_LIMIT = 200;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle px-3 py-2">
      <p className="text-[11px] text-text-dim">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-text">{value}</p>
      {sub && <p className="text-[11px] text-text-dim">{sub}</p>}
    </div>
  );
}

function RankedList({ title, rows, empty }: { title: string; rows: Array<{ key: string; label: string; value: string; share: number }>; empty: string }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-text-dim">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.key} className="text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-text-muted" title={row.label}>{row.label}</span>
                <span className="shrink-0 tabular-nums text-text">{row.value}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-hover">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(row.share, 2)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Side panel for one agent: its slice of the report plus what its most
// recent calls and tools were. Recent lists come from the latest events,
// not the selected period, and say so.
export function AgentUsagePanel({
  report,
  group,
  color,
  metric,
  onClose,
}: {
  report: UsageReport;
  group: UsageGroup;
  color: string;
  metric: UsageMetric;
  onClose: () => void;
}) {
  const agentId = group.agent_id;
  const [llmEvents, setLlmEvents] = useState<TelemetryEvent[]>([]);
  const [toolEvents, setToolEvents] = useState<TelemetryEvent[]>([]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    telemetry.query(agentId, "llm.done", RECENT_LIMIT).then((e) => { if (!cancelled) setLlmEvents(e || []); }).catch(() => {});
    telemetry.query(agentId, "tool.call", RECENT_LIMIT).then((e) => { if (!cancelled) setToolEvents(e || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trend = useMemo(
    () => groupTrend(report, group.key, metric).map((value, i) => ({ time: report.timeline[i]?.time, value })),
    [report, group.key, metric],
  );
  const money = metric === "cost" || metric === "value";

  const models = useMemo(() => {
    const byModel = new Map<string, { calls: number; cost: number }>();
    for (const e of llmEvents) {
      const model = typeof e.data?.model === "string" && e.data.model ? e.data.model : "Unknown model";
      const entry = byModel.get(model) || { calls: 0, cost: 0 };
      entry.calls += 1;
      entry.cost += typeof e.data?.cost_usd === "number" ? e.data.cost_usd : 0;
      byModel.set(model, entry);
    }
    const total = llmEvents.length || 1;
    return [...byModel.entries()]
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 6)
      .map(([model, v]) => ({ key: model, label: model, value: `${v.calls} calls`, share: (v.calls / total) * 100 }));
  }, [llmEvents]);

  const tools = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of toolEvents) {
      const name = typeof e.data?.name === "string" ? e.data.name : typeof e.data?.tool === "string" ? e.data.tool : "";
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const max = Math.max(...counts.values(), 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ key: name, label: name, value: formatCount(count), share: (count / max) * 100 }));
  }, [toolEvents]);

  const spend = group.billing === "subscription" ? `${formatMoney(group.included_cost)}` : formatMoney(group.cost);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-bg-overlay" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${group.label} usage`}
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-bg shadow-[var(--shadow-popover)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-text">{group.label}</h2>
            <p className="text-xs text-text-dim">
              {group.billing === "subscription" ? "Subscription usage" : group.billing === "mixed" ? "Billed and subscription usage" : "Billed usage"}
            </p>
          </div>
          {agentId && (
            <Link to={`/agents/${agentId}`} className="shrink-0 pt-1 text-xs text-text-muted hover:text-text">Open agent →</Link>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded px-1.5 text-lg leading-none text-text-muted hover:bg-bg-hover hover:text-text">×</button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <Stat label={group.billing === "subscription" ? "List-price value" : "Spend"} value={spend} sub={group.billing === "mixed" ? `+${formatMoney(group.included_cost)} included` : undefined} />
            <Stat label="Calls" value={formatCount(group.calls)} sub={group.unpriced_calls > 0 ? `${group.unpriced_calls} not priced` : undefined} />
            <Stat label="Tokens" value={formatCount(group.tokens_in + group.tokens_out)} sub={`${formatCount(group.tokens_in)} in · ${formatCount(group.tokens_out)} out`} />
            <Stat label="Errors" value={String(group.errors)} sub={group.errors > 0 ? `${formatPercent(errorRate(group.errors, group.calls))} of attempts` : undefined} />
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold text-text">{money ? "Spend" : metric === "tokens" ? "Tokens" : "Calls"} over time</h3>
            <div style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <XAxis dataKey="time" hide />
                  <Tooltip
                    cursor={{ fill: "var(--bg-hover)", opacity: 0.6 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { time: string; value: number };
                      return (
                        <div className="rounded-md border border-border bg-bg-card px-2.5 py-1.5 text-xs shadow-[var(--shadow-popover)]">
                          <p className="text-text-dim">{formatBucketLabel(row.time, report.bucket, true)}</p>
                          <p className="tabular-nums text-text">{money ? formatMoney(row.value) : formatCount(row.value)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <RankedList title={`Models · last ${llmEvents.length || ""} calls`.replace(/ $/, "")} rows={models} empty="No recent model calls." />
          <RankedList title="Top tools · recent" rows={tools} empty="No recent tool calls." />
        </div>
      </aside>
    </div>
  );
}
