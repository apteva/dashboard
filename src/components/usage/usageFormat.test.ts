import { describe, expect, test } from "bun:test";
import { chartRows, chartSeries, defaultMetric, formatCount, formatMoney, OTHER_KEY, percentChange } from "./usageFormat";
import { usageReport } from "./usageFixtures";

describe("usage formatting", () => {
  test("money reads in cents, never sub-cent noise", () => {
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(0.0034)).toBe("<$0.01");
    expect(formatMoney(0.345)).toBe("$0.35");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(12_345.6)).toBe("$12,346");
  });

  test("counts scale with units", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1_200)).toBe("1.2K");
    expect(formatCount(34_000)).toBe("34K");
    expect(formatCount(2_000_000)).toBe("2M");
  });

  test("change without a baseline is null, not infinite", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(15, 10)).toBe(50);
  });

  test("default chart metric follows what was actually paid", () => {
    expect(defaultMetric(usageReport().totals)).toBe("cost");
    expect(defaultMetric({ ...usageReport().totals, cost: 0 })).toBe("value");
    expect(defaultMetric({ ...usageReport().totals, cost: 0, included_cost: 0 })).toBe("tokens");
  });
});

describe("chart series", () => {
  test("only groups with a value for the metric are drawn", () => {
    const report = usageReport();
    expect(chartSeries(report, "cost").map((s) => s.key)).toEqual(["1"]);
    expect(chartSeries(report, "value").map((s) => s.key)).toEqual(["1", "2"]);
  });

  test("beyond five groups the rest fold into Other and colors stay with groups", () => {
    const base = usageReport();
    const groups = Array.from({ length: 7 }, (_, i) => ({ ...base.groups[0], key: `g${i}`, label: `G${i}`, cost: 10 - i }));
    const timeline = [{ ...base.timeline[0], series: Object.fromEntries(groups.map((g) => [g.key, { cost: g.cost, included_cost: 0, calls: 1, tokens: 1 }])) }];
    const report = usageReport({ groups, timeline });
    const series = chartSeries(report, "cost");
    expect(series.map((s) => s.key)).toEqual(["g0", "g1", "g2", "g3", "g4", OTHER_KEY]);
    expect(series[0].color).toBe("var(--series-1)");
    expect(series[5].color).toBe("var(--series-other)");
    const [row] = chartRows(report, "cost", series);
    expect(row[OTHER_KEY]).toBe(4 + 5);
  });
});
