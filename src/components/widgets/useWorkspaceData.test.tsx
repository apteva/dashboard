import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { apps, chat, core, instanceSkills, instances, integrations, mcpServers, skills, telemetry, type TelemetryEvent } from "../../api";
import { mergeAppLists, useWorkspaceData } from "./useWorkspaceData";
import { keepIfEqual } from "../../utils/keepIfEqual";

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

test("app lists merge in a fixed order whichever request finishes first", () => {
  const row = (install_id: number, name: string) => ({ install_id, name }) as never;
  const merged = mergeAppLists([row(1, "global")], [[row(3, "b1"), row(4, "b2")], undefined, [row(2, "c1"), row(1, "global in c")]]);
  expect(merged.map(app => (app as { install_id: number }).install_id)).toEqual([1, 3, 4, 2]);
  expect((merged[0] as { name: string }).name).toBe("global in c");
  expect(keepIfEqual([{ a: 1 }], [{ a: 1 }])).toEqual([{ a: 1 }]);
  const previous = [{ a: 1 }];
  expect(keepIfEqual(previous, [{ a: 1 }])).toBe(previous);
  expect(keepIfEqual(previous, [{ a: 2 }])).not.toBe(previous);
});

test("an unchanged reload keeps the same data; a status change re-reads only that agent", async () => {
  const originalConfig = core.config, originalSkills = instanceSkills.list;
  let agentRows = [{ id: 1, status: "running", config: "" }, { id: 2, status: "running", config: "" }];
  const configReads: Record<number, number> = {};
  instances.list = mock(async () => { calls.agents = (calls.agents || 0) + 1; return agentRows.map(agent => ({ ...agent })); }) as never;
  core.config = mock(async (id: number) => { configReads[id] = (configReads[id] || 0) + 1; return { mcp_servers: [{ name: `server-${id}` }] }; }) as never;
  instanceSkills.list = mock(async () => []) as never;
  try {
    const { result } = renderHook(() => useWorkspaceData("p1", false, true, true, ["p1"]));
    await waitFor(() => expect(configReads).toEqual({ 1: 1, 2: 1 }));
    await waitFor(() => expect(Object.keys(result.current.attachments)).toHaveLength(2));
    const agents = result.current.agents, attachments = result.current.attachments, apps = result.current.apps;

    // Same rows again: the hook hands out the very same objects.
    window.dispatchEvent(new Event("apteva.statusMessage"));
    await waitFor(() => expect(calls.agents).toBe(2), { timeout: 1500 });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(result.current.agents).toBe(agents);
    expect(result.current.apps).toBe(apps);
    expect(result.current.attachments).toBe(attachments);
    expect(configReads).toEqual({ 1: 1, 2: 1 });

    // Agent 2 stops: only its attachments are read again.
    agentRows = [{ id: 1, status: "running", config: "" }, { id: 2, status: "stopped", config: "" }];
    window.dispatchEvent(new Event("apteva.statusMessage"));
    await waitFor(() => expect(configReads[2]).toBe(2), { timeout: 1500 });
    expect(configReads[1]).toBe(1);
    expect(result.current.agents).not.toBe(agents);
    expect(result.current.attachments[1]).toBe(attachments[1]);
  } finally {
    core.config = originalConfig; instanceSkills.list = originalSkills;
  }
});
