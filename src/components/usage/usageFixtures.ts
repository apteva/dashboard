import type { UsageReport } from "../../api";

const empty = { cost: 0, included_cost: 0, calls: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, errors: 0, unpriced_calls: 0, active_agents: 0 };

export function usageReport(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    period: "7d",
    group_by: "agent",
    since: "2026-10-24T00:00:00Z",
    until: "2026-10-31T00:00:00Z",
    bucket_minutes: 360,
    agents: 3,
    totals: { cost: 12.5, included_cost: 4, calls: 120, tokens_in: 100_000, tokens_out: 20_000, tokens_cached: 40_000, errors: 2, unpriced_calls: 0, active_agents: 2 },
    previous: { ...empty, cost: 10, calls: 100, tokens_in: 90_000, tokens_out: 10_000 },
    daily_run_rate: 1.5,
    run_rate_days: 7,
    timeline: [
      { time: "2026-10-30T00:00:00Z", cost: 5, included_cost: 1, calls: 50, tokens_in: 40_000, tokens_out: 8_000, errors: 1, series: { "1": { cost: 5, included_cost: 0, calls: 30, tokens: 30_000 }, "2": { cost: 0, included_cost: 1, calls: 20, tokens: 18_000 } } },
      { time: "2026-10-30T06:00:00Z", cost: 7.5, included_cost: 3, calls: 70, tokens_in: 60_000, tokens_out: 12_000, errors: 1, series: { "1": { cost: 7.5, included_cost: 0, calls: 40, tokens: 42_000 }, "2": { cost: 0, included_cost: 3, calls: 30, tokens: 30_000 } } },
    ],
    groups: [
      { key: "1", label: "Writer", billing: "metered", agent_id: 1, status: "running", cost: 12.5, included_cost: 0, calls: 70, tokens_in: 60_000, tokens_out: 12_000, tokens_cached: 30_000, errors: 2, unpriced_calls: 0 },
      { key: "2", label: "Coder", billing: "subscription", agent_id: 2, status: "running", cost: 0, included_cost: 4, calls: 50, tokens_in: 40_000, tokens_out: 8_000, tokens_cached: 10_000, errors: 0, unpriced_calls: 0 },
    ],
    ...overrides,
  };
}
