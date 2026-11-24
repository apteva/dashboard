import { useEffect, useRef, useState } from "react";
import { appEventsStreamOpen, useAppEvents, type AppEventEnvelope } from "./useAppEvents";

/** When widgets refresh without an event. Exported for tests. */
export const panelRefreshTimings = {
  /** Polling interval while no live event stream covers the widget. */
  pollMs: 30_000,
  /** While the stream is live, events drive refreshes. This rarer full
   * refresh only covers an event lost without a disconnect. */
  safetyMs: 5 * 60_000,
};

// Shared contract for app pages and contributions. Batch bursts without losing
// entity IDs; eventRevision also supports older panels that only need invalidation.
export function usePanelEvents(app: string, projectId: string | undefined, installId?: number, topics: string[] = [], dashboardScope: "project" | "global" = "project") {
  const [snapshot, setSnapshot] = useState<{eventRevision: number; appEvents: AppEventEnvelope[]}>({eventRevision: 0, appEvents: []});
  const pending = useRef<AppEventEnvelope[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const all = useRef(false);
  const quietChecks = useRef(0);
  const flush = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const events = all.current ? [] : pending.current;
      all.current = false; pending.current = [];
      quietChecks.current = 0;
      setSnapshot(s => ({eventRevision: s.eventRevision + 1, appEvents: events}));
    }, 200);
  };
  const eventScope = dashboardScope === "project" ? projectId : undefined;
  useAppEvents(app, eventScope, event => {
    if (dashboardScope !== "global" && event.project_id !== projectId) return;
    if (installId && event.install_id !== installId) return;
    if (topics.length && !topics.some(t => t === event.topic || (t.endsWith(".*") && event.topic.startsWith(t.slice(0,-1))))) return;
    pending.current.push(event);
    // Bound memory during extreme bursts; a full refresh covers all entities.
    if (pending.current.length > 200) { pending.current = []; all.current = true; }
    flush();
  });
  useEffect(() => {
    const refresh = (event?: Event) => {
      if (event?.type === "apteva:app-events-connected" && dashboardScope !== "global" && (event as CustomEvent).detail?.projectId !== projectId) return;
      if (document.visibilityState === "hidden") return;
      all.current = true; flush();
    };
    // A refresh signal makes many widgets reload, and some show a loading
    // state while they do. So while the project's event stream is live,
    // events, reconnects and returning to the tab drive refreshes; the
    // timer only polls when no stream covers this widget.
    const check = () => {
      if (document.visibilityState === "hidden") return;
      quietChecks.current += 1;
      const live = dashboardScope === "project" && appEventsStreamOpen(projectId);
      if (live && quietChecks.current * panelRefreshTimings.pollMs < panelRefreshTimings.safetyMs) return;
      all.current = true; flush();
    };
    window.addEventListener("apteva:app-events-connected", refresh);
    document.addEventListener("visibilitychange", refresh);
    const reconcile = setInterval(check, panelRefreshTimings.pollMs);
    return () => {
      window.removeEventListener("apteva:app-events-connected", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(reconcile);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null; pending.current = []; all.current = false;
    };
  }, [app, dashboardScope, projectId, installId]);
  return {...snapshot, eventStreamManaged: dashboardScope === "project" && !!projectId};
}
