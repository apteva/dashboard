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
//   - On EventSource error, the bus reconnects with bounded backoff
//     (5 attempts, 2s gap). After that it gives up; the next
//     setProjectId call (e.g. project switch) resets the budget.
//
// This module has SIDE EFFECTS at import time — installs the bridge
// onto `window.__aptevaTelemetryBus`. main.tsx imports it for that
// reason; without that import, tree-shaking eliminates the module
// because no production code references the named export.

import type { TelemetryEvent } from "../api";

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

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
  const listeners = new Set<Listener>();

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
    const url =
      `/api/telemetry/stream?all=1` +
      `&project_id=${encodeURIComponent(projectId)}`;
    const next = new EventSource(url, { withCredentials: true });
    es = next;
    next.onopen = () => {
      reconnectAttempts = 0;
    };
    next.onmessage = (e) => {
      let ev: TelemetryEvent;
      try {
        ev = JSON.parse(e.data) as TelemetryEvent;
      } catch {
        return;
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
    next.onerror = () => {
      // EventSource silently flips to readyState=CONNECTING and tries
      // to reconnect on its own; we layer our own bounded retry on
      // top so a genuine 4xx (e.g. project deleted) doesn't churn
      // forever. Once we've exceeded the budget we leave the bus
      // closed; setProjectId resets it on the next project switch.
      if (next.readyState !== EventSource.CLOSED) return;
      if (next !== es) return; // already replaced
      es = null;
      reconnectAttempts += 1;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        open();
      }, RECONNECT_DELAY_MS);
    };
  }

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
  };

  window.__aptevaTelemetryBus = bridge;
}

// ─── React hook ──────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

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
