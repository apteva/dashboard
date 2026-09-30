import type { RuntimeEventItem } from "./AgentView";
import { AgentToolIcon } from "./AgentToolIcon";
import { resolveToolVisual, type ToolVisualRegistry } from "./chat/toolVisuals";

export function agentActivityKind(event: RuntimeEventItem) {
  if (event.kind === "tool") return "Tool";
  if (event.kind === "error" || event.status === "error") return "Error";
  if (event.raw.type === "event.received") return "Event";
  if (event.kind === "thought") return "Thought";
  if (event.raw.type === "thread.message") return "Message";
  if (event.kind === "thread") return "Thread";
  if (event.kind === "channel") return "Message";
  return "Event";
}

/** System activity uses outline symbols; tools retain their source's identity. */
export function AgentActivityIcon({ event, registry }: { event: RuntimeEventItem; registry: ToolVisualRegistry }) {
  if (event.kind === "tool") return <AgentToolIcon visual={resolveToolVisual(event.toolName || event.label, registry)} status={event.status} />;
  const kind = agentActivityKind(event);
  const colorClass = {
    Tool: "text-accent",
    Thought: "text-activity-thought",
    Event: "text-success",
    Message: "text-info",
    Thread: "text-accent",
    Error: "text-error",
  }[kind];
  return <span aria-hidden="true" title={kind}
    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-transparent ${colorClass}`}>
    <svg className={event.status === "running" ? "motion-safe:animate-pulse" : undefined} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {kind === "Thought" ? <><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1.3 1-1.5 1.8-1.5 2.5h-5C9.5 15.8 9.3 15 8 14Z"/><path d="m12 6-1.5 3H14l-2 3"/></>
        : kind === "Message" ? <><path d="M5 5h14v11H9l-4 4V5Z"/><path d="M8 9h8m-8 3h5"/></>
        : kind === "Thread" ? <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-5h6c4 0 6-1 6-2"/></>
        : kind === "Error" ? <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/></>
        : <><path d="m12 3 9 9-9 9-9-9 9-9Z"/><path d="m8 12 8 0m-3-3 3 3-3 3"/></>}
    </svg>
  </span>;
}
