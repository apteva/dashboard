import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { telemetry } from "../api";
import { usageReport } from "../components/usage/usageFixtures";
import { Analytics } from "./Analytics";

const originalUsage = telemetry.usage;
const originalQuery = telemetry.query;

afterEach(() => {
  cleanup();
  telemetry.usage = originalUsage;
  telemetry.query = originalQuery;
});

describe("Usage page", () => {
  test("shows billed spend apart from subscription usage", async () => {
    telemetry.usage = mock(async () => usageReport()) as typeof telemetry.usage;
    render(<MemoryRouter initialEntries={["/analytics?scope=all"]}><Analytics /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByText("$12.50").length).toBeGreaterThan(0));
    expect(telemetry.usage).toHaveBeenCalledWith(undefined, "7d", "agent");
    expect(screen.getByText("+$4.00 covered by subscriptions")).toBeTruthy();
    expect(screen.getByText("$45.00")).toBeTruthy(); // 1.5/day × 30
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByText("Writer")).toBeTruthy();
  });

  test("switching the breakdown requests that grouping", async () => {
    telemetry.usage = mock(async (_p: string | undefined, period: string, groupBy: string) =>
      usageReport({ period: period as "7d", group_by: groupBy as "agent" })) as typeof telemetry.usage;
    render(<MemoryRouter initialEntries={["/analytics?scope=all"]}><Analytics /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Model" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Model" }));
    await waitFor(() => expect(telemetry.usage).toHaveBeenCalledWith(undefined, "7d", "model"));
  });

  test("opens an agent's detail panel from the breakdown", async () => {
    telemetry.usage = mock(async () => usageReport()) as typeof telemetry.usage;
    telemetry.query = mock(async () => []) as typeof telemetry.query;
    render(<MemoryRouter initialEntries={["/analytics?scope=all"]}><Analytics /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Writer")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Writer" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Writer usage" })).toBeTruthy());
    expect(telemetry.query).toHaveBeenCalledWith(1, "llm.done", 200);
  });
});
