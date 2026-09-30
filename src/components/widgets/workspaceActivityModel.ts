import type { RuntimeEventItem } from "../../utils/runtimeActivity";
import { buildToolVisualRegistry, resolveToolVisual } from "../chat/toolVisuals";
import type { WorkspaceData } from "./useWorkspaceData";
import { resourceKey, type WorkspaceResource } from "./workspaceModel";

export const compact = (value?: string, max = 180) => (value || "").replace(/\s+/g, " ").trim().slice(0, max);
export const humanToolName = (name = "Tool") => name.replace(/[_-]+/g, " ").replace(/\b\w/, c => c.toUpperCase());

/** Presentation-only folding; never removes records or suppresses tools/errors.
 * Only short, explicit idle responses on the main autonomous thread qualify. */
export function isRoutineActivity(item: RuntimeEventItem): boolean {
  if (item.kind !== "thought" || item.status !== "success") return false;
  const response = compact(item.responseDetail, 1000);
  const reasoning = compact(item.reasoningDetail, 1000);
  if (!response && !reasoning) return true;
  if (!response || response.length > 320 || item.threadId && item.threadId !== "main") return false;
  return /\bno (?:current |new |actionable |pending |standing )*(?:user |todo )?(?:request|task|work)\b|\bno (?:user )?request has arrived\b/i.test(response)
    && /\b(wait|waiting|standby|remain available|stay available|reassess later)\b/i.test(response)
    && !/\b(error|fail(?:ed|ure)?|blocked|approval|permission|missing|completed|created|saved|sent|updated)\b/i.test(response);
}

/** Recorded output is not necessarily a finished task or a final deliverable. */
export function isResultActivity(item: RuntimeEventItem): boolean {
  return item.status === "success" && !isRoutineActivity(item) && !!(item.responseDetail?.trim() || item.toolResult?.trim());
}

/** Resolve only a unique, configured capability for this agent. Never guess an account. */
export function activityResource(item: RuntimeEventItem, data: WorkspaceData, resources: Map<string, WorkspaceResource>, edges: Map<number, string[]>) {
  if (item.kind !== "tool" || !item.toolName) return undefined;
  const keys = new Set(edges.get(item.raw.instance_id) || []);
  const candidates: WorkspaceResource[] = [];
  for (const app of data.apps.filter(app => keys.has(`app:${app.install_id}`))) {
    const source = resolveToolVisual(item.toolName, buildToolVisualRegistry([app], []));
    if (source.key === `app:${app.install_id}`) candidates.push(resources.get(source.key)!);
  }
  for (const connection of data.connections.filter(connection => keys.has(`integration:${connection.id}`))) {
    const source = resolveToolVisual(item.toolName, buildToolVisualRegistry([], [connection]));
    if (source.key.startsWith("integration:")) candidates.push(resources.get(`integration:${connection.id}`)!);
  }
  if (candidates.length === 1) return candidates[0];
  return undefined;
}

export function activitySummary(item: RuntimeEventItem, resource?: WorkspaceResource) {
  const running = item.status === "running";
  const failed = item.status === "error" || item.kind === "error";
  if (item.kind === "tool") {
    const name = item.toolName || "Tool";
    const reason = compact(item.label.replace(`${name} — `, ""));
    const usefulReason = reason && ![name, `Running ${name}`, `Preparing ${name}`].includes(reason);
    return {
      title: humanToolName(name),
      summary: failed ? compact(item.detail !== name ? item.detail : undefined) || "The tool reported an error. Open the result for details."
        : usefulReason ? reason : `${running ? "Using" : "Used"} ${resource?.name || "a tool"}${running ? "…" : ". Open to see the result."}`,
    };
  }
  if (item.kind === "thought") return {
    title: running ? "Thinking" : item.responseDetail ? "Response ready" : "Thought completed",
    summary: compact(item.responseDetail || item.reasoningDetail) || (running ? "The agent is reasoning about its next step…" : "Reasoning completed. No text was recorded for this step."),
  };
  if (failed) return { title: "Needs attention", summary: compact(item.detail || item.label) || "An error was reported." };
  const titles: Record<string, string> = {
    "event.received": "Event received", "thread.message": "Message received",
    "thread.started": "Work started", "thread.spawned": "Work started", "thread.done": "Work finished", "thread.killed": "Work stopped",
  };
  return { title: titles[item.raw.type] || (item.kind === "thread" ? "Thread update" : "Event"), summary: compact(item.label || item.detail) };
}

export function resourceActivity(item: RuntimeEventItem, selected: WorkspaceResource | undefined, resource: WorkspaceResource | undefined, edges: Map<number, string[]>) {
  if (!selected) return true;
  if (selected.ref.type === "agent") return item.raw.instance_id === Number(selected.ref.id);
  if (item.kind === "tool") return !!resource && resourceKey(resource.ref) === resourceKey(selected.ref);
  return (edges.get(item.raw.instance_id) || []).includes(resourceKey(selected.ref));
}

export function isCurrentActivity(item: RuntimeEventItem, rows: RuntimeEventItem[], now: number, connected: boolean) {
  return item.status === "running" && connected && now - Date.parse(item.raw.time || item.time) < 120_000
    && !rows.some(later => later !== item && later.raw.instance_id === item.raw.instance_id && later.threadId === item.threadId
      && Date.parse(later.time) >= Date.parse(item.time)
      && (["thread.done", "thread.killed"].includes(later.raw.type) || item.kind === "thought" && ["llm.done", "llm.error"].includes(later.raw.type)));
}

export function activityState(item: RuntimeEventItem, now: number, connected: boolean, rows: RuntimeEventItem[] = []) {
  if (item.status === "error") return "Failed";
  if (item.status === "running") return isCurrentActivity(item, rows, now, connected) ? "In progress" : "Unconfirmed";
  return item.status === "success" ? "Finished" : "Recorded";
}
