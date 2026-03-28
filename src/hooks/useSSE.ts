import { useEffect, useRef, useState } from "react";
import { core, type APIEvent } from "../api";

export function useSSE(maxEvents = 200) {
  const [events, setEvents] = useState<APIEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = core.events();
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const event: APIEvent = JSON.parse(e.data);
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
  }, [maxEvents]);

  return events;
}
