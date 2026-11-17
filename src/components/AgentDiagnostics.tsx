import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Agent, ExecutionControlStatus, Status, TelemetryEvent, Thread } from "../api";
import { sleepLabel } from "../utils/sleepStatus";
import { threadTokenUsage } from "../utils/threadTokenUsage";
import { DIAGNOSTIC_EVENT_LIMIT, diagnosticEventKey, useDiagnosticTelemetry } from "../hooks/useDiagnosticTelemetry";
import { DiagnosticContext } from "./DiagnosticContext";

const control = "min-h-8 cursor-pointer rounded-md border border-border px-2 text-[11px] transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent";
const columns = "grid grid-cols-[96px_142px_90px_minmax(120px,1fr)_64px_64px_64px_64px] items-center gap-2";
const number = (value?: number | null) => value == null ? "—" : value.toLocaleString();
function numeric(data: Record<string, any>, ...keys: string[]) {
  for (const key of keys) if (data?.[key] != null && Number.isFinite(Number(data[key]))) return Number(data[key]);
  return null;
}
function summary(event: TelemetryEvent) {
  const d = event.data || {};
  const parts = [d.name || d.tool || d.model, d.error || d.message || d.reason || d.text || d.chunk || d.status];
  return parts.filter(value => typeof value === "string" && value).join(" · ").replace(/\s+/g, " ") || (d.iteration != null ? `iteration ${d.iteration}` : event.type);
}
function timeLabel(time: string) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return "—";
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}
function durationLabel(duration: number | null) {
  return duration == null ? "—" : duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(2)}s`;
}
function eventColor(event: TelemetryEvent) {
  if (event.type.includes("error") || event.type.includes("failed") || event.data?.error || event.data?.is_error || event.data?.success === false) return "text-red";
  if (event.type.startsWith("llm.")) return "text-purple";
  if (event.type.startsWith("tool.")) return "text-accent";
  if (event.type.startsWith("thread.")) return "text-green";
  return "text-text-muted";
}

export function AgentDiagnostics({ instance, status, execution, connection, threads, activeTools, thinking, selectedThreadId, onThreadSelect, onThreadOpen, onConfig }: {
  instance: Agent; status: Status | null; execution: ExecutionControlStatus; connection: string;
  threads: Thread[]; activeTools: Record<string, string>; thinking: Record<string, boolean>;
  selectedThreadId: string; onThreadSelect: (id: string) => void; onThreadOpen: (id: string) => void; onConfig: () => void;
}) {
  const { events, loading, error } = useDiagnosticTelemetry(instance.id, selectedThreadId);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState<TelemetryEvent | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(500);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setSelectedEvent(null); }, [instance.id, selectedThreadId]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter(event => {
      const matches = family === "all" || (family === "errors" ? eventColor(event) === "text-red" : event.type.startsWith(`${family}.`));
      return matches && (!needle || `${event.type} ${event.thread_id} ${summary(event)}`.toLowerCase().includes(needle));
    });
  }, [events, query, family]);
  // Keep the row being read in place while newer events arrive above it.
  // Only the viewport is anchored: ingestion, totals and context remain live.
  const previousRows = useRef<{ scope: string; rows: TelemetryEvent[] }>({ scope: "", rows: [] });
  const scope = JSON.stringify([instance.id, selectedThreadId, query, family]);
  useLayoutEffect(() => {
    const el = viewport.current;
    const previous = previousRows.current;
    previousRows.current = { scope, rows: filtered };
    if (!el) return;
    if (previous.scope !== scope) {
      el.scrollTop = 0;
    } else if (el.scrollTop > 0) {
      const index = Math.floor(el.scrollTop / 32);
      const anchor = previous.rows[index];
      const nextIndex = anchor ? filtered.findIndex(event => diagnosticEventKey(event) === diagnosticEventKey(anchor)) : -1;
      if (nextIndex >= 0) el.scrollTop += (nextIndex - index) * 32;
    }
    setScrollTop(el.scrollTop);
  }, [filtered, scope]);
  const tokenUsage = useMemo(() => threadTokenUsage(events), [events]);
  const ids = [...new Set(["main", ...threads.map(thread => thread.id), ...events.map(event => event.thread_id || "main"), ...(selectedThreadId ? [selectedThreadId] : [])])];
  const contextThread = selectedThreadId || "main";
  const thread = threads.find(row => row.id === contextThread);
  const mainContext = contextThread === "main";
  const runtimeModel = thread?.model || (mainContext ? status?.model : undefined);
  const runtimeIteration = thread?.iteration ?? (mainContext ? status?.iteration : undefined);
  const state = instance.status !== "running" ? instance.status : activeTools[contextThread] ? `Tool: ${activeTools[contextThread]}` : thinking[contextThread] ? "Thinking" : thread?.sleep_state ? sleepLabel(thread, { compact: true }) : mainContext && status ? sleepLabel(status, { compact: true }) : thread ? thread.rate || "Waiting" : "Thread no longer live";
  const start = Math.max(0, Math.floor(scrollTop / 32) - 8);
  const visibleRows = filtered.slice(start, start + Math.ceil(height / 32) + 16);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <label className="flex items-center gap-2 text-[11px] text-text-muted">Scope
        <select value={selectedThreadId} onChange={event => onThreadSelect(event.target.value)} className={`${control} max-w-56 bg-bg-input text-text`} aria-label="Diagnostics thread">
          <option value="">Agent · all threads</option>
          {ids.map(id => <option key={id} value={id}>{threads.find(thread => thread.id === id)?.name || id}</option>)}
        </select>
      </label>
      <span className={`text-[10px] ${connection === "open" ? "text-green" : "text-yellow"}`}>{connection === "open" ? "Live telemetry" : `Telemetry: ${connection}`}</span>
      <button type="button" onClick={onConfig} className={`${control} ml-auto`}>Configuration</button>
    </div>
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,55vh)_auto] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1 lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="flex min-h-0 min-w-0 flex-col" aria-label="Developer telemetry">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="text-xs font-semibold">Telemetry</h2>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter events…" aria-label="Search telemetry" className="h-8 min-w-24 flex-1 rounded-md border border-border bg-bg-input px-2 text-xs focus:border-accent focus:outline-none" />
          <select value={family} onChange={event => setFamily(event.target.value)} aria-label="Telemetry event type" className={`${control} bg-bg-input`}>
            <option value="all">All types</option><option value="llm">Model</option><option value="tool">Tools</option><option value="thread">Threads</option><option value="execution">Execution</option><option value="errors">Errors</option>
          </select>
        </div>
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[10px] tabular-nums text-text-muted" title="Totals from completed model calls in the loaded event window; not lifetime usage. Cached tokens are included in input.">
          <span>{filtered.length} events · newest first</span><span>Input {number(tokenUsage.in)}</span><span>Output {number(tokenUsage.out)}</span><span>Cached {tokenUsage.cacheReported ? number(tokenUsage.cache) : "—"}</span>{tokenUsage.cacheWrite > 0 && <span>Cache write {number(tokenUsage.cacheWrite)}</span>}
        </div>
        {error && <p role="status" className="px-3 py-2 text-xs text-yellow">{error} · Retrying automatically…</p>}
        <div ref={viewport} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} style={{ overflowAnchor: "none" }} className="min-h-0 flex-1 overflow-auto overscroll-contain" tabIndex={0} aria-label="Telemetry events; select a row to inspect its JSON">
          <div className="min-w-[800px]">
            <div className={`${columns} sticky top-0 z-10 h-8 border-b border-border bg-bg px-3 text-[10px] font-semibold text-text-dim`}><span>Time</span><span>Event</span><span>Thread</span><span>Summary</span><span className="text-right">Duration</span><span className="text-right">Input</span><span className="text-right">Output</span><span className="text-right">Cached</span></div>
            <div style={{ height: start * 32 }} />
            {visibleRows.map(event => {
              const data = event.data || {};
              const selected = selectedEvent && diagnosticEventKey(selectedEvent) === diagnosticEventKey(event);
              return <button key={diagnosticEventKey(event)} type="button" onClick={() => setSelectedEvent(event)} aria-pressed={!!selected} className={`${columns} h-8 w-full cursor-pointer border-b border-border/40 px-3 text-left font-mono text-[11px] transition-colors hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${selected ? "bg-accent/10" : ""}`}>
                <time dateTime={event.time} title={event.time} className="truncate tabular-nums text-text-dim">{timeLabel(event.time)}</time>
                <span title={event.type} className={`truncate ${eventColor(event)}`}>{event.type}</span>
                <span className="truncate text-text-muted" title={event.thread_id || "main"}>{event.thread_id || "main"}</span>
                <span className="truncate text-text" title={summary(event)}>{summary(event)}</span>
                <span className="text-right tabular-nums text-text-muted">{durationLabel(numeric(data, "duration_ms", "elapsed_ms", "completion_ms"))}</span>
                <span className="text-right tabular-nums text-text-muted">{number(numeric(data, "tokens_in", "input_tokens"))}</span>
                <span className="text-right tabular-nums text-text-muted">{number(numeric(data, "tokens_out", "output_tokens"))}</span>
                <span className="text-right tabular-nums text-text-muted">{number(numeric(data, "tokens_cached", "cache_read_tokens", "cached_tokens"))}</span>
              </button>;
            })}
            <div style={{ height: Math.max(0, filtered.length - start - visibleRows.length) * 32 }} />
          </div>
          {!filtered.length && <p className="p-5 text-xs text-text-muted">{loading ? "Loading telemetry…" : error ? "Telemetry could not be loaded." : "No matching telemetry events."}</p>}
        </div>
        <p className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-text-dim">Latest {DIAGNOSTIC_EVENT_LIMIT.toLocaleString()} events per scope · all event types retained · select a row for payload · updates automatically while you scroll</p>
      </section>
      <aside className="min-h-0 min-w-0 border-t border-border lg:overflow-y-auto lg:border-l lg:border-t-0" aria-label="Runtime and context inspector">
        <section className="p-3">
          <h2 className="text-xs font-semibold">Runtime &amp; context</h2>
          <p className="mt-1 text-[10px] text-text-muted">{selectedThreadId ? `Thread ${thread?.name || selectedThreadId}` : "Agent scope · main thread context below"}</p>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px]">
            <dt className="text-text-muted">State</dt><dd className="truncate" title={state}>{state}</dd>
            <dt className="text-text-muted">Model</dt><dd className="truncate" title={runtimeModel}>{runtimeModel || "—"}</dd>
            <dt className="text-text-muted">Iteration</dt><dd className="tabular-nums">{number(runtimeIteration)}</dd>
            <dt className="text-text-muted">Execution</dt><dd>{execution.mode}{execution.waiting ? " · waiting" : ""}</dd>
            <dt className="text-text-muted">Live threads</dt><dd>{instance.status === "running" ? new Set(["main", ...threads.map(row => row.id)]).size : 0}</dd><dt className="text-text-muted">Uptime</dt><dd>{status ? `${Math.floor(status.uptime_seconds / 60)}m` : "—"}</dd>
          </dl>
        </section>
        {selectedEvent && <section className="border-t border-border p-3">
          <div className="flex items-center justify-between gap-2"><h3 className="truncate font-mono text-xs font-semibold" title={selectedEvent.type}>{selectedEvent.type}</h3><button type="button" onClick={() => setSelectedEvent(null)} className="cursor-pointer text-xs text-text-muted hover:text-text" aria-label="Close telemetry payload">×</button></div>
          <p className="mt-1 text-[10px] text-text-dim">{selectedEvent.time} · {selectedEvent.thread_id || "main"}</p>
          <button type="button" className="my-2 cursor-pointer text-[11px] text-accent" onClick={() => onThreadSelect(selectedEvent.thread_id || "main")}>Inspect this thread →</button>
          <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums">
            {([ ["Headers", numeric(selectedEvent.data, "response_headers_ms")], ["First chunk", numeric(selectedEvent.data, "first_chunk_ms")], ["First tool call", numeric(selectedEvent.data, "first_tool_call_ms")], ["Completion", numeric(selectedEvent.data, "completion_ms", "duration_ms")] ] as [string, number | null][]).filter(([, value]) => value != null).map(([label, value]) => <div key={label} className="flex justify-between gap-1"><dt className="text-text-muted">{label}</dt><dd>{durationLabel(value)}</dd></div>)}
            {numeric(selectedEvent.data, "cost_usd") != null && <div className="col-span-2 flex justify-between"><dt className="text-text-muted">Recorded cost</dt><dd>${numeric(selectedEvent.data, "cost_usd")!.toFixed(6)}</dd></div>}
          </dl>
          <pre className="max-h-72 overflow-auto rounded border border-border bg-bg-input p-2 text-[10px] leading-relaxed" tabIndex={0}>{JSON.stringify(selectedEvent, null, 2)}</pre>
        </section>}
        <DiagnosticContext key={`${instance.id}:${contextThread}`} agentId={instance.id} threadId={contextThread} running={instance.status === "running"} onOpen={() => onThreadOpen(contextThread)} />
      </aside>
    </div>
  </div>;
}
