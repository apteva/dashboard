import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { telemetry, type Agent, type TelemetryEvent } from "../../api";
import { ACTIVITY_BATCH_MS, useWorkspaceActivity } from "./useWorkspaceActivity";

const originalActivity = telemetry.projectActivity;
const originalBus = window.__aptevaTelemetryBus;
let emit: (event: TelemetryEvent) => void = () => {};
let polls = 0;

beforeEach(() => {
  polls = 0;
  telemetry.projectActivity = (async () => { polls += 1; return []; }) as typeof telemetry.projectActivity;
  window.__aptevaTelemetryBus = {
    setProjectId: () => {},
    currentProjectId: () => "p1",
    connectionState: () => "open",
    subscribeState: () => () => {},
    subscribe: (_instanceId, fn) => { emit = fn; return () => { emit = () => {}; }; },
  };
});

afterEach(() => {
  cleanup();
  telemetry.projectActivity = originalActivity;
  window.__aptevaTelemetryBus = originalBus;
});

const agents = [{ id: 1, project_id: "p1" }] as Agent[];
const toolCall = (n: number): TelemetryEvent => ({
  id: `e${n}`, instance_id: 1, thread_id: "main", type: "tool.call",
  time: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), data: { id: `call-${n}`, name: `tool_${n}` },
});

test("a poll with nothing new keeps the same state; live events land in one batch", async () => {
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return useWorkspaceActivity(agents, "p1", true); });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const settled = result.current;

  // Reconnect backfills and the 30 s poll run the same load.
  act(() => { window.dispatchEvent(new Event("apteva.telemetry.reconnected")); });
  await waitFor(() => expect(polls).toBe(2));
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBe(settled);

  // Events spread over several frames still redraw once per batch.
  const before = renders;
  const pause = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
  act(() => emit(toolCall(1)));
  await pause(40);
  act(() => emit(toolCall(2)));
  await pause(40);
  act(() => emit(toolCall(3)));
  expect(result.current.rows).toHaveLength(0);
  await pause(ACTIVITY_BATCH_MS);
  expect(result.current.rows).toHaveLength(3);
  expect(renders - before).toBe(1);
});
