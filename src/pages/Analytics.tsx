import { useState, useEffect, useMemo } from "react";
import {
  instances,
  telemetry,
  type Instance,
  type InstanceStats,
  type ProjectTimelineBucket,
  type TelemetryStats,
  type TelemetryEvent,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// Analytics is project-wide by default: which instances are burning
// the most tokens, how spend moves over time, and where unusual
// behavior is hiding. Clicking an instance drills into its per-thread,
// per-tool, and event-stream detail (what the page used to be locked
// to as a single-instance view).

type Period = "1h" | "24h" | "7d" | "30d";

// Twelve-color palette — the instance list can comfortably grow past
// eight without repeats. Order is stable so each instance keeps the
// same color across period changes and drill-downs.
const COLORS = [
  "#f97316", "#3b82f6", "#a855f7", "#eab308",
  "#06b6d4", "#ec4899", "#6366f1", "#84cc16",
  "#f43f5e", "#14b8a6", "#8b5cf6", "#0ea5e9",
];

const PERIOD_HOURS: Record<Period, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

export function Analytics() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [period, setPeriod] = useState<Period>("24h");
  const [projectStats, setProjectStats] = useState<InstanceStats[]>([]);
  const [projectTimeline, setProjectTimeline] = useState<ProjectTimelineBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [allInstances, setAllInstances] = useState<Instance[]>([]);

  const [drillId, setDrillId] = useState<number | null>(null);

  // Color map keyed by stringified instance id so every chart agrees
  // on which color means which instance.
  const colorByInstance = useMemo(() => {
    const m: Record<string, string> = {};
    projectStats.forEach((s, i) => {
      m[String(s.instance_id)] = COLORS[i % COLORS.length];
    });
    return m;
  }, [projectStats]);

  // Friendly name lookup (stats list is sparse — omits zero-activity
  // instances — so fall back to the full instances list when we need a
  // name for the drill-down header of a dormant instance).
  const nameByInstance = useMemo(() => {
    const m: Record<string, string> = {};
    for (const inst of allInstances) m[String(inst.id)] = inst.name;
    for (const s of projectStats) m[String(s.instance_id)] = s.name;
    return m;
  }, [allInstances, projectStats]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([
        telemetry.projectStats(projectId, period),
        telemetry.projectTimeline(projectId, period),
        instances.list(projectId),
      ])
        .then(([stats, timeline, insts]) => {
          if (cancelled) return;
          setProjectStats(stats || []);
          setProjectTimeline(timeline || []);
          setAllInstances(insts || []);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLoading(false);
        });
    };
    setLoading(true);
    load();
    const interval = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectId, period]);

  // Totals + derived stats for the top banner. Rebuild on stats change.
  const totals = useMemo(() => {
    let cost = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let tokensCached = 0;
    let calls = 0;
    let errors = 0;
    for (const s of projectStats) {
      cost += s.cost;
      tokensIn += s.tokens_in;
      tokensOut += s.tokens_out;
      tokensCached += s.tokens_cached;
      calls += s.llm_calls;
      errors += s.errors;
    }
    const hours = PERIOD_HOURS[period];
    const costPerHour = cost / Math.max(hours, 1);
    const costPerDay = costPerHour * 24;
    const costPerMonth = costPerDay * 30;
    const cacheRate = tokensIn > 0 ? (tokensCached / tokensIn) * 100 : 0;
    const activeInstances = projectStats.filter((s) => s.llm_calls > 0).length;
    return {
      cost, tokensIn, tokensOut, tokensCached, calls, errors,
      costPerDay, costPerMonth, cacheRate, activeInstances,
    };
  }, [projectStats, period]);

  // Anomaly signals — derived once per stats/timeline refresh. Each
  // signal is a short, actionable sentence; the UI renders them as a
  // "watch this" strip.
  const anomalies = useMemo(() => detectAnomalies(projectStats, projectTimeline), [projectStats, projectTimeline]);

  // Stacked-area timeline keyed by instance id. Missing values fill
  // with 0 so the stacks align across buckets.
  const stackedTimeline = useMemo(() => {
    const instanceIds = projectStats.map((s) => String(s.instance_id));
    return projectTimeline.map((b) => {
      const row: Record<string, any> = {
        time: formatBucketTime(b.time, period),
        _raw: b.time,
      };
      for (const id of instanceIds) {
        row[id] = Number((b.cost_by_instance?.[id] || 0).toFixed(6));
      }
      return row;
    });
  }, [projectStats, projectTimeline, period]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-text text-lg font-bold">Analytics</h1>
          <p className="text-text-dim text-xs mt-0.5">
            Project-wide spend, per-instance breakdown, and anomaly signals.
          </p>
        </div>
        <div className="flex gap-2">
          {(["1h", "24h", "7d", "30d"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                period === p ? "bg-accent text-bg font-bold" : "text-text-muted hover:text-text border border-border"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading && projectStats.length === 0 && (
          <p className="text-text-muted text-sm">Loading…</p>
        )}

        {!loading && projectStats.length === 0 && (
          <div className="border border-border rounded-lg p-6 bg-bg-card text-center">
            <p className="text-text-muted text-sm">
              No activity in this {period} window. Run an instance to see data here.
            </p>
          </div>
        )}

        {projectStats.length > 0 && (
          <>
            {/* Project summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <StatCard label="Total cost" value={`$${totals.cost.toFixed(4)}`} sub={period} />
              <StatCard label="Projected / day" value={`$${totals.costPerDay.toFixed(3)}`} sub="extrapolated" />
              <StatCard label="Projected / month" value={`$${totals.costPerMonth.toFixed(2)}`} />
              <StatCard label="Active instances" value={String(totals.activeInstances)} sub={`of ${allInstances.length}`} />
              <StatCard label="LLM calls" value={formatNumber(totals.calls)} sub={`${formatNumber(totals.tokensIn)} tok in`} />
              <StatCard label="Cache rate" value={`${totals.cacheRate.toFixed(0)}%`} />
              <StatCard label="Errors" value={String(totals.errors)} highlight={totals.errors > 0 ? "red" : undefined} />
            </div>

            {/* Anomalies — "watch this" ribbon */}
            {anomalies.length > 0 && (
              <section>
                <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Worth a look</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {anomalies.map((a, i) => (
                    <AnomalyCard key={i} anomaly={a} onClick={() => a.instanceId != null && setDrillId(a.instanceId)} />
                  ))}
                </div>
              </section>
            )}

            {/* Biggest spenders — horizontal bar per instance, clickable */}
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-text text-sm font-bold uppercase tracking-wide">Biggest spenders</h2>
                <p className="text-text-dim text-[10px]">click an instance to drill in</p>
              </div>
              <div className="border border-border rounded-lg bg-bg-card divide-y divide-border">
                {projectStats.map((s) => {
                  const pct = totals.cost > 0 ? (s.cost / totals.cost) * 100 : 0;
                  const color = colorByInstance[String(s.instance_id)];
                  const burnPerHour = s.cost / Math.max(PERIOD_HOURS[period], 1);
                  return (
                    <button
                      key={s.instance_id}
                      onClick={() => setDrillId(s.instance_id)}
                      className="w-full text-left px-4 py-3 hover:bg-bg-hover/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-text font-bold truncate">{s.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          s.status === "running" ? "bg-green/15 text-green" : "bg-border text-text-muted"
                        }`}>{s.status || "?"}</span>
                        {s.errors > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red/15 text-red">
                            {s.errors} err
                          </span>
                        )}
                        <span className="ml-auto text-text font-bold tabular-nums">
                          ${s.cost.toFixed(4)}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-1.5 h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                      <div className="mt-1 flex gap-3 text-[10px] text-text-dim tabular-nums">
                        <span>{pct.toFixed(1)}% of total</span>
                        <span>{formatNumber(s.llm_calls)} calls</span>
                        <span>{formatNumber(s.tokens_in)}→{formatNumber(s.tokens_out)} tok</span>
                        <span>{s.distinct_threads} threads</span>
                        <span>${burnPerHour.toFixed(5)}/h</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Usage over time — stacked by instance */}
            {stackedTimeline.length > 1 && (
              <section>
                <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Cost over time, by instance</h2>
                <div className="border border-border rounded-lg bg-bg-card p-4 pt-6" style={{ height: 300 }}>
                  <ResponsiveContainer>
                    <AreaChart data={stackedTimeline}>
                      <CartesianGrid {...gridStyle} />
                      <XAxis dataKey="time" {...axisStyle} tickLine={false} axisLine={false} />
                      <YAxis {...axisStyle} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                      <Tooltip
                        {...chartTooltip}
                        formatter={(v: number, n: string) => [`$${v.toFixed(4)}`, nameByInstance[n] || n]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#666" }}
                        formatter={(v: string) => nameByInstance[v] || v}
                      />
                      {projectStats.map((s) => (
                        <Area
                          key={s.instance_id}
                          type="monotone"
                          dataKey={String(s.instance_id)}
                          name={String(s.instance_id)}
                          stackId="1"
                          fill={colorByInstance[String(s.instance_id)]}
                          stroke={colorByInstance[String(s.instance_id)]}
                          fillOpacity={0.35}
                          strokeWidth={1.5}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Token mix */}
            <section>
              <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Token mix</h2>
              <div className="border border-border rounded-lg bg-bg-card p-4" style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={projectStats.slice(0, 12).map((s) => ({
                      name: s.name,
                      input: s.tokens_in - s.tokens_cached,
                      cached: s.tokens_cached,
                      output: s.tokens_out,
                    }))}
                  >
                    <CartesianGrid {...gridStyle} />
                    <XAxis dataKey="name" {...axisStyle} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis {...axisStyle} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
                    <Tooltip {...chartTooltip} formatter={(v: number) => formatNumber(v)} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#666" }} />
                    <Bar dataKey="input" stackId="t" name="Input" fill="#3b82f6" opacity={0.85} />
                    <Bar dataKey="cached" stackId="t" name="Cached" fill="#06b6d4" opacity={0.85} />
                    <Bar dataKey="output" stackId="t" name="Output" fill="#f97316" opacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Drill-down modal */}
            {drillId != null && (
              <InstanceDrillDown
                instanceId={drillId}
                period={period}
                name={nameByInstance[String(drillId)] || `Instance ${drillId}`}
                color={colorByInstance[String(drillId)] || COLORS[0]}
                projectCost={totals.cost}
                onClose={() => setDrillId(null)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Drill-down: single-instance detail ----------------------------------

function InstanceDrillDown({ instanceId, period, name, color, projectCost, onClose }: {
  instanceId: number;
  period: Period;
  name: string;
  color: string;
  projectCost: number;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [recentEvents, setRecentEvents] = useState<TelemetryEvent[]>([]);
  const [toolBreakdown, setToolBreakdown] = useState<Record<string, number>>({});
  const [threadCosts, setThreadCosts] = useState<Record<string, number>>({});

  useEffect(() => {
    const load = () => {
      telemetry.stats(instanceId, period).then(setStats).catch(() => {});
      telemetry.timeline(instanceId, period).then((data) => {
        setTimeline(data || []);
        const costs: Record<string, number> = {};
        for (const bucket of data || []) {
          const perCall = bucket.llm_calls > 0 ? bucket.cost / bucket.llm_calls : 0;
          for (const [thread, count] of Object.entries(bucket.threads || {})) {
            costs[thread] = (costs[thread] || 0) + perCall * (count as number);
          }
        }
        setThreadCosts(costs);
      }).catch(() => {});
      telemetry.query(instanceId, undefined, 60).then((e) => setRecentEvents(e || [])).catch(() => {});
      telemetry.query(instanceId, "tool", 200).then((events) => {
        const counts: Record<string, number> = {};
        for (const e of events || []) {
          if (e.type === "tool.call" && e.data?.name) {
            counts[e.data.name] = (counts[e.data.name] || 0) + 1;
          }
        }
        setToolBreakdown(counts);
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [instanceId, period]);

  const threadCostData = useMemo(() =>
    Object.entries(threadCosts)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([n, v]) => ({ name: n, value: Number(v.toFixed(5)) })),
    [threadCosts]
  );
  const toolData = useMemo(() =>
    Object.entries(toolBreakdown)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([n, c]) => ({ name: n.length > 25 ? n.slice(0, 25) + "…" : n, count: c })),
    [toolBreakdown]
  );

  const pctOfProject = stats && projectCost > 0 ? (stats.total_cost / projectCost) * 100 : 0;

  // Simple token-over-time chart for this instance only.
  const tokenTimeline = timeline.map((b) => ({
    time: formatBucketTime(b.time, period),
    tokens_in: b.tokens_in,
    tokens_out: b.tokens_out,
  }));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-border rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center gap-3">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-text font-bold text-base truncate">{name}</h2>
            <p className="text-text-dim text-[11px]">
              {period} detail · {stats ? `$${stats.total_cost.toFixed(4)} (${pctOfProject.toFixed(1)}% of project)` : "loading…"}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text text-lg leading-none px-2">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="Cost" value={`$${stats.total_cost.toFixed(4)}`} />
              <StatCard label="LLM calls" value={formatNumber(stats.llm_calls)} />
              <StatCard label="Tokens in/out" value={`${formatNumber(stats.total_tokens_in)}/${formatNumber(stats.total_tokens_out)}`} />
              <StatCard label="Avg duration" value={`${(stats.avg_duration_ms || 0).toFixed(0)}ms`} />
              <StatCard label="Errors" value={String(stats.errors)} highlight={stats.errors > 0 ? "red" : undefined} />
            </div>
          )}

          {tokenTimeline.length > 1 && (
            <section>
              <h3 className="text-text text-xs font-bold mb-2 uppercase tracking-wide">Tokens over time</h3>
              <div className="border border-border rounded-lg bg-bg-card p-3" style={{ height: 180 }}>
                <ResponsiveContainer>
                  <BarChart data={tokenTimeline}>
                    <CartesianGrid {...gridStyle} />
                    <XAxis dataKey="time" {...axisStyle} tickLine={false} axisLine={false} />
                    <YAxis {...axisStyle} tickLine={false} axisLine={false} tickFormatter={formatNumber} />
                    <Tooltip {...chartTooltip} formatter={(v: number) => formatNumber(v)} />
                    <Bar dataKey="tokens_in" name="Input" fill="#3b82f6" opacity={0.8} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="tokens_out" name="Output" fill="#f97316" opacity={0.8} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {threadCostData.length > 0 && (
              <section>
                <h3 className="text-text text-xs font-bold mb-2 uppercase tracking-wide">Cost by thread</h3>
                <div className="border border-border rounded-lg bg-bg-card p-3" style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={threadCostData.slice(0, 10)} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                      <XAxis type="number" {...axisStyle} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                      <YAxis type="category" dataKey="name" {...axisStyle} tickLine={false} axisLine={false} width={80} />
                      <Tooltip {...chartTooltip} formatter={(v: number) => `$${v.toFixed(5)}`} />
                      <Bar dataKey="value" fill={color} opacity={0.85} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {toolData.length > 0 && (
              <section>
                <h3 className="text-text text-xs font-bold mb-2 uppercase tracking-wide">Top tools</h3>
                <div className="border border-border rounded-lg bg-bg-card p-3" style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={toolData} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                      <XAxis type="number" {...axisStyle} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" {...axisStyle} tickLine={false} axisLine={false} width={80} />
                      <Tooltip {...chartTooltip} />
                      <Bar dataKey="count" fill={color} opacity={0.85} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
          </div>

          {recentEvents.length > 0 && (
            <section>
              <h3 className="text-text text-xs font-bold mb-2 uppercase tracking-wide">Recent events</h3>
              <div className="border border-border rounded-lg bg-bg-card divide-y divide-border max-h-[260px] overflow-y-auto">
                {recentEvents.slice(0, 30).map((e) => (
                  <div key={e.id} className="px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-text-muted text-[10px]">{new Date(e.time).toLocaleTimeString()}</span>
                      <span className={`text-[11px] font-bold ${eventTypeColor(e.type)}`}>{e.type}</span>
                      <span className="text-text-dim text-[10px]">{e.thread_id}</span>
                      <span className="ml-auto text-[10px] text-text-muted">
                        {e.type === "llm.done" && e.data && (
                          <>
                            {e.data.tokens_in}→{e.data.tokens_out} ·{" "}
                            {e.data.cost_usd != null ? `$${(e.data.cost_usd as number).toFixed(4)}` : ""}
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-text-dim text-[10px] mt-0.5 truncate">{formatEventDetail(e)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Anomaly detection ----------------------------------------------------

interface Anomaly {
  kind: "error" | "spike" | "cache" | "burn" | "concentration";
  title: string;
  detail: string;
  instanceId?: number;
  severity: "info" | "warn" | "alert";
}

function detectAnomalies(stats: InstanceStats[], timeline: ProjectTimelineBucket[]): Anomaly[] {
  const out: Anomaly[] = [];
  if (stats.length === 0) return out;

  // 1. Cost concentration — one instance >60% of spend.
  const totalCost = stats.reduce((s, x) => s + x.cost, 0);
  if (stats.length >= 2 && totalCost > 0) {
    const top = stats[0];
    const topPct = (top.cost / totalCost) * 100;
    if (topPct >= 60) {
      out.push({
        kind: "concentration",
        title: `${top.name} is ${topPct.toFixed(0)}% of all spend`,
        detail: `$${top.cost.toFixed(4)} of $${totalCost.toFixed(4)} total. Check whether the work is justified.`,
        instanceId: top.instance_id,
        severity: topPct >= 80 ? "warn" : "info",
      });
    }
  }

  // 2. Error outlier — any instance with errors > 0.
  for (const s of stats) {
    if (s.errors > 0) {
      const rate = s.llm_calls > 0 ? (s.errors / s.llm_calls) * 100 : 0;
      out.push({
        kind: "error",
        title: `${s.name}: ${s.errors} error${s.errors === 1 ? "" : "s"}`,
        detail: rate > 0
          ? `${rate.toFixed(1)}% of its ${s.llm_calls} LLM calls failed.`
          : `Tool or LLM errors recorded in window.`,
        instanceId: s.instance_id,
        severity: rate >= 20 ? "alert" : rate >= 5 ? "warn" : "info",
      });
    }
  }

  // 3. Low cache rate on expensive instances. Cheap instances aren't
  //    worth flagging because the absolute savings are small.
  for (const s of stats.slice(0, 5)) {
    if (s.tokens_in < 10_000 || s.cost < 0.05) continue;
    const cacheRate = s.tokens_in > 0 ? (s.tokens_cached / s.tokens_in) * 100 : 0;
    if (cacheRate < 10) {
      out.push({
        kind: "cache",
        title: `${s.name}: ${cacheRate.toFixed(0)}% cache rate`,
        detail: `Only ${formatNumber(s.tokens_cached)} of ${formatNumber(s.tokens_in)} input tokens cached. System prompt or directive may be thrashing.`,
        instanceId: s.instance_id,
        severity: cacheRate < 3 ? "warn" : "info",
      });
    }
  }

  // 4. Recent spike — last bucket's cost ≥ 3× the median of prior
  //    buckets AND absolute jump > $0.01 (skip micro-spikes).
  if (timeline.length >= 4) {
    const recent = timeline[timeline.length - 1];
    const prior = timeline.slice(0, -1).map((b) => b.cost).sort((a, b) => a - b);
    const median = prior[Math.floor(prior.length / 2)] || 0;
    if (recent.cost > 0.01 && recent.cost >= Math.max(median * 3, 0.005)) {
      // Find the instance dominating this spike.
      let topInstKey = "";
      let topInstCost = 0;
      for (const [k, v] of Object.entries(recent.cost_by_instance || {})) {
        if (v > topInstCost) { topInstCost = v; topInstKey = k; }
      }
      const inst = stats.find((s) => String(s.instance_id) === topInstKey);
      out.push({
        kind: "spike",
        title: `Cost spike in last bucket`,
        detail: inst
          ? `$${recent.cost.toFixed(4)} this slice vs ~$${median.toFixed(4)} median. ${inst.name} accounts for $${topInstCost.toFixed(4)}.`
          : `$${recent.cost.toFixed(4)} this slice vs ~$${median.toFixed(4)} median of earlier slices.`,
        instanceId: inst?.instance_id,
        severity: "warn",
      });
    }
  }

  // 5. Burn rate — projected monthly cost > $50 on top spender.
  const hoursPerBucket = timeline.length > 1 ? 1 : 24;
  void hoursPerBucket;
  if (stats.length > 0) {
    const top = stats[0];
    // Project over the whole period we're looking at — the caller's
    // banner does the same extrapolation using PERIOD_HOURS.
    // We just flag if it's unusually high.
    // (Left as an info-severity heads-up so the page isn't noisy.)
    if (top.cost > 0.5) {
      out.push({
        kind: "burn",
        title: `${top.name} burning hot`,
        detail: `$${top.cost.toFixed(4)} in window, ${formatNumber(top.llm_calls)} calls, ${top.distinct_threads} thread${top.distinct_threads === 1 ? "" : "s"}.`,
        instanceId: top.instance_id,
        severity: "info",
      });
    }
  }

  return out.slice(0, 8); // cap to keep the ribbon tight
}

function AnomalyCard({ anomaly, onClick }: { anomaly: Anomaly; onClick: () => void }) {
  const sevStyle = {
    info: "border-border bg-bg-card",
    warn: "border-warn/40 bg-warn/5",
    alert: "border-red/40 bg-red/5",
  }[anomaly.severity];
  const icon = {
    error: "⚠",
    spike: "↑",
    cache: "∅",
    burn: "🔥",
    concentration: "●",
  }[anomaly.kind];
  return (
    <button
      onClick={onClick}
      disabled={!anomaly.instanceId}
      className={`text-left p-3 rounded-lg border transition-colors ${sevStyle} ${
        anomaly.instanceId ? "hover:border-accent cursor-pointer" : "cursor-default"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-text text-xs font-bold truncate">{anomaly.title}</p>
          <p className="text-text-dim text-[10px] mt-1 leading-snug">{anomaly.detail}</p>
        </div>
      </div>
    </button>
  );
}

// --- Shared helpers --------------------------------------------------------

const chartTooltip = {
  contentStyle: { background: "#111", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12, padding: "8px 12px" },
  labelStyle: { color: "#666", marginBottom: 4 },
  itemStyle: { padding: "2px 0" },
  cursor: { fill: "rgba(255,255,255,0.03)" },
};
const axisStyle = { stroke: "#555", fill: "#888", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" };
const gridStyle = { stroke: "#1a1a1a", strokeDasharray: "none" };

function formatBucketTime(iso: string, period: Period): string {
  const d = new Date(iso);
  if (period === "7d" || period === "30d") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function eventTypeColor(type: string): string {
  if (type.startsWith("llm.")) return "text-accent";
  if (type === "tool.call") return "text-yellow";
  if (type === "tool.result") return "text-text-muted";
  if (type === "tool.pending") return "text-yellow";
  if (type === "tool.approved") return "text-green";
  if (type === "tool.rejected") return "text-red";
  if (type === "thread.spawn") return "text-green";
  if (type === "thread.done") return "text-blue";
  if (type === "thread.message") return "text-blue";
  if (type.startsWith("event.")) return "text-cyan";
  if (type.includes("error")) return "text-red";
  return "text-text-dim";
}

function formatEventDetail(e: { type: string; data?: Record<string, any> }): string {
  const d = e.data || {};
  switch (e.type) {
    case "llm.done": return d.message || "";
    case "llm.error": return d.error || "";
    case "tool.call":
    case "tool.pending":
      return d.name
        ? `${d.name}${d.args ? "(" + Object.entries(d.args).map(([k, v]) => {
          const s = String(v);
          return `${k}=${s.length > 50 ? s.slice(0, 50) + "..." : s}`;
        }).join(", ") + ")" : ""}`
        : "";
    case "tool.result":
      return `${d.name || ""}${d.result ? " — " + (d.result.length > 100 ? d.result.slice(0, 100) + "..." : d.result) : ""}`;
    case "tool.approved": return `${d.name} approved`;
    case "tool.rejected": return `${d.name} rejected`;
    case "thread.spawn": return d.directive || "spawned";
    case "thread.done": return d.result || "done";
    case "thread.message": return `${d.from} → ${d.to}`;
    case "event.received": return `[${d.source}] ${d.message || ""}`;
    default: return d.message || d.error || d.result || "";
  }
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: string }) {
  const valueColor = highlight === "red" ? "text-red" : "text-text";
  return (
    <div className="border border-border rounded-lg px-4 py-3 bg-bg-card">
      <div className="text-text-muted text-xs">{label}</div>
      <div className={`${valueColor} text-lg font-bold mt-1 tabular-nums`}>{value}</div>
      {sub && <div className="text-text-dim text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
