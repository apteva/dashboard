import { useEffect, useState, useRef } from "react";
import type { SubscribeFn } from "./InstanceView";

// LiveStatsBar aggregates llm.done telemetry events and displays running
// totals + a simple per-day cost projection — the dashboard equivalent of
// the CLI/TUI token strip.
//
// Data source: InstanceView's synchronous event subscriber. Every llm.done
// event carries `tokens_in`, `tokens_cached`, `tokens_out`, `cost_usd`,
// `duration_ms`, `iteration` (see core/telemetry.go LLMDoneData) so we just
// sum them as they stream in.
//
// Projection: total cost divided by elapsed wall-clock since the first
// event, multiplied up to hour/day. It's a naive extrapolation — an idle
// instance that suddenly wakes up will swing the estimate wildly — but it
// matches what the TUI does and is useful for spotting runaway burn.
//
// Reset: props-driven via instanceId. When the user switches tabs to a
// different instance the component remounts with fresh zeros.
export function LiveStatsBar({
  instanceId,
  subscribe,
}: {
  instanceId: number;
  subscribe: SubscribeFn;
}) {
  const [stats, setStats] = useState({
    iters: 0,
    tokensIn: 0,
    tokensCached: 0,
    tokensOut: 0,
    costUSD: 0,
    firstAt: 0, // ms since epoch when the first llm.done landed
    lastAt: 0,  // ms since epoch of the most recent llm.done
    lastModel: "",
  });

  // Sliding window of recent llm.done samples for the smart rate estimate.
  // We keep (time, cost) pairs and trim entries older than WINDOW_MS. The
  // projection uses this window instead of the session average so that:
  //   - bursts show up immediately (rate jumps when iters land close together)
  //   - idle decays smoothly (as events age out of the window, rate drops to 0)
  //   - a long-past burst doesn't permanently inflate the session average
  const WINDOW_MS = 3 * 60 * 1000; // 3-minute sliding window
  const recentRef = useRef<{ t: number; cost: number }[]>([]);

  // Refs mirror state so the subscribe callback (bound once per mount) can
  // accumulate without stale closures. Without this pattern, React's
  // functional setState would work but debugging is harder because each
  // callback only sees the snapshot at subscribe time.
  const statsRef = useRef(stats);
  statsRef.current = stats;

  // Re-render every second while live so the per-day projection ticks
  // forward even when no new events land. If we only repainted on
  // llm.done, an idle instance would show stale $/day until the next LLM
  // call — misleading.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Reset when switching instances.
  useEffect(() => {
    setStats({
      iters: 0,
      tokensIn: 0,
      tokensCached: 0,
      tokensOut: 0,
      costUSD: 0,
      firstAt: 0,
      lastAt: 0,
      lastModel: "",
    });
    recentRef.current = [];
  }, [instanceId]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "llm.done") return;
      const data = event.data || {};
      // Use the event's own wall-clock time rather than Date.now() so
      // historical telemetry replay (ChatPanel seeds with 500 past
      // events on mount) produces correct rate projections over the
      // real elapsed interval instead of bursting everything into
      // "now" and dividing by zero.
      const eventTime = new Date(event.time).getTime() || Date.now();
      const cost = Number(data.cost_usd) || 0;
      recentRef.current.push({ t: eventTime, cost });
      // Trim entries outside the window relative to the most recent
      // event seen, which may still be a historical event during replay.
      const cutoff = eventTime - WINDOW_MS;
      while (recentRef.current.length > 0 && recentRef.current[0].t < cutoff) {
        recentRef.current.shift();
      }
      setStats((prev) => {
        const firstAt = prev.firstAt === 0 ? eventTime : Math.min(prev.firstAt, eventTime);
        return {
          iters: prev.iters + 1,
          tokensIn: prev.tokensIn + (Number(data.tokens_in) || 0),
          tokensCached: prev.tokensCached + (Number(data.tokens_cached) || 0),
          tokensOut: prev.tokensOut + (Number(data.tokens_out) || 0),
          costUSD: prev.costUSD + cost,
          firstAt,
          lastAt: Math.max(prev.lastAt, eventTime),
          lastModel: String(data.model || prev.lastModel),
        };
      });
    });
  }, [subscribe]);

  // Derived fields — recomputed every render (once per second via the tick).
  const now = Date.now();
  const elapsedSec = stats.firstAt === 0 ? 0 : (now - stats.firstAt) / 1000;

  // Trim on every render so the windowed rate decays even when no new
  // events land. Without this, $/hr would freeze at the last-event value
  // instead of drifting down during idle.
  const cutoff = now - WINDOW_MS;
  while (recentRef.current.length > 0 && recentRef.current[0].t < cutoff) {
    recentRef.current.shift();
  }
  const recent = recentRef.current;

  // Rate: cost accumulated within the window divided by the FULL window
  // span (not by actual elapsed). Using actual elapsed scales tiny early
  // samples into wild projections — one $0.03 event at 2 s elapsed would
  // otherwise project to $54/hr. Fixed-window denominator means early
  // bursts are diluted instead of amplified, and as the agent runs
  // longer the full window fills up naturally. The window is 3 minutes
  // so the rate still responds to bursts and idle within ~3 min.
  //
  // projUsable gates the display until we have enough signal to trust
  // the projection: at least 3 iterations AND 30 s of wall-clock. Below
  // that, the bar shows "—" instead of a garbage number.
  const windowCost = recent.reduce((s, e) => s + e.cost, 0);
  const projUsable = elapsedSec >= 30 && stats.iters >= 3;
  const costPerHour = projUsable ? (windowCost / (WINDOW_MS / 1000)) * 3600 : 0;
  const costPerDay = costPerHour * 24;

  // Session average — shown in the tooltip so the user can compare the
  // smoothed burn against the lifetime burn.
  const sessionPerHour =
    elapsedSec >= 5 ? (stats.costUSD / elapsedSec) * 3600 : 0;
  const sessionPerDay = sessionPerHour * 24;
  const idleSec = stats.lastAt === 0 ? 0 : (now - stats.lastAt) / 1000;

  const nothingYet = stats.iters === 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-1.5 border-b border-border bg-bg-card/40 text-[10px] font-mono">
      <StatCell
        label="iters"
        value={nothingYet ? "—" : stats.iters.toString()}
      />
      <StatCell
        label="↑ in"
        value={nothingYet ? "—" : fmtTokens(stats.tokensIn)}
        title={`${stats.tokensIn.toLocaleString()} prompt tokens`}
      />
      <StatCell
        label="cached"
        value={nothingYet ? "—" : fmtTokens(stats.tokensCached)}
        title={`${stats.tokensCached.toLocaleString()} cached tokens (included in ↑ in)`}
        muted
      />
      <StatCell
        label="↓ out"
        value={nothingYet ? "—" : fmtTokens(stats.tokensOut)}
        title={`${stats.tokensOut.toLocaleString()} completion tokens`}
      />
      <StatCell
        label="cost"
        value={nothingYet ? "—" : `$${fmtCost(stats.costUSD)}`}
        title={`Total spend since stats started: $${stats.costUSD.toFixed(6)}`}
      />
      <StatCell
        label="$/hr"
        value={!projUsable ? "—" : `$${fmtCost(costPerHour)}`}
        title={
          !projUsable
            ? "Projected hourly cost at current burn rate"
            : `Projected hourly cost — rolling ${Math.round(
                WINDOW_MS / 60000,
              )}-min window.\nSession average: $${fmtCost(
                sessionPerHour,
              )}/hr\nIdle: ${idleSec < 1 ? "<1" : Math.round(idleSec)}s since last LLM call`
        }
        muted
      />
      <StatCell
        label="$/day"
        value={!projUsable ? "—" : `$${fmtCost(costPerDay)}`}
        title={
          !projUsable
            ? "Projected daily cost at current burn rate"
            : `Projected daily cost — rolling ${Math.round(
                WINDOW_MS / 60000,
              )}-min window.\nSession average: $${fmtCost(sessionPerDay)}/day`
        }
      />
      {stats.lastModel && (
        <span
          className="text-text-dim truncate ml-auto"
          title={`Current model: ${stats.lastModel}`}
        >
          {shortenModel(stats.lastModel)}
        </span>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  title,
  muted,
}: {
  label: string;
  value: string;
  title?: string;
  muted?: boolean;
}) {
  return (
    <span className="flex items-center gap-1" title={title}>
      <span className={muted ? "text-text-dim" : "text-text-muted"}>
        {label}
      </span>
      <span className={muted ? "text-text-muted" : "text-text"}>{value}</span>
    </span>
  );
}

// Token formatting — the CLI shows raw ints for small counts and switches to
// "K" / "M" suffixes for big ones. We do the same: 7,222 → "7.2K", 229,000
// → "229K", 1,250,000 → "1.25M".
function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) {
    // Drop the decimal past 100K to keep the bar compact.
    const k = n / 1000;
    return k >= 100 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`;
  }
  const m = n / 1_000_000;
  return m >= 100 ? `${Math.round(m)}M` : `${m.toFixed(2)}M`;
}

// Cost formatting — compact enough to fit in the bar without losing the
// precision you want for small amounts. Sub-cent totals get 4 decimals,
// single-digit dollars get 2, bigger numbers get 0.
function fmtCost(usd: number): string {
  if (usd < 0.01) return usd.toFixed(4);
  if (usd < 10) return usd.toFixed(2);
  if (usd < 1000) return usd.toFixed(1);
  return Math.round(usd).toString();
}

// Trim noisy model slugs so we fit in the bar. "accounts/fireworks/routers/
// kimi-k2p5-turbo" → "kimi-k2p5-turbo".
function shortenModel(m: string): string {
  const slash = m.lastIndexOf("/");
  return slash >= 0 ? m.slice(slash + 1) : m;
}
