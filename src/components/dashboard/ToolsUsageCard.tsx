// Top-N tools by call count over the past 24h, across every agent in
// the project. Surfaces:
//
//   - which tools are doing the work (volume bar)
//   - which are failing (yellow tail with error count)
//   - reach (how many distinct agents called each one)
//
// Errors-first ordering is deliberate: a tool with 12 calls and 12
// failures is more important to surface than a tool with 200 clean
// calls. We sort by error count desc, then by call count desc.

import { useEffect, useState } from "react";
import { telemetry, type ProjectToolStat } from "../../api";
import { useProjects } from "../../hooks/useProjects";

const REFRESH_MS = 30_000;
const PERIOD = "24h";
const TOP_N = 8;

export function ToolsUsageCard() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [stats, setStats] = useState<ProjectToolStat[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      telemetry.projectTools(projectId, PERIOD)
        .then((s) => { if (!cancelled) setStats(s); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId]);

  // Errors first, then calls. Same call-count gets stable name sort
  // from the server already; we re-sort to surface failures.
  const sorted = [...stats].sort((a, b) => {
    if (a.errors !== b.errors) return b.errors - a.errors;
    return b.calls - a.calls;
  }).slice(0, TOP_N);

  const max = sorted.reduce((m, t) => Math.max(m, t.calls), 0);

  return (
    <div className="border border-border rounded-lg p-3 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-text-dim uppercase tracking-wide">Tools · 24h</div>
        <div className="text-xs text-text-muted">
          {stats.reduce((acc, t) => acc + t.calls, 0)} calls
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-text-dim text-sm py-6 text-center">
          no tool calls yet
        </div>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {sorted.map((t) => {
            const pct = max > 0 ? (t.calls / max) * 100 : 0;
            const errPct = t.calls > 0 ? (t.errors / t.calls) * 100 : 0;
            return (
              <li key={t.name} className="flex items-center gap-2">
                <span
                  className="flex-1 truncate text-text"
                  title={`${t.name} · ${t.agents} agent${t.agents === 1 ? "" : "s"}`}
                >
                  {t.name}
                </span>
                <div className="w-20 h-2 rounded-full bg-bg-input overflow-hidden flex">
                  {/* Success portion */}
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${pct - (pct * errPct / 100)}%` }}
                  />
                  {/* Error portion */}
                  {t.errors > 0 && (
                    <div
                      className="h-full bg-yellow"
                      style={{ width: `${pct * errPct / 100}%` }}
                      title={`${t.errors} error${t.errors === 1 ? "" : "s"}`}
                    />
                  )}
                </div>
                <span className="w-10 text-right text-text-muted tabular-nums">
                  {t.calls}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {stats.some((t) => t.errors > 0) && (
        <div className="mt-3 pt-3 border-t border-border text-[11px] text-yellow">
          ⚠ {stats.reduce((acc, t) => acc + t.errors, 0)} failures across{" "}
          {stats.filter((t) => t.errors > 0).length} tool
          {stats.filter((t) => t.errors > 0).length === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
