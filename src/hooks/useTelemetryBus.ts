// useTelemetryBus — single project-wide telemetry SSE, multiplexed to
// every consumer that needs an agent-event feed.
//
// Same shape as useAppEvents: ONE EventSource per project_id (the
// server's `/telemetry/stream?all=1&project_id=…` endpoint already
// broadcasts every running instance in the project), and a tiny
// subscribe/unsubscribe handle on `window.__aptevaTelemetryBus`.
//
// Why a bus and not per-page EventSource? Connection budget. Before
// this, AgentView opened its own per-instance SSE, the dashboard's
// ActivityFeed opened its own all-instances SSE, the Agents page
// opened ANOTHER all-instances SSE. Three telemetry streams against
// the same data in a typical session, each consuming a slot in the
// browser's HTTP/1.1 6-per-origin cap. Worse, if a chat panel wants
// telemetry too (the agent-thinking indicator), that's a fourth.
// The bus collapses them all to one stream.
//
// Lifecycle:
//   - Layout calls setProjectId(currentProject?.id) whenever the
//     active project changes. The bus closes any open EventSource
//     and reopens against the new project.
//   - Components call subscribe(instanceId | null, fn). Returns an
//     unsubscribe. Filter is optional — null subscribes to every
//     event in the project (used by ActivityFeed, fleet views).
//   - On EventSource error, the bus reconnects forever with capped
//     exponential backoff. The last server sequence is sent as `since=` so
//     the server can replay a short gap before resuming live delivery.
//
// This module has SIDE EFFECTS at import time — installs the bridge
// onto `window.__aptevaTelemetryBus`. main.tsx imports it for that
// reason; without that import, tree-shaking eliminates the module
// because no production code references the named export.

import type { TelemetryEvent } from "../api";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;

export type TelemetryConnectionState = "idle" | "connecting" | "open" | "reconnecting";

interface Listener {
  instanceId: number | null; // null = all
  fn: (ev: TelemetryEvent) => void;
}

interface TelemetryBridge {
  /** Set the active project. The bus tears down any current
   *  EventSource and opens a new one for the given project. Pass
   *  null/empty to fully disconnect (e.g. logout). */
  setProjectId(projectId: string | null): void;

  /** Subscribe to telemetry events. Pass an instance_id to filter,
   *  or null to receive every event in the project. Returns an
   *  unsubscribe; safe to call after the bus has switched projects. */
  subscribe(
    instanceId: number | null,
    fn: (ev: TelemetryEvent) => void,
  ): () => void;

  /** Current project, exposed for diagnostic logs only. */
  currentProjectId(): string | null;

  /** Connection health for operator UI and reconnect-triggered backfills. */
  connectionState(): TelemetryConnectionState;
  subscribeState(fn: (state: TelemetryConnectionState) => void): () => void;
}

declare global {
  interface Window {
    __aptevaTelemetryBus?: TelemetryBridge;
  }
}

