import { useEffect, useState } from "react";
import type { Thread } from "../api";
import type { RuntimeEventItem } from "./AgentView";
import { cleanReasoningDisplay } from "../utils/runtimeThought";
import { formatToolPayload } from "../utils/runtimePayload";
import { runtimeToolLabel } from "../utils/runtimeToolLabel";
import { AgentActivityIcon, agentActivityKind } from "./AgentActivityIcon";
import { resolveToolVisual, type ToolVisualRegistry } from "./chat/toolVisuals";
import { Modal } from "./Modal";

const buttonClass = "min-h-9 rounded-md border border-border px-3 text-xs font-semibold text-text-muted hover:border-accent hover:text-accent";

function thoughtContent(event: RuntimeEventItem) {
  return {
    reasoning: cleanReasoningDisplay(event.reasoningDetail || ""),
    response: event.responseDetail?.trim() || "",
  };
}

function eventTitle(event: RuntimeEventItem) {
  if (event.kind === "thought") return event.status === "running" ? "Thinking · in progress" : "Thought · completed";
  if (event.kind === "tool") return `${runtimeToolLabel(event.toolName || event.label, "")} · ${event.status === "error" ? "failed" : event.status === "running" ? "in progress" : event.status === "success" ? "finished" : "activity"}`;
  return event.label;
}

function eventDetail(event: RuntimeEventItem) {
  return event.kind === "tool" && event.detail === event.toolName ? "" : event.detail || "";
}

function sourceLabel(event: RuntimeEventItem, registry: ToolVisualRegistry) {
  return event.kind === "tool" ? resolveToolVisual(event.toolName || event.label, registry).label : agentActivityKind(event);
}

