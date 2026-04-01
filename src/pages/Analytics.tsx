import { useState, useEffect } from "react";
import { instances, telemetry, type Instance, type TelemetryStats, type TelemetryEvent } from "../api";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

type Period = "1h" | "24h" | "7d";

const COLORS = ["#f97316", "#3b82f6", "#a855f7", "#eab308", "#06b6d4", "#ec4899", "#6366f1", "#84cc16"];

export function Analytics() {
  const [instance, setInstance] = useState<Instance | null>(null);
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [period, setPeriod] = useState<Period>("24h");
  const [timeline, setTimeline] = useState<any[]>([]);
  const [recentEvents, setRecentEvents] = useState<TelemetryEvent[]>([]);
  const [allEvents, setAllEvents] = useState<TelemetryEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<string>("");
  const [toolBreakdown, setToolBreakdown] = useState<Record<string, number>>({});
  const [threadCosts, setThreadCosts] = useState<Record<string, number>>({});

  useEffect(() => {
    instances.list().then((list) => {
      if (list && list.length > 0) setInstance(list[0]);
    });
  }, []);

  useEffect(() => {
    if (!instance) return;

    const load = () => {
      telemetry.stats(instance.id, period).then(setStats).catch(() => {});
      telemetry.timeline(instance.id, period).then((data) => {
        setTimeline(data || []);
        // Compute per-thread costs from timeline
        const costs: Record<string, number> = {};
        for (const bucket of data || []) {
          for (const [thread, count] of Object.entries(bucket.threads || {})) {
            const perCall = bucket.llm_calls > 0 ? bucket.cost / bucket.llm_calls : 0;
            costs[thread] = (costs[thread] || 0) + perCall * (count as number);
          }
        }
        setThreadCosts(costs);
      }).catch(() => {});
      telemetry.query(instance.id, "llm.done", 50).then((e) => setRecentEvents(e || [])).catch(() => {});
      telemetry.query(instance.id, undefined, 200).then((e) => setAllEvents(e || [])).catch(() => {});
      telemetry.query(instance.id, "tool", 200).then((events) => {
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
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [instance, period]);

  if (!instance) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-4">
          <h1 className="text-text text-lg font-bold">Analytics</h1>
        </div>
        <div className="flex-1 p-6">
          <p className="text-text-muted text-sm">No instance running. Create one from the Dashboard.</p>
        </div>
      </div>
    );
  }

  // Projected cost — mirrors TUI logic: cost/iter * (1h / (thinkTime + sleepTime))
  // Uses each thread's actual pace/sleep duration to project realistically
  const projectedPerHour = (() => {
    if (recentEvents.length < 2) return stats ? stats.total_cost / Math.max(period === "1h" ? 1 : period === "24h" ? 24 : 168, 1) : 0;
    const byThread: Record<string, { totalCost: number; iterations: number; lastRate: string; times: number[] }> = {};
    for (const e of recentEvents) {
      const tid = e.thread_id || "main";
      if (!byThread[tid]) byThread[tid] = { totalCost: 0, iterations: 0, lastRate: "30s", times: [] };
      byThread[tid].iterations++;
      if (e.data?.cost_usd) byThread[tid].totalCost += e.data.cost_usd;
      if (e.data?.rate) byThread[tid].lastRate = e.data.rate;
      if (e.time) byThread[tid].times.push(new Date(e.time).getTime());
    }
    let rate = 0;
    for (const [, data] of Object.entries(byThread)) {
      if (data.iterations === 0 || data.totalCost === 0) continue;
      const costPerIter = data.totalCost / data.iterations;
      const sleepMs = parseRateToMs(data.lastRate);
      // Estimate avg think duration from actual event intervals
      let avgThinkMs = 3000; // default 3s
      if (data.times.length >= 2) {
        const sorted = data.times.sort((a, b) => a - b);
        const totalSpan = sorted[sorted.length - 1] - sorted[0];
        avgThinkMs = Math.max(totalSpan / data.iterations - sleepMs, 1000);
      }
      if (avgThinkMs > sleepMs) avgThinkMs = 2000; // cap like TUI does
      const cycleMs = Math.max(avgThinkMs + sleepMs, 1000);
      const itersPerHour = 3600000 / cycleMs;
      rate += costPerIter * itersPerHour;
    }
    return rate;
  })();
  const costPerDay = projectedPerHour * 24;
  const costPerMonth = costPerDay * 30;

  const cacheHitRate = recentEvents.length > 0
    ? recentEvents.reduce((sum, e) => sum + (e.data?.tokens_cached || 0), 0) /
      Math.max(recentEvents.reduce((sum, e) => sum + (e.data?.tokens_in || 0), 0), 1) * 100
    : 0;

  // Prepare timeline data for charts
  const timelineData = timeline.map((b) => ({
    ...b,
    time: new Date(b.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));

  // Cumulative cost
  let cumCost = 0;
  const costTimeline = timeline.map((b) => {
    cumCost += b.cost;
    return {
      time: new Date(b.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      cost: cumCost,
    };
  });

  // Thread names from timeline
  const allThreads = new Set<string>();
  for (const b of timeline) {
    for (const t of Object.keys(b.threads || {})) allThreads.add(t);
  }
  const threadNames = Array.from(allThreads);

  // Thread activity data for area chart
  const threadTimeline = timeline.map((b) => {
    const entry: any = { time: new Date(b.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    for (const t of threadNames) {
      entry[t] = (b.threads || {})[t] || 0;
    }
    return entry;
  });

  // Cost by thread for pie chart
  const threadCostData = Object.entries(threadCosts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({ name, value: Number(value.toFixed(4)) }));

  // Tool breakdown for horizontal bar
  const toolData = Object.entries(toolBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name: name.length > 25 ? name.slice(0, 25) + "..." : name, count }));

  const chartTooltip = {
    contentStyle: { background: "#111", border: "1px solid #2a2a2a", borderRadius: 8, fontSize: 12, padding: "8px 12px" },
    labelStyle: { color: "#666", marginBottom: 4 },
    itemStyle: { padding: "2px 0" },
    cursor: { fill: "rgba(255,255,255,0.03)" },
  };
  const axisStyle = { stroke: "#555", fill: "#888", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" };
  const gridStyle = { stroke: "#1a1a1a", strokeDasharray: "none" };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-text text-lg font-bold">Analytics</h1>
        <div className="flex gap-2">
          {(["1h", "24h", "7d"] as Period[]).map((p) => (
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
        {stats && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Total Cost" value={`$${stats.total_cost.toFixed(4)}`} sub={period} />
              <StatCard label="Projected/Day" value={`$${costPerDay.toFixed(3)}`} sub="based on recent activity" />
              <StatCard label="Projected/Month" value={`$${costPerMonth.toFixed(2)}`} />
              <StatCard label="LLM Calls" value={String(stats.llm_calls)} sub={`${formatNumber(stats.total_tokens_in)} tok in`} />
              <StatCard label="Cache Rate" value={`${cacheHitRate.toFixed(0)}%`} />
              <StatCard label="Errors" value={String(stats.errors)} highlight={stats.errors > 0 ? "red" : undefined} />
            </div>

            {/* Activity Timeline */}
            {threadTimeline.length > 1 && (
              <section>
                <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Activity by Thread</h2>
                <div className="border border-border rounded-lg bg-bg-card p-4 pt-6" style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <AreaChart data={threadTimeline}>
                      <CartesianGrid {...gridStyle} />
                      <XAxis dataKey="time" {...axisStyle} tickLine={false} axisLine={false} />
                      <YAxis {...axisStyle} tickLine={false} axisLine={false} />
                      <Tooltip {...chartTooltip} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#666" }} />
                      {threadNames.map((t, i) => (
                        <Area key={t} type="monotone" dataKey={t} stackId="1"
                          fill={COLORS[i % COLORS.length]} stroke={COLORS[i % COLORS.length]}
                          fillOpacity={0.3} strokeWidth={1.5} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Cost + Tokens row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Cost Over Time */}
              {costTimeline.length > 1 && (
                <section>
                  <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Cumulative Cost</h2>
                  <div className="border border-border rounded-lg bg-bg-card p-4 pt-6" style={{ height: 230 }}>
                    <ResponsiveContainer>
                      <AreaChart data={costTimeline}>
                        <defs>
                          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid {...gridStyle} />
                        <XAxis dataKey="time" {...axisStyle} tickLine={false} axisLine={false} />
                        <YAxis {...axisStyle} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                        <Tooltip {...chartTooltip} formatter={(v: number) => `$${v.toFixed(4)}`} />
                        <Area type="monotone" dataKey="cost" stroke="#f97316" strokeWidth={2} fill="url(#costGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Token Usage */}
              {timelineData.length > 1 && (
                <section>
                  <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Token Usage</h2>
                  <div className="border border-border rounded-lg bg-bg-card p-4 pt-6" style={{ height: 230 }}>
                    <ResponsiveContainer>
                      <BarChart data={timelineData}>
                        <CartesianGrid {...gridStyle} />
                        <XAxis dataKey="time" {...axisStyle} tickLine={false} axisLine={false} />
                        <YAxis {...axisStyle} tickLine={false} axisLine={false} />
                        <Tooltip {...chartTooltip} />
                        <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#666" }} />
                        <Bar dataKey="tokens_in" name="Input" fill="#3b82f6" radius={[2, 2, 0, 0]} opacity={0.8} />
                        <Bar dataKey="tokens_out" name="Output" fill="#f97316" radius={[2, 2, 0, 0]} opacity={0.8} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
            </div>

            {/* Thread Cost + Tool Usage row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Cost by Thread */}
              {threadCostData.length > 0 && (
                <section>
                  <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Cost by Thread</h2>
                  <div className="border border-border rounded-lg bg-bg-card p-4" style={{ height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart data={threadCostData} layout="vertical" margin={{ left: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                        <XAxis type="number" {...axisStyle} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                        <YAxis type="category" dataKey="name" {...axisStyle} tickLine={false} axisLine={false} width={80} />
                        <Tooltip {...chartTooltip} formatter={(v: number) => `$${v.toFixed(4)}`} />
                        <Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} opacity={0.8} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

              {/* Tool Usage */}
              {toolData.length > 0 && (
                <section>
                  <h2 className="text-text text-sm font-bold mb-3 uppercase tracking-wide">Top Tools</h2>
                  <div className="border border-border rounded-lg bg-bg-card p-4" style={{ height: 220 }}>
                    <ResponsiveContainer>
                      <BarChart data={toolData} layout="vertical" margin={{ left: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
                        <XAxis type="number" {...axisStyle} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" {...axisStyle} tickLine={false} axisLine={false} width={80} />
                        <Tooltip {...chartTooltip} />
                        <Bar dataKey="count" fill="#f97316" radius={[0, 4, 4, 0]} opacity={0.8} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
            </div>

            {/* Event Stream */}
            {allEvents.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-text text-sm font-bold uppercase tracking-wide">Event Stream</h2>
                  <div className="flex gap-1.5">
                    {["", "llm", "tool", "thread", "event"].map((f) => (
                      <button
                        key={f}
                        onClick={() => setEventFilter(f)}
                        className={`px-2.5 py-1 rounded text-xs transition-colors ${
                          eventFilter === f
                            ? "bg-accent text-bg font-bold"
                            : "text-text-muted border border-border hover:text-text"
                        }`}
                      >
                        {f || "all"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border border-border rounded-lg bg-bg-card divide-y divide-border max-h-[500px] overflow-y-auto">
                  {allEvents
                    .filter((e) => !eventFilter || e.type.startsWith(eventFilter + "."))
                    .map((e) => (
                    <div key={e.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-text-muted text-xs">{new Date(e.time).toLocaleTimeString()}</span>
                          <span className={`text-xs font-bold ${eventTypeColor(e.type)}`}>{e.type}</span>
                          <span className="text-text-dim text-xs">{e.thread_id}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          {e.type === "llm.done" && e.data?.tokens_in && (
                            <>
                              {e.data.model && <span className="text-blue">{e.data.model.split("/").pop()}</span>}
                              <span>{e.data.tokens_in}→{e.data.tokens_out} tok</span>
                              <span>{e.data.duration_ms}ms</span>
                              {e.data.cost_usd && <span className="text-accent">${e.data.cost_usd.toFixed(4)}</span>}
                            </>
                          )}
                          {e.type === "tool.result" && (
                            <>
                              <span className={e.data?.success ? "text-green" : "text-red"}>{e.data?.success ? "ok" : "fail"}</span>
                              <span>{e.data?.duration_ms}ms</span>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="text-text-dim text-xs mt-0.5 truncate">
                        {formatEventDetail(e)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!stats && <p className="text-text-muted text-sm">Loading analytics...</p>}
      </div>
    </div>
  );
}

// Parse rate strings like "2s", "30s", "5m", "1h" to milliseconds
function parseRateToMs(rate: string): number {
  if (!rate) return 30000;
  const match = rate.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|ms)$/);
  if (!match) return 30000;
  const val = parseFloat(match[1]);
  switch (match[2]) {
    case "ms": return val;
    case "s": return val * 1000;
    case "m": return val * 60000;
    case "h": return val * 3600000;
    default: return 30000;
  }
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
    case "llm.done":
      return d.message || "";
    case "llm.error":
      return d.error || "";
    case "tool.call":
    case "tool.pending":
      return d.name ? `${d.name}${d.args ? "(" + Object.entries(d.args).map(([k, v]) => {
        const s = String(v);
        return `${k}=${s.length > 50 ? s.slice(0, 50) + "..." : s}`;
      }).join(", ") + ")" : ""}` : "";
    case "tool.result":
      return `${d.name || ""}${d.result ? " — " + (d.result.length > 100 ? d.result.slice(0, 100) + "..." : d.result) : ""}`;
    case "tool.approved":
      return `${d.name} approved`;
    case "tool.rejected":
      return `${d.name} rejected`;
    case "thread.spawn":
      return d.directive || "spawned";
    case "thread.done":
      return d.result || "done";
    case "thread.message":
      return `${d.from} → ${d.to}`;
    case "event.received":
      return `[${d.source}] ${d.message || ""}`;
    default:
      return d.message || d.error || d.result || "";
  }
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: string }) {
  const valueColor = highlight === "red" ? "text-red" : "text-text";
  return (
    <div className="border border-border rounded-lg px-4 py-3 bg-bg-card">
      <div className="text-text-muted text-xs">{label}</div>
      <div className={`${valueColor} text-lg font-bold mt-1`}>{value}</div>
      {sub && <div className="text-text-dim text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
