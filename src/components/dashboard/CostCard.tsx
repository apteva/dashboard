// 24h cost card — sparkline + per-instance breakdown.
//
// Data: /telemetry/project-timeline at 1h buckets. We don't have a
// per-provider breakdown in the timeline payload yet (it carries
// cost_by_instance), so the small pie below the spark is per-instance,
// not per-provider. That's actually the more actionable view: "which
// agent burned $X today" is what you want to chase.

import { useEffect, useMemo, useState } from "react";
import { telemetry, instances, type Instance, type ProjectTimelineBucket } from "../../api";
import { useProjects } from "../../hooks/useProjects";

const REFRESH_MS = 30_000;
const PERIOD = "24h";

export function CostCard() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [buckets, setBuckets] = useState<ProjectTimelineBucket[]>([]);
  const [nameById, setNameById] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([
        telemetry.projectTimeline(projectId, PERIOD).catch(() => [] as ProjectTimelineBucket[]),
        instances.list(projectId).catch(() => [] as Instance[]),
      ]).then(([t, list]) => {
        if (cancelled) return;
        setBuckets(t);
        setNameById(new Map(list.map((i) => [i.id, i.name])));
      });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  const total = useMemo(
    () => buckets.reduce((acc, b) => acc + b.cost, 0),
    [buckets],
  );

  // Per-instance totals over the window. Sorted by cost desc; cap to
  // top 5 + an "other" bucket so the breakdown stays readable on a
  // narrow card.
  const breakdown = useMemo(() => {
    const sums = new Map<number, number>();
    for (const b of buckets) {
      for (const [k, v] of Object.entries(b.cost_by_instance || {})) {
        const id = parseInt(k, 10);
        if (!Number.isFinite(id)) continue;
        sums.set(id, (sums.get(id) || 0) + v);
      }
    }
    const sorted = Array.from(sums.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const otherSum = sorted.slice(5).reduce((acc, [, v]) => acc + v, 0);
    if (otherSum > 0) top.push([-1, otherSum]);
    return top;
  }, [buckets]);

  const max = useMemo(
    () => buckets.reduce((m, b) => Math.max(m, b.cost), 0),
    [buckets],
  );

  return (
    <div className="border border-border rounded-lg p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-text-dim uppercase tracking-wide">Cost · 24h</div>
        <div className="text-xs text-text-muted">{buckets.length}h</div>
      </div>

      <div className="text-xl font-bold text-text mb-2">{fmtCost(total)}</div>

      {/* Sparkline — bars rather than path so each bucket is clickable
          / hoverable later if we want to drill in. Empty buckets render
          as a thin baseline so the timeline shape is still legible. */}
      <div className="flex items-end gap-0.5 h-8 mb-3">
        {buckets.length === 0 ? (
          <div className="text-text-dim text-xs">no data</div>
        ) : (
          buckets.map((b, i) => {
            const h = max > 0 ? Math.max(2, (b.cost / max) * 100) : 2;
            return (
              <div
                key={i}
                className="flex-1 bg-accent rounded-sm"
                style={{ height: `${h}%`, minHeight: "2px", opacity: b.cost > 0 ? 1 : 0.2 }}
                title={`${b.time}: ${fmtCost(b.cost)}`}
              />
            );
          })
        )}
      </div>

      {/* Per-instance breakdown */}
      <div className="space-y-1 text-xs">
        {breakdown.length === 0 ? (
          <div className="text-text-dim">no spend</div>
        ) : (
          breakdown.map(([id, v]) => {
            const pct = total > 0 ? (v / total) * 100 : 0;
            const name = id === -1 ? "other" : (nameById.get(id) || `#${id}`);
            return (
              <div key={id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-text-muted">{name}</span>
                <span className="text-text">{fmtCost(v)}</span>
                <span className="text-text-dim w-10 text-right">{pct.toFixed(0)}%</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  if (n < 100) return "$" + n.toFixed(2);
  return "$" + Math.round(n).toLocaleString();
}