if (typeof window !== "undefined" && !window.__aptevaTelemetryBus) {
  // Module-scoped state. Captured by the closures below; not
  // attached to window so consumers can't mutate internals.
  let projectId: string | null = null;
  let es: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let state: TelemetryConnectionState = "idle";
  const listeners = new Set<Listener>();
  const stateListeners = new Set<(state: TelemetryConnectionState) => void>();
  const lastSeqByScope = new Map<string, number>();

  function updateState(next: TelemetryConnectionState): void {
    if (state === next) return;
    state = next;
    for (const fn of [...stateListeners]) {
      try {
        fn(state);
      } catch {
        // Connection diagnostics must not affect delivery.
      }
    }
  }

  function teardown(): void {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (es) {
      es.close();
      es = null;
    }
  }

  function open(): void {
    if (!projectId) return;
    teardown();
    const scope = projectId;
    // The Monitor wallboard can temporarily request the caller's entire
    // fleet. "*" is an internal sentinel: omitting project_id is the
    // server's authenticated all-project mode. Every other value remains
    // a regular project id, so normal pages keep their narrow stream.
    const baseUrl = scope === "*"
      ? `/api/telemetry/stream?all=1`
      : `/api/telemetry/stream?all=1&project_id=${encodeURIComponent(scope)}`;
    const since = lastSeqByScope.get(scope) || 0;
    const url = `${baseUrl}&since=${since}`;
    updateState(reconnectAttempts > 0 ? "reconnecting" : "connecting");
    const next = new EventSource(url, { withCredentials: true });
    es = next;
    next.onopen = () => {
      const recovered = reconnectAttempts > 0;
      reconnectAttempts = 0;
      updateState("open");
      if (recovered) window.dispatchEvent(new Event("apteva.telemetry.reconnected"));
    };
    next.onmessage = (e) => {
      let ev: TelemetryEvent;
      try {
        ev = JSON.parse(e.data) as TelemetryEvent;
      } catch {
        return;
      }
      const seq = Number(ev.seq || e.lastEventId || 0);
      if (Number.isFinite(seq) && seq > (lastSeqByScope.get(scope) || 0)) {
        lastSeqByScope.set(scope, seq);
      }
      // Snapshot listeners so a subscriber that removes itself
      // mid-iteration doesn't skip its sibling.
      for (const l of [...listeners]) {
        if (l.instanceId !== null && l.instanceId !== ev.instance_id) continue;
        try {
          l.fn(ev);
        } catch {
          // a misbehaving listener shouldn't tank the others
        }
      }
    };
    next.addEventListener("reset", () => {
      lastSeqByScope.set(scope, 0);
      window.dispatchEvent(new Event("apteva.telemetry.gap"));
    });
    next.onerror = () => {
      if (next !== es) return; // already replaced
      // Take ownership of reconnects. Native EventSource normally changes to
      // CONNECTING and retries forever; returning in that state made the
      // documented retry budget ineffective for persistent 4xx responses.
      next.close();
      es = null;
      reconnectAttempts += 1;
      updateState("reconnecting");
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      const delay = Math.min(
        RECONNECT_MAX_DELAY_MS,
        RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempts - 1, 5),
      );
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        open();
      }, delay);
    };
  }

  const recoverNow = () => {
    if (!projectId || state === "open") return;
    reconnectAttempts = 0;
    open();
  };
  window.addEventListener("online", recoverNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recoverNow();
  });

  const bridge: TelemetryBridge = {
    setProjectId(next) {
      const norm = next && next.length > 0 ? next : null;
      if (norm === projectId) return;
      projectId = norm;
      reconnectAttempts = 0;
      if (norm) {
        open();
      } else {
        teardown();
        lastSeqByScope.clear();
        updateState("idle");
      }
    },
    subscribe(instanceId, fn) {
      const l: Listener = { instanceId, fn };
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    currentProjectId() {
      return projectId;
    },
    connectionState() {
      return state;
    },
    subscribeState(fn) {
      stateListeners.add(fn);
      fn(state);
      return () => {
        stateListeners.delete(fn);
      };
    },
  };

  window.__aptevaTelemetryBus = bridge;
}

// ─── React hook ──────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

/** Subscribe to telemetry from inside a React component.
 *
 *   - number    → events for that instance only.
 *   - null      → every event in the current project.
 *   - undefined → don't subscribe (use this for "instance not
 *                 running yet" / "data not ready" cases — you can't
 *                 conditionally CALL the hook, so undefined gates
 *                 the subscribe inside the effect instead).
 *
 *  The handler is wrapped in a ref so callers can pass an inline
 *  arrow without forcing reconnects on each render — only the
 *  instanceId actually matters for re-binding.
 */
export function useTelemetryEvents(
  instanceId: number | null | undefined,
  onEvent: (ev: TelemetryEvent) => void,
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (instanceId === undefined) return; // explicitly disabled
    const bus = window.__aptevaTelemetryBus;
    if (!bus) return;
    const filter: number | null = typeof instanceId === "number" ? instanceId : null;
    return bus.subscribe(filter, (ev) => handlerRef.current(ev));
  }, [instanceId]);
}

export function useTelemetryConnectionState(): TelemetryConnectionState {
  const [state, setState] = useState<TelemetryConnectionState>(() =>
    typeof window === "undefined"
      ? "idle"
      : window.__aptevaTelemetryBus?.connectionState() || "idle",
  );
  useEffect(() => {
    const bus = window.__aptevaTelemetryBus;
    if (!bus) return;
    return bus.subscribeState(setState);
  }, []);
  return state;
}
