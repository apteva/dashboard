import { useEffect, useRef, useState } from "react";
import { telemetry, type TelemetryEvent } from "../api";
import { useTelemetryEvents } from "./useTelemetryBus";

export const DIAGNOSTIC_EVENT_LIMIT = 1000;
export function diagnosticEventKey(event: TelemetryEvent) {
  return event.id || (event.seq != null ? `seq:${event.seq}` : `${event.thread_id}:${event.type}:${event.time}:${JSON.stringify(event.data)}`);
}
function mergeEvents(previous: TelemetryEvent[], incoming: TelemetryEvent[]) {
  const rows = new Map(previous.map(event => [diagnosticEventKey(event), event]));
  for (const event of incoming) rows.set(diagnosticEventKey(event), event);
  return [...rows.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || (b.seq || 0) - (a.seq || 0)).slice(0, DIAGNOSTIC_EVENT_LIMIT);
}

/** Raw telemetry: preserve individual execution and streaming events. */
export function useDiagnosticTelemetry(agentId: number, threadId: string) {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const queue = useRef<TelemetryEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let reload = false;
    setEvents([]); queue.current = []; setLoading(true); setError("");
    const load = async () => {
      if (cancelled) return;
      if (pending) { reload = true; return; }
      pending = true;
      try {
        const next = await telemetry.query(agentId, undefined, DIAGNOSTIC_EVENT_LIMIT, threadId || undefined);
        if (!cancelled) { setEvents(previous => mergeEvents(previous, next)); setError(""); }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Telemetry unavailable");
      } finally {
        pending = false;
        if (!cancelled) {
          setLoading(false);
          if (reload) { reload = false; void load(); }
        }
      }
    };
    void load();
    const recover = () => { void load(); };
    const visible = () => { if (document.visibilityState === "visible") recover(); };
    const reconcile = window.setInterval(recover, 15000);
    const flush = window.setInterval(() => {
      if (!queue.current.length) return;
      const batch = queue.current; queue.current = [];
      setEvents(previous => mergeEvents(previous, batch));
    }, 100);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("apteva.telemetry.reconnected", recover);
    window.addEventListener("apteva.telemetry.gap", recover);
    return () => {
      cancelled = true; clearInterval(reconcile); clearInterval(flush);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("apteva.telemetry.reconnected", recover);
      window.removeEventListener("apteva.telemetry.gap", recover);
    };
  }, [agentId, threadId]);
  useTelemetryEvents(agentId, event => {
    if (!threadId || (event.thread_id || "main") === threadId) {
      queue.current.push(event);
      if (queue.current.length > DIAGNOSTIC_EVENT_LIMIT) queue.current.splice(0, queue.current.length - DIAGNOSTIC_EVENT_LIMIT);
    }
  });
  return { events, loading, error };
}
