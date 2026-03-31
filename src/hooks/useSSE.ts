import { useEffect, useRef, useState } from "react";
import { telemetry, type TelemetryEvent } from "../api";

export function useSSE(instanceId: number | null, maxEvents = 200) {
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!instanceId) return;

    const es = telemetry.stream(instanceId);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: TelemetryEvent = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > maxEvents ? next.slice(-maxEvents) : next;
        });
      } catch {}
    };

    es.onerror = () => {
      // Reconnect handled by browser
    };

    return () => {
      es.close();
    };
  }, [instanceId, maxEvents]);

  return events;
}
