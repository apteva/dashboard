import { useEffect, useMemo, useRef, useState } from "react";
import { useTelemetryConnectionState } from "../../hooks/useTelemetryBus";
import type { RuntimeEventItem } from "../../utils/runtimeActivity";
import { activityID } from "./useWorkspaceActivity";
import { activityResource, activitySummary, isCurrentActivity } from "./workspaceActivityModel";
import { workspaceModel } from "./workspaceModel";
import type { WorkspaceData } from "./useWorkspaceData";

export interface WorkspaceChange { key: string; name: string; kind: "Added" | "Updated" | "Removed"; detail: string; at: number; attached?: string[] }
type Snapshot = Map<string, { name: string; signature: string; attachments?: string[] }>;

/** One derived graph and change journal per page, shared by all native widgets. */
export function useWorkspaceSystem(data: WorkspaceData, rows: RuntimeEventItem[], scope: string, enabled: boolean) {
  const [now, setNow] = useState(Date.now);
  const connection = useTelemetryConnectionState();
  useEffect(() => { if (!enabled) return; const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, [enabled]);
  const model = useMemo(() => workspaceModel(data), [data.agents, data.apps, data.connections, data.skills, data.inventory, data.attachments, data.statuses]);
  const activity = useMemo(() => new Map(rows.map(item => {
    const resource = activityResource(item, data, model.resources, model.edges);
    return [activityID(item), { item, resource, ...activitySummary(item, resource) }];
  })), [rows, model, data.apps, data.connections]);
  const states = useMemo(() => new Map(data.agents.map(agent => {
    const own = rows.filter(item => item.raw.instance_id === agent.id).slice().reverse();
    const current = own.find(item => isCurrentActivity(item, own, now, connection === "open"));
    const report = data.statuses.filter(row => row.instance_id === agent.id && !row.stale).sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || ""))[0];
    const reportedWorking = report?.state === "working" && now - Date.parse(report.updated_at || "") < 120_000;
    const live = agent.status === "running" && connection === "open" && (!!current || reportedWorking);
    const label = agent.status !== "running" ? agent.status : live ? current?.kind === "thought" ? "Thinking" : "Working" : report?.state === "blocked" ? "Blocked" : report?.state === "waiting" ? "Waiting" : "Online";
    return [agent.id, { label, live, attention: ["blocked", "error", "failed"].includes(label.toLowerCase()),
      detail: live ? current ? activity.get(activityID(current))?.summary : report?.title : report?.state === "blocked" || report?.state === "waiting" ? report.title : agent.status === "running" ? "No current work confirmed" : "Agent is not running",
      resource: live && current ? activity.get(activityID(current))?.resource : undefined }];
  })), [data.agents, data.statuses, rows, activity, now, connection]);
  const baseline = useRef<{ scope: string; snapshot: Snapshot } | undefined>(undefined);
  const [journal, setJournal] = useState<{ scope: string; changes: WorkspaceChange[] }>({ scope, changes: [] });
  useEffect(() => {
    if (!enabled || data.loading || data.errors.length) return;
    if ((!baseline.current || baseline.current.scope !== scope) && data.agents.some(agent => !data.attachments[agent.id])) return;
    const next: Snapshot = new Map([...model.resources].map(([key, resource]) => {
      const agent = resource.ref.type === "agent" ? data.agents.find(agent => agent.id === Number(resource.ref.id)) : undefined;
      const confirmed = agent && data.attachments[agent.id] && !data.attachments[agent.id].error;
      return [key, { name: resource.name, signature: JSON.stringify([resource.name, resource.description, resource.icon, resource.agentIcon, agent?.config, resource.fields.filter(([label]) => !["Activity", "Reported", "Runtime", "Status"].includes(label))]),
        attachments: confirmed ? [...(model.edges.get(agent!.id) || [])].sort() : undefined }];
    }));
    const previous = baseline.current;
    baseline.current = { scope, snapshot: next };
    if (!previous || previous.scope !== scope) { setJournal({ scope, changes: [] }); return; }
    const changes: WorkspaceChange[] = [];
    for (const [key, value] of next) {
      const old = previous.snapshot.get(key);
      if (!old) { changes.push({ key, name: value.name, kind: "Added", detail: "Added to this workspace", at: Date.now() }); continue; }
      if (value.attachments && old.attachments && JSON.stringify(value.attachments) !== JSON.stringify(old.attachments)) {
        const added = value.attachments.filter(key => !old.attachments!.includes(key)).length;
        const removed = old.attachments.filter(key => !value.attachments!.includes(key)).length;
        changes.push({ key, name: value.name, kind: "Updated", detail: [added && `${added} capabilities attached`, removed && `${removed} detached`].filter(Boolean).join(" · "), at: Date.now(), attached: value.attachments.filter(key => !old.attachments!.includes(key)) });
      } else if (value.signature !== old.signature) changes.push({ key, name: value.name, kind: "Updated", detail: "Configuration changed", at: Date.now() });
      // Partial reads must not discard the last confirmed attachment baseline.
      if (!value.attachments) value.attachments = old.attachments;
    }
    for (const [key, value] of previous.snapshot) if (!next.has(key)) changes.push({ key, name: value.name, kind: "Removed", detail: "Removed from this workspace", at: Date.now() });
    if (changes.length) setJournal(current => ({ scope, changes: [...changes, ...(current.scope === scope ? current.changes : [])].slice(0, 20) }));
  }, [model, data.loading, data.errors, data.agents, data.attachments, enabled, scope]);
  const changes = journal.scope === scope ? journal.changes : [];
  const highlighted = new Map(changes.filter(change => now - change.at < 15_000).slice().reverse().flatMap(change => [change.key, ...(change.attached || [])].map(key => [key, change] as const)));
  return { ...model, activity, states, changes, highlighted, now, connection };
}
export type WorkspaceSystem = ReturnType<typeof useWorkspaceSystem>;
