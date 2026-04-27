// Top-of-dashboard KPI strip — five tiles that summarise project state
// at a glance. Recomputed every 5s from /telemetry/project-stats and
// /instances. Each tile links to the most useful place to drill in.
//
// Designed to be readable in <0.5s. No heavy charts here; the
// CostCard and ToolsUsageCard handle deeper visualisation below.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { instances, telemetry, type Instance, type InstanceStats } from "../../api";
import { useProjects } from "../../hooks/useProjects";

const PERIOD = "24h";
const REFRESH_MS = 5000;

export function PulseStrip() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [insts, setInsts] = useState<Instance[]>([]);
  const [stats, setStats] = useState<InstanceStats[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([
        instances.list(projectId).catch(() => [] as Instance[]),
        telemetry.projectStats(projectId, PERIOD).catch(() => [] as InstanceStats[]),
      ]).then(([list, st]) => {
        if (cancelled) return;
        setInsts(list);
        setStats(st);
      });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Aggregate per-instance stats into project totals. We can't trust
  // sum-of-instance counts when the projectStats endpoint omits zero-
  // event instances, but we don't need to — those instances contribute
  // 0 to every total anyway.
  const totals = stats.reduce(
    (acc, s) => ({
      tokens: acc.tokens + s.tokens_in + s.tokens_out,
      cost: acc.cost + s.cost,
      toolCalls: acc.toolCalls + s.tool_calls,
      llmCalls: acc.llmCalls + s.llm_calls,
      errors: acc.errors + s.errors,
    }),
    { tokens: 0, cost: 0, toolCalls: 0, llmCalls: 0, errors: 0 },
  );

  const running = insts.filter((i) => i.status === "running").length;
  const total = insts.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Tile
        label="agents"
        value={`${running} / ${total}`}
        sub={total === 0 ? "no agents" : `${running} running`}
        to="/agents"
        accent={total > 0 && running === 0 ? "muted" : "default"}
      />
      <Tile
        label="LLM calls / 24h"
        value={fmt(totals.llmCalls)}
        sub={`${fmt(totals.toolCalls)} tool calls`}
      />
      <Tile
        label="tokens / 24h"
        value={fmtTokens(totals.tokens)}
        sub={totals.tokens === 0 ? "—" : "in + out"}
      />
      <Tile
        label="cost / 24h"
        value={fmtCost(totals.cost)}
        sub={projectStatsSub(stats)}
      />
      <Tile
        label="errors / 24h"
        value={String(totals.errors)}
        sub={totals.errors === 0 ? "all green" : "see telemetry"}
        accent={totals.errors > 0 ? "warn" : "default"}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  to,
  accent = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  to?: string;
  accent?: "default" | "muted" | "warn";
}) {
  const valueColor =
    accent === "warn"
      ? "text-yellow"
      : accent === "muted"
      ? "text-text-muted"
      : "text-text";

  const inner = (
    <div className="border border-border rounded-lg px-4 py-3 hover:bg-bg-hover transition-colors">
      <div className="text-xs text-text-dim uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-1 ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
    </div>
  );

  return to ? <Link to={to}>{inner}</Link> : inner;
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

function fmtTokens(n: number): string {
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  if (n < 100) return "$" + n.toFixed(2);
  return "$" + Math.round(n).toLocaleString();
}

function projectStatsSub(stats: InstanceStats[]): string {
  if (stats.length === 0) return "—";
  // Show top spender so the user can spot a runaway agent fast.
  const top = [...stats].sort((a, b) => b.cost - a.cost)[0];
  if (!top || top.cost === 0) return `${stats.length} active`;
  return `top: ${top.name}`;
}
