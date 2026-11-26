import { afterEach, expect, jest, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { TelemetryConnectionState } from "../../hooks/useTelemetryBus";
import { CONNECTION_GRACE_MS, useConnectedWithGrace } from "./useWorkspaceSystem";

afterEach(() => { cleanup(); jest.useRealTimers(); });

test("a brief reconnect keeps the stream counted as connected", () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook(({ connection }) => useConnectedWithGrace(connection), {
    initialProps: { connection: "connecting" as TelemetryConnectionState },
  });
  // Not connected until the stream has opened once.
  expect(result.current).toBe(false);
  rerender({ connection: "open" });
  expect(result.current).toBe(true);

  // A drop that recovers within the grace period never shows.
  rerender({ connection: "reconnecting" });
  act(() => { jest.advanceTimersByTime(CONNECTION_GRACE_MS - 1000); });
  expect(result.current).toBe(true);
  rerender({ connection: "open" });
  act(() => { jest.advanceTimersByTime(CONNECTION_GRACE_MS); });
  expect(result.current).toBe(true);

  // A longer outage does.
  rerender({ connection: "reconnecting" });
  act(() => { jest.advanceTimersByTime(CONNECTION_GRACE_MS + 1); });
  expect(result.current).toBe(false);
  rerender({ connection: "open" });
  expect(result.current).toBe(true);
});
