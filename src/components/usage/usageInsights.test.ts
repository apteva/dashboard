import { describe, expect, test } from "bun:test";
import { usageInsights } from "./usageInsights";
import { usageReport } from "./usageFixtures";

describe("usage insights", () => {
  test("stays quiet on a normal period", () => {
    expect(usageInsights(usageReport())).toEqual([]);
  });

  test("flags failing groups first and caps the list at three", () => {
    const base = usageReport();
    const report = usageReport({
      totals: { ...base.totals, cost: 40, unpriced_calls: 3 },
      previous: { ...base.previous, cost: 10 },
      groups: [{ ...base.groups[0], cost: 40, errors: 10, calls: 20 }, base.groups[1]],
    });
    const insights = usageInsights(report);
    expect(insights).toHaveLength(3);
    expect(insights[0].id).toBe("errors-1");
    expect(insights[1].id).toBe("spend-up");
  });
});
