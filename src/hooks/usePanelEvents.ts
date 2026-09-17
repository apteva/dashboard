import { useEffect, useRef, useState } from "react";
import { useAppEvents, type AppEventEnvelope } from "./useAppEvents";

// Shared contract for app pages and contributions. Batch bursts without losing
// entity IDs; eventRevision also supports older panels that only need invalidation.
export function usePanelEvents(app: string, projectId: string, installId?: number, topics: string[] = []) {
  const [snapshot, setSnapshot] = useState<{eventRevision: number; appEvents: AppEventEnvelope[]}>({eventRevision: 0, appEvents: []});
  const pending = useRef<AppEventEnvelope[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const all = useRef(false);
  const flush = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const events = all.current ? [] : pending.current;
      all.current = false; pending.current = [];
      setSnapshot(s => ({eventRevision: s.eventRevision + 1, appEvents: events}));
    }, 200);
  };
  useAppEvents(app, projectId, event => {
    if (event.project_id !== projectId || (installId && event.install_id !== installId)) return;
    if (topics.length && !topics.some(t => t === event.topic || (t.endsWith(".*") && event.topic.startsWith(t.slice(0,-1))))) return;
    pending.current.push(event);
    // Bound memory during extreme bursts; a full refresh covers all entities.
    if (pending.current.length > 200) { pending.current = []; all.current = true; }
    flush();
  });
  useEffect(() => {
    const refresh = (event?: Event) => {
      if (event?.type === "apteva:app-events-connected" && (event as CustomEvent).detail?.projectId !== projectId) return;
      if (document.visibilityState === "hidden") return;
      all.current = true; flush();
    };
    window.addEventListener("apteva:app-events-connected", refresh);
    document.addEventListener("visibilitychange", refresh);
    const reconcile = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("apteva:app-events-connected", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(reconcile);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null; pending.current = []; all.current = false;
    };
  }, [app, projectId, installId]);
  return {...snapshot, eventStreamManaged: true as const};
}