function timeLabel(time: string) {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function elapsedLabel(time: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(time)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function previewText(text: string, streaming: boolean) {
  const compact = text.replace(/\s+/g, " ").trim();
  // Keep the latest streamed words visible instead of showing an unchanged
  // first line while the rest of the thought grows outside the preview.
  return streaming && compact.length > 180 ? `…${compact.slice(-180)}` : compact;
}

function ActivityPreview({ event, now }: { event: RuntimeEventItem; now: number }) {
  const streaming = event.status === "running";
  const { reasoning, response } = thoughtContent(event);
  if (event.kind === "thought") {
    if (reasoning || response) return <span className="block truncate">{previewText(response || reasoning, streaming)}</span>;
    return <span className="block truncate">{streaming ? `Waiting for model output · ${elapsedLabel(event.time, now)}` : "No thought text was recorded."}</span>;
  }
  const detail = eventDetail(event);
  if (detail) return <span className="block truncate">{previewText(detail, streaming)}</span>;
  return <span className="block truncate">{streaming ? "Tool is running…" : event.kind === "tool" ? "Open for tool inputs and result" : "Open for details"}</span>;
}

/** Overview and Activity use the same records, previews and live detail view. */
export function AgentActivity({ events, loading, compact = false, onDetails, toolRegistry, threads = [] }: {
  events: RuntimeEventItem[];
  loading: boolean;
  compact?: boolean;
  onDetails: (id: string) => void;
  toolRegistry: ToolVisualRegistry;
  threads?: Thread[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [thread, setThread] = useState("");
  // Resolve by key on each render so an open thought continues receiving text.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedEvent = events.find((event) => (event.activityId || event.key) === selectedKey) || null;
  const threadIds = Array.from(new Set([...threads.map((item) => item.id), ...events.map((event) => event.threadId || "main")]));
  const visible = [...events].reverse().filter((event) => {
    if (compact) return true;
    if (thread && (event.threadId || "main") !== thread) return false;
    if (filter === "thoughts" && event.kind !== "thought") return false;
    if (filter === "tools" && event.kind !== "tool") return false;
    if (filter === "events" && agentActivityKind(event) !== "Event") return false;
    if (filter === "errors" && event.kind !== "error" && event.status !== "error") return false;
    const { reasoning, response } = thoughtContent(event);
    return `${eventTitle(event)} ${sourceLabel(event, toolRegistry)} ${eventDetail(event)} ${reasoning} ${response} ${event.threadId || "main"}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const shown = compact ? visible.slice(0, 5) : visible;
  const hasPendingThought = shown.some((event) => event.kind === "thought" && event.status === "running" && !event.reasoningDetail && !event.responseDetail);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasPendingThought) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasPendingThought]);

  return <div className="min-w-0">
    <AgentEventDetails event={selectedEvent} toolRegistry={toolRegistry} onClose={() => setSelectedKey(null)} onDetails={onDetails} />
    {!compact && <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">{[["all", "All activity"], ["thoughts", "Thoughts"], ["tools", "Tools"], ["events", "Events"], ["errors", "Errors"]].map(([id, label]) =>
        <button type="button" key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
          className={`${buttonClass} ${filter === id ? "border-accent/50 bg-accent/10 text-accent" : ""}`}>{label}</button>)}</div>
      <div className="flex w-full min-w-0 flex-wrap gap-2 sm:ml-auto sm:w-auto">
        {threadIds.length > 1 && <select aria-label="Filter activity by thread" value={thread} onChange={(event) => setThread(event.target.value)} className="min-h-10 max-w-full rounded-lg border border-border bg-bg-input px-2 text-xs text-text sm:max-w-48">
          <option value="">All threads</option>
          {threadIds.map((id) => <option key={id} value={id}>{threads.find((item) => item.id === id)?.name || id}</option>)}
        </select>}
        <input aria-label="Search activity" placeholder="Search activity" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-3 text-sm text-text sm:w-52" />
      </div>
    </div>}
    {shown.length === 0 ? <p className="py-4 text-sm leading-relaxed text-text-muted">{loading ? "Loading activity…" : events.length ? "No activity matches this filter." : "No recorded activity yet."}</p>
      : <div className="divide-y divide-border/60">{shown.map((event) => {
        return <button type="button" key={event.activityId || event.key} onClick={() => setSelectedKey(event.activityId || event.key)} className="group flex h-20 w-full min-w-0 items-start gap-3 overflow-hidden rounded-lg px-1 py-2 text-left hover:bg-bg-hover" aria-label={`Open ${sourceLabel(event, toolRegistry)} activity: ${eventTitle(event)}`}>
          <AgentActivityIcon event={event} registry={toolRegistry} />
          <span className="grid min-w-0 flex-1 grid-rows-[1rem_1.25rem_1.125rem] gap-1">
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-xs font-medium leading-4 text-text-muted">{sourceLabel(event, toolRegistry)}</span>
              <time dateTime={event.time} title={new Date(event.time).toLocaleString()} className="shrink-0 text-[11px] leading-4 text-text-dim">{timeLabel(event.time)}</time>
            </span>
            <span className="block truncate text-sm font-medium leading-5 text-text" title={eventTitle(event)}>{eventTitle(event)}</span>
            <span className="block min-w-0 overflow-hidden text-xs leading-[1.125rem] text-text-muted"><ActivityPreview event={event} now={now} /></span>
          </span>
        </button>;
      })}</div>}
    {!compact && <p className="mt-5 text-xs text-text-dim">{visible.length} recorded activities{thread ? " in this thread" : " across all threads"}. Open an item for its full content and technical details.</p>}
  </div>;
}

function ContentBlock({ title, text, code = false }: { title: string; text: string; code?: boolean }) {
  return <section className="min-w-0">
    <h3 className="mb-2 text-xs font-semibold text-text-muted">{title}</h3>
    {code ? <pre className="max-h-80 overflow-auto rounded-lg border border-border p-3 text-xs text-text">{text}</pre>
      : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{text}</p>}
  </section>;
}

export function AgentEventDetails({ event, onClose, onDetails, toolRegistry }: { event: RuntimeEventItem | null; onClose: () => void; onDetails: (id: string) => void; toolRegistry: ToolVisualRegistry }) {
  const { reasoning, response } = event ? thoughtContent(event) : { reasoning: "", response: "" };
  return <Modal open={!!event} onClose={onClose} ariaLabel="Activity details" width="max-w-3xl">
    {event && <div className="max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <AgentActivityIcon event={event} registry={toolRegistry} />
        <div className="min-w-0 flex-1"><p className="mb-1 text-xs font-medium text-text-muted">{sourceLabel(event, toolRegistry)}</p><h2 className="break-words text-base font-semibold text-text">{eventTitle(event)}</h2><p className="mt-1 text-xs text-text-muted">{new Date(event.time).toLocaleString()}</p></div>
        <button type="button" onClick={onClose} aria-label="Close activity details" className={buttonClass}>×</button>
      </div>
      <div className="mt-5 space-y-5">
        {reasoning && <ContentBlock title="Thought" text={reasoning} />}
        {response && <ContentBlock title="Response" text={response} />}
        {event.kind === "thought" && !reasoning && !response && <p className="text-sm text-text-muted">{event.status === "running" ? "Waiting for thought text…" : "No thought text was recorded for this step."}</p>}
        {event.kind !== "thought" && eventDetail(event) && <ContentBlock title="Details" text={eventDetail(event)} />}
        {event.toolArgs && <ContentBlock title="Tool inputs" text={event.toolArgs} code />}
        {event.toolResult && <ContentBlock title="Tool result" text={event.toolResult} code />}
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold text-text-muted">Technical details</summary>
          <div className="mt-3 space-y-3">
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-text-muted">
              <div><dt>Thread</dt><dd className="break-all text-text">{event.threadId || "main"}</dd></div>
              <div><dt>Event type</dt><dd className="break-all text-text">{event.raw.type}</dd></div>
              {event.durationMs != null && <div><dt>Duration</dt><dd className="text-text">{(event.durationMs / 1000).toFixed(2)}s</dd></div>}
            </dl>
            <ContentBlock title="Raw event" text={formatToolPayload(event.raw)} code />
            <button type="button" className={buttonClass} onClick={() => { onClose(); onDetails(event.threadId || "main"); }}>Open thread context</button>
          </div>
        </details>
      </div>
      <div className="mt-6 flex justify-end"><button type="button" className={buttonClass} onClick={onClose}>Done</button></div>
    </div>}
  </Modal>;
}
