import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { integrations, type IntegrationUsageSummary } from "../api";
import { IntegrationUsagePanel } from "./Integrations";

const originalUsage = integrations.usage;

afterEach(() => {
  cleanup();
  integrations.usage = originalUsage;
});

describe("IntegrationUsagePanel", () => {
  test("shows loading immediately and renders the returned usage", async () => {
    let resolveUsage!: (summary: IntegrationUsageSummary) => void;
    integrations.usage = mock(
      () => new Promise<IntegrationUsageSummary>((resolve) => {
        resolveUsage = resolve;
      }),
    );

    render(<IntegrationUsagePanel projectId="project-1" />);

    expect(screen.getAllByText("Loading usage…").length).toBeGreaterThan(0);

    await act(async () => {
      resolveUsage({
        since: "2026-08-16T08:00:00Z",
        totals: [
          { app_slug: "crm", unit: "request", quantity: 12, calls: 12, errors: 1 },
        ],
        rows: [
          {
            app_slug: "crm",
            tool: "contacts_list",
            unit: "request",
            direction: "local",
            quantity: 12,
            calls: 12,
            errors: 1,
            last_used_at: "2026-08-16T08:30:00Z",
          },
        ],
      });
    });

    await waitFor(() => expect(screen.getAllByText("contacts_list").length).toBeGreaterThan(0));
    expect(screen.getAllByText("crm").length).toBeGreaterThan(0);
    expect(integrations.usage).toHaveBeenCalledWith({ projectId: "project-1", period: "7d" });
  });
});
