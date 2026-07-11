import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import "../i18n";
import type { ProviderUsageSnapshot } from "../api";
import { ProviderUsageSummary, providerUsageWindowLabel } from "./ProviderUsage";

const usage: ProviderUsageSnapshot = {
  supported: true,
  provider_id: 15,
  kind: "subscription_quota",
  plan: "pro",
  fetched_at: "2026-07-10T10:00:00Z",
  limits: [
    {
      id: "codex",
      label: "Codex",
      windows: [
        { id: "primary", used_percent: 17, duration_minutes: 300, resets_at: "2099-01-01T00:00:00Z" },
        { id: "secondary", used_percent: 42, duration_minutes: 10080, resets_at: "2099-01-07T00:00:00Z" },
      ],
    },
    {
      id: "codex_spark",
      label: "GPT-5.3-Codex-Spark",
      windows: [{ id: "primary", used_percent: 3, duration_minutes: 60 }],
    },
  ],
};

describe("ProviderUsageSummary", () => {
  test("formats common quota window durations compactly", () => {
    expect(providerUsageWindowLabel(300)).toBe("5h");
    expect(providerUsageWindowLabel(10080)).toBe("1w");
    expect(providerUsageWindowLabel(90)).toBe("90m");
  });

  test("renders primary windows and exposes additional limits", () => {
    const html = renderToStaticMarkup(
      <ProviderUsageSummary
        usage={usage}
        onRefresh={() => {}}
        onOpenDetails={() => {}}
      />,
    );

    expect(html).toContain("Subscription usage");
    expect(html).toContain("5h");
    expect(html).toContain("1w");
    expect(html).toContain('aria-valuenow="17"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain("+1 additional limit");
    expect(html).toContain('aria-label="Refresh usage"');
  });

  test("does not render for unsupported providers", () => {
    const html = renderToStaticMarkup(
      <ProviderUsageSummary
        usage={{ supported: false, provider_id: 1 }}
        onRefresh={() => {}}
        onOpenDetails={() => {}}
      />,
    );
    expect(html).toBe("");
  });
});
