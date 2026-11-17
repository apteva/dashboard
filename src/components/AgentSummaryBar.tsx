import { useEffect, useState } from "react";
import { telemetry, type Agent, type TelemetryStats } from "../api";
import type { SubscribeFn } from "./AgentView";

/** One usage request shared by the summary and diagnostics. */
export function useAgentUsage(agentId: number, subscribe: SubscribeFn) {
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    setStats(null);
    setError(false);
    const load = async () => {
      if (loading || cancelled) return;
      loading = true;
      try {
        const next = await telemetry.stats(agentId, "24h");
        if (!cancelled) { setStats(next); setError(false); }
      } catch { if (!cancelled) setError(true); }
      finally { loading = false; }
    };
    void load();
    const timer = setInterval(load, 30000);
    const unsubscribe = subscribe((event) => {
      if (!["llm.done", "llm.error", "tool.result"].includes(event.type) || pending) return;
      pending = setTimeout(() => { pending = undefined; void load(); }, 1000);
    });
    return () => { cancelled = true; clearInterval(timer); clearTimeout(pending); unsubscribe(); };
  }, [agentId, subscribe]);
  return { stats, error };
}

export type AgentUsage = ReturnType<typeof useAgentUsage>;

/** Persistent summary, separate from the operator's app widget layout. */
export function AgentSummaryBar({ instance, usage }: { instance: Agent; usage: AgentUsage }) {
  const { stats, error } = usage;
  const hasUsage = stats && (stats.llm_calls > 0 || stats.tool_calls > 0 || stats.errors > 0 || stats.total_cost > 0);
  return <div className="flex shrink-0 items-center gap-4 [&>span]:shrink-0 overflow-x-auto whitespace-nowrap border-b border-border px-3 py-2 text-[11px] text-text-muted sm:px-4" aria-label="Agent summary">
    <span className="capitalize">{instance.mode || "autonomous"}</span>
    <span className="h-3 border-l border-border" aria-hidden="true" />
    {hasUsage ? <>
      <span className="text-text-dim">Last 24h</span>
      <span title="Recorded provider cost; some providers do not report billing data">Recorded cost <strong className="font-medium tabular-nums text-text">${stats.total_cost.toFixed(4)}</strong></span>
      <span>Model calls <strong className="font-medium tabular-nums text-text">{stats.llm_calls.toLocaleString()}</strong></span>
      <span>Tool calls <strong className="font-medium tabular-nums text-text">{stats.tool_calls.toLocaleString()}</strong></span>
      {stats.errors > 0 && <span className="text-red">{stats.errors.toLocaleString()} errors</span>}
    </> : <span>{stats ? "No recorded usage in the last 24h" : error ? "Usage unavailable" : "Loading usage…"}</span>}
    {error && stats && <span role="status" className="text-yellow">Showing last update · refresh unavailable</span>}
  </div>;
}
