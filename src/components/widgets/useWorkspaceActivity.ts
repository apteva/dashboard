import { useEffect, useRef, useState } from "react";
import { telemetry, type Agent, type TelemetryEvent } from "../../api";
import { useTelemetryEvents } from "../../hooks/useTelemetryBus";
import { mergeRuntimeEvent, type RuntimeEventItem } from "../../utils/runtimeActivity";

export const activityID = (item: RuntimeEventItem) => `${item.raw.instance_id}:${item.activityId || item.key}`;

/** Reuses the agent detail reducer, including thought streaming and tool/result pairing. */
export function useWorkspaceActivity(agents: Agent[], projectId: string | undefined, enabled: boolean) {
  const scope = projectId || "global";
  const [state, setState] = useState<{ scope: string; rows: RuntimeEventItem[]; loading: boolean; error: string }>({ scope, rows: [], loading: true, error: "" });
  const add = (previous: RuntimeEventItem[], event: TelemetryEvent) => {
    const other = previous.filter(item => item.raw.instance_id !== event.instance_id);
    const own = previous.filter(item => item.raw.instance_id === event.instance_id);
    return [...other, ...mergeRuntimeEvent(own, event)].sort((a,b) => Date.parse(a.time) - Date.parse(b.time)).slice(-250);
  };
  const queue = useRef<TelemetryEvent[]>([]);
  const frame = useRef<number | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const key = agents.map(agent => `${agent.id}:${agent.project_id}`).sort().join(",");
  useEffect(() => {
    let cancelled = false, pending = false;
    queue.current = []; seen.current.clear();
    setState({ scope, rows: [], loading: enabled, error: "" });
    if (!enabled) return;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const histories = await Promise.allSettled([telemetry.projectActivity(projectId, 150, "runtime")]);
      pending = false;
      if (cancelled) return;
      const events = histories.flatMap(result => result.status === "fulfilled" ? result.value : []).filter(event => agents.some(a => a.id === event.instance_id)).sort((a,b) => Date.parse(a.time) - Date.parse(b.time));
      const incoming = events.filter(event => {
        const id = `${event.instance_id}:${event.id || `${event.type}:${event.time}`}`;
        if (seen.current.has(id)) return false;
        seen.current.add(id); return true;
      });
      if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-1000));
      setState(previous => ({ scope, rows: incoming.reduce(add, previous.scope === scope ? previous.rows : []), loading: false, error: histories.some(r => r.status === "rejected") ? "Some activity could not be refreshed." : "" }));
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    window.addEventListener("apteva.telemetry.reconnected", load);
    window.addEventListener("apteva.telemetry.gap", load);
    document.addEventListener("visibilitychange", load);
    return () => { cancelled = true; window.clearInterval(timer); if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; window.removeEventListener("apteva.telemetry.reconnected", load); window.removeEventListener("apteva.telemetry.gap", load); document.removeEventListener("visibilitychange", load); };
  }, [key, scope, enabled, projectId]);
  useTelemetryEvents(enabled ? null : undefined, event => {
    if (!agents.some(agent => agent.id === event.instance_id)) return;
    const id = `${event.instance_id}:${event.id || `${event.seq || ""}:${event.type}:${event.thread_id}:${event.time}:${event.data?.text || event.data?.chunk || ""}`}`;
    if (seen.current.has(id)) return;
    seen.current.add(id);
    if (seen.current.size > 2000) seen.current.delete(seen.current.values().next().value!);
    queue.current.push(event);
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      const batch = queue.current.splice(0);
      setState(previous => ({ scope, loading: previous.loading, error: previous.error, rows: batch.reduce(add, previous.scope === scope ? previous.rows : []) }));
    });
  });
  return state.scope === scope ? state : { rows: [], loading: true, error: "" };
}
