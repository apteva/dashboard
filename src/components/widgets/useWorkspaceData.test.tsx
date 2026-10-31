import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { apps, chat, instances, integrations, mcpServers, skills, telemetry, type TelemetryEvent } from "../../api";
import { useWorkspaceData } from "./useWorkspaceData";

const originals = {
  instances: instances.list, apps: apps.list, connections: integrations.connections, skills: skills.list,
  inventory: mcpServers.list, stats: telemetry.projectStats, statuses: chat.currentStatuses,
};
const originalBus = window.__aptevaTelemetryBus;
let receive: ((event: TelemetryEvent) => void) | undefined;
let calls: Record<string, number>;

beforeEach(() => {
  calls = {};
  const counted = (name: string) => mock(async () => { calls[name] = (calls[name] || 0) + 1; return []; });
  instances.list = counted("agents") as never;
  apps.list = counted("apps") as never;
  integrations.connections = counted("connections") as never;
  skills.list = counted("skills") as never;
  mcpServers.list = counted("inventory") as never;
  telemetry.projectStats = counted("stats") as never;
  chat.currentStatuses = counted("statuses") as never;
  window.__aptevaTelemetryBus = { ...originalBus!, subscribe: (_id, callback) => { receive = callback; return () => { receive = undefined; }; } };
});

afterEach(() => {
  cleanup();
  instances.list = originals.instances; apps.list = originals.apps; integrations.connections = originals.connections;
  skills.list = originals.skills; mcpServers.list = originals.inventory; telemetry.projectStats = originals.stats;
  chat.currentStatuses = originals.statuses;
  window.__aptevaTelemetryBus = originalBus;
});

const toolResult = (n: number): TelemetryEvent => ({ id: `e${n}`, instance_id: 1, thread_id: "main", type: "tool.result", time: new Date().toISOString(), data: {} });

test("agent activity reloads only live sources, at most once per window", async () => {
  renderHook(() => useWorkspaceData("p1", false, true, false, ["p1"]));
  await waitFor(() => expect(calls.statuses).toBe(1));
  expect(calls).toEqual({ agents: 1, apps: 1, connections: 1, skills: 1, inventory: 1, stats: 1, statuses: 1 });

  for (let n = 0; n < 20; n++) receive?.(toolResult(n));
  await waitFor(() => expect(calls.agents).toBe(2), { timeout: 1500 });
  await waitFor(() => expect(calls.statuses).toBe(2));
  expect(calls).toMatchObject({ apps: 1, connections: 1, skills: 1, inventory: 1, stats: 2 });

  for (let n = 20; n < 40; n++) receive?.(toolResult(n));
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(calls.agents).toBe(2);
});
