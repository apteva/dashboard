// useAppEvents — generic SDK-level event subscription for the dashboard.
//
// Every Apteva app emits onto a per-(app, project_id) bus via
// ctx.Emit(); this hook is the dashboard side of that pipe. Pass
// the app name + project id + a handler; the hook owns one
// EventSource and reconnects with `since=<lastSeq>` automatically
// so a brief network drop never silently misses an event.
//
// Dedup is on `seq`. The platform's ring buffer holds the last 256
// events per (app, project) for replay; longer gaps are the app's
// responsibility to backfill (it owns the durable list anyway).

import { useEffect, useRef } from "react";

export interface AppEventEnvelope<T = unknown> {
  topic: string;          // app-relative, e.g. "file.added"
  app: string;            // server-stamped from the install token
  project_id: string;
  install_id: number;
  seq: number;
  time: string;
  data: T;
}

export interface UseAppEventsOptions {
  /** When false, the hook does nothing — handy for conditionally
   *  attaching (e.g. only when a panel is mounted in a real project). */
  enabled?: boolean;
}

export function useAppEvents<T = unknown>(
  app: string,
  projectId: string | undefined | null,
  onEvent: (ev: AppEventEnvelope<T>) => void,
  opts: UseAppEventsOptions = {},
) {
  const { enabled = true } = opts;
  // Stable handler ref so the consumer can pass an inline arrow
  // without forcing reconnects on every render.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || !app || !projectId) return;
    let lastSeq = 0;
    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;
      const url =
        `/api/app-events/${encodeURIComponent(app)}` +
        `?project_id=${encodeURIComponent(projectId)}` +
        (lastSeq > 0 ? `&since=${lastSeq}` : "");
      es = new EventSource(url, { withCredentials: true });

      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as AppEventEnvelope<T>;
          if (ev.seq <= lastSeq) return; // dedup
          lastSeq = ev.seq;
          handlerRef.current(ev);
        } catch {
          // ignore malformed frame
        }
      };

      es.onerror = () => {
        // EventSource auto-reconnects on transient errors. If the
        // connection ends up CLOSED (auth failure, server gone) we
        // recreate it with the latest seq after a small backoff so
        // the gap stays bounded.
        if (es && es.readyState === EventSource.CLOSED) {
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [app, projectId, enabled]);
}
