import type { UsageReport } from "../../api";
import { errorRate, formatMoney, formatPercent, percentChange } from "./usageFormat";

export interface UsageInsight {
  id: string;
  tone: "warn" | "error" | "info";
  title: string;
  detail: string;
  groupKey?: string;
}

// At most three short signals worth a second look, most serious first.
// Thresholds are deliberately conservative so the strip stays quiet on a
// normal day.
export function usageInsights(report: UsageReport, limit = 3): UsageInsight[] {
  const out: UsageInsight[] = [];
  const { totals, previous, groups } = report;
  const noun = report.group_by === "agent" ? "agent" : report.group_by;

  for (const group of groups) {
    const rate = errorRate(group.errors, group.calls);
    if (group.errors >= 3 && rate >= 10) {
      out.push({
        id: `errors-${group.key}`,
        tone: "error",
        title: `${group.label}: ${formatPercent(rate)} of calls failed`,
        detail: `${group.errors} errors against ${group.calls} successful calls.`,
        groupKey: group.key,
      });
    }
  }

  const change = percentChange(totals.cost, previous.cost);
  if (change !== null && change >= 50 && totals.cost - previous.cost >= 1) {
    out.push({
      id: "spend-up",
      tone: "warn",
      title: `Spend up ${formatPercent(change)}`,
      detail: `${formatMoney(totals.cost)} vs ${formatMoney(previous.cost)} in the previous period.`,
    });
  }

  const spend = totals.cost + totals.included_cost;
  if (groups.length >= 3 && spend > 0) {
    const top = groups[0];
    const share = ((top.cost + top.included_cost) / spend) * 100;
    if (share >= 70) {
      out.push({
        id: `concentration-${top.key}`,
        tone: "info",
        title: `${top.label} is ${formatPercent(share)} of spend`,
        detail: `One ${noun} accounts for most of the cost in this period.`,
        groupKey: top.key,
      });
    }
  }

  if (totals.unpriced_calls > 0) {
    out.push({
      id: "unpriced",
      tone: "info",
      title: `${totals.unpriced_calls} call${totals.unpriced_calls === 1 ? "" : "s"} without a price`,
      detail: "Their models are not in the pricing table, so spend is understated.",
    });
  }

  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, limit);
}
