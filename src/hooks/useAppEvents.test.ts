// useAppEvents hook tests.
//
// Strategy: replace globalThis.EventSource with a mock that captures
// the URL it was opened with and exposes a fire() method to push a
// message frame. That lets us assert all the behaviours we care about
// without spinning up an actual SSE server:
//
//   - URL formatting (project_id encoded, since= included on reconnect)
//   - onmessage parses + forwards to the handler
//   - dedup on seq (same seq twice → handler fires once)
//   - cleanup on unmount closes the EventSource
//   - malformed JSON doesn't crash
//
// We do NOT exercise the auto-reconnect path here — that would
// require simulating EventSource.CLOSED state transitions and waiting
// on real timers. The reconnect logic is small and tested by hand
// against the live server.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useAppEvents, type AppEventEnvelope } from "./useAppEvents";

interface MockES {
  url: string;
  withCredentials: boolean;
  readyState: number;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onopen: ((e: Event) => void) | null;
  closed: boolean;
  close: () => void;
  fire: (data: unknown) => void;
  fireRaw: (raw: string) => void;
  triggerError: () => void;
}

let lastES: MockES | null = null;
const allESes: MockES[] = [];

class FakeEventSource implements MockES {
  url: string;
  withCredentials: boolean;
  readyState = 1;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  closed = false;

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = !!init?.withCredentials;
    lastES = this;
    allESes.push(this);
  }
  close = () => {
    this.closed = true;
    this.readyState = 2;
  };
  fire = (data: unknown) => {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  };
  fireRaw = (raw: string) => {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: raw }));
    }
  };
  triggerError = () => {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  };
  addEventListener() {} // unused — we drive via onmessage
  removeEventListener() {}
  dispatchEvent() { return true; }
}

beforeEach(() => {
  lastES = null;
  allESes.length = 0;
  // Install fake. Cast: TypeScript thinks EventSource is the spec
  // type but we only need the surface our hook uses.
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  allESes.forEach((es) => es.close());
});

function envelope(seq: number, topic = "file.added", data: unknown = { id: seq }): AppEventEnvelope {
  return {
    topic,
    app: "storage",
    project_id: "p1",
    install_id: 90,
    seq,
    time: "2026-04-30T00:00:00Z",
    data,
  };
}

describe("useAppEvents", () => {
  test("opens EventSource with correct URL and project_id encoded", () => {
    const handler = mock(() => {});
    renderHook(() => useAppEvents("storage", "proj 1", handler));
    expect(lastES).not.toBeNull();
    expect(lastES!.url).toBe("/api/app-events/storage?project_id=proj%201");
    expect(lastES!.withCredentials).toBe(true);
  });

  test("does nothing when projectId is missing", () => {
    const handler = mock(() => {});
    renderHook(() => useAppEvents("storage", null, handler));
    expect(lastES).toBeNull();
  });

  test("does nothing when app is empty", () => {
    const handler = mock(() => {});
    renderHook(() => useAppEvents("", "p1", handler));
    expect(lastES).toBeNull();
  });

  test("forwards parsed events to the handler", () => {
    const calls: AppEventEnvelope[] = [];
    renderHook(() => useAppEvents("storage", "p1", (ev) => calls.push(ev)));
    act(() => lastES!.fire(envelope(1)));
    act(() => lastES!.fire(envelope(2, "file.deleted")));
    expect(calls).toHaveLength(2);
    expect(calls[0].topic).toBe("file.added");
    expect(calls[0].seq).toBe(1);
    expect(calls[1].topic).toBe("file.deleted");
    expect(calls[1].seq).toBe(2);
  });

  test("dedups on seq — same event twice fires handler once", () => {
    const calls: AppEventEnvelope[] = [];
    renderHook(() => useAppEvents("storage", "p1", (ev) => calls.push(ev)));
    act(() => lastES!.fire(envelope(1)));
    act(() => lastES!.fire(envelope(1)));
    expect(calls).toHaveLength(1);
  });

  test("ignores out-of-order older seq", () => {
    const calls: AppEventEnvelope[] = [];
    renderHook(() => useAppEvents("storage", "p1", (ev) => calls.push(ev)));
    act(() => lastES!.fire(envelope(5)));
    act(() => lastES!.fire(envelope(3))); // older — should be skipped
    act(() => lastES!.fire(envelope(7)));
    expect(calls.map((c) => c.seq)).toEqual([5, 7]);
  });

  test("malformed JSON does not crash the handler", () => {
    const handler = mock(() => {});
    renderHook(() => useAppEvents("storage", "p1", handler));
    // The hook swallows the parse error and never calls the handler.
    expect(() => act(() => lastES!.fireRaw("not json"))).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(0);
  });

  test("uses a stable handler ref — inline arrow doesn't recreate ES", () => {
    let renders = 0;
    const { rerender } = renderHook(() => {
      renders += 1;
      return useAppEvents("storage", "p1", () => {});
    });
    const firstES = lastES;
    rerender();
    rerender();
    expect(renders).toBeGreaterThanOrEqual(2);
    // Same EventSource — hook didn't reconnect on every render.
    expect(lastES).toBe(firstES);
    expect(allESes.length).toBe(1);
  });

  test("close on unmount", () => {
    const { unmount } = renderHook(() => useAppEvents("storage", "p1", () => {}));
    expect(lastES!.closed).toBe(false);
    unmount();
    expect(lastES!.closed).toBe(true);
  });

  test("changing projectId reconnects on the new lane", () => {
    const { rerender } = renderHook(({ pid }: { pid: string }) =>
      useAppEvents("storage", pid, () => {}),
      { initialProps: { pid: "p1" } },
    );
    const firstES = lastES;
    expect(firstES!.url).toContain("project_id=p1");
    rerender({ pid: "p2" });
    expect(firstES!.closed).toBe(true);
    expect(lastES).not.toBe(firstES);
    expect(lastES!.url).toContain("project_id=p2");
  });
});
