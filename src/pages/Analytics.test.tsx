import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { telemetry, type UsageQuery } from "../api";
import { usageReport } from "../components/usage/usageFixtures";
import { localDate, presetRange } from "../components/usage/usageFormat";
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
    render(<MemoryRouter initialEntries={["/analytics"]}><Analytics /></MemoryRouter>);

    await waitFor(() => expect(screen.getAllByText("$12.50").length).toBeGreaterThan(0));
    const query = (telemetry.usage as ReturnType<typeof mock>).mock.calls[0][0];
    expect(query.groupBy).toBe("agent");
    expect(query.projectId).toBeUndefined();
    expect(query.to).toBe(localDate(new Date()));
    expect(query.from).toBe(presetRange("7d").from);
    expect(screen.getByText("+$4.00 covered by subscriptions")).toBeTruthy();
    expect(screen.getByText("$45.00")).toBeTruthy(); // 1.5/day × 30
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Writer" })).toBeTruthy();
    // The chart opens on tokens, which every call has, even when spend is $0.
    expect(screen.getByRole("heading", { name: "Tokens over time" })).toBeTruthy();
  });

  test("switching the breakdown requests that grouping", async () => {
    telemetry.usage = mock(async (query: UsageQuery) => usageReport({ group_by: query.groupBy })) as typeof telemetry.usage;
    render(<MemoryRouter initialEntries={["/analytics"]}><Analytics /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Model" })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Model" }));
    await waitFor(() => expect(telemetry.usage).toHaveBeenCalledWith(expect.objectContaining({ groupBy: "model" })));
  });

  test("a custom range asks for exactly those dates", async () => {
    telemetry.usage = mock(async () => usageReport()) as typeof telemetry.usage;
    render(<MemoryRouter initialEntries={["/analytics?range=custom&from=2026-10-01&to=2026-10-15"]}><Analytics /></MemoryRouter>);
    await waitFor(() => expect(telemetry.usage).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-10-01", to: "2026-10-15" })));
    expect(screen.getByLabelText("From")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    const today = localDate(new Date());
    await waitFor(() => expect(telemetry.usage).toHaveBeenCalledWith(expect.objectContaining({ from: today, to: today })));
  });

  test("opens an agent's detail panel from the breakdown", async () => {
    telemetry.usage = mock(async () => usageReport()) as typeof telemetry.usage;
    telemetry.query = mock(async () => []) as typeof telemetry.query;
    render(<MemoryRouter initialEntries={["/analytics"]}><Analytics /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Writer" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Writer" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Writer usage" })).toBeTruthy());
    expect(telemetry.query).toHaveBeenCalledWith(1, "llm.done", 200);
  });
});
