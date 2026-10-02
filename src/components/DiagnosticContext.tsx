import { useEffect, useRef, useState } from "react";
import { core, type PromptComposition } from "../api";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";

const number = (value: number) => Math.max(0, value || 0).toLocaleString();
const tokens = (bytes: number) => `~${number(Math.ceil((bytes || 0) / 4))}`;
const sections: [string, string][] = [
  ["base", "Main prompt / core instructions"], ["directive", "Agent directive"],
  ["core_tools", "Core tool instructions"], ["retrieved_tools", "Retrieved tool instructions"],
  ["mcp_servers", "MCP server catalog"], ["mcp_tool_docs", "MCP tool instructions"],
  ["skills", "Skills"], ["providers", "Provider instructions"], ["active_threads", "Thread instructions"],
  ["previous_context", "Previous context"], ["blob_hint", "File instructions"], ["safety_mode", "Safety instructions"], ["other", "Other system text"],
];
function SizeRow({ name, bytes, total }: { name: string; bytes: number; total: number }) {
  return <div className="py-1.5">
    <div className="flex items-center gap-2 text-[11px]"><span className="min-w-0 flex-1 truncate" title={name}>{name}</span><span className="shrink-0 tabular-nums text-text-muted" title={`${number(bytes)} bytes · approximate tokens`}>{tokens(bytes)}</span><span className="w-9 text-right tabular-nums text-text-dim">{total ? Math.round(bytes / total * 100) : 0}%</span></div>
    <div className="mt-1 h-0.5 overflow-hidden rounded bg-bg-hover"><div className="h-full bg-accent/60" style={{ width: `${total ? Math.min(100, bytes / total * 100) : 0}%` }} /></div>
  </div>;
}
export function PromptContextBreakdown({ composition }: { composition: PromptComposition }) {
  const sys = composition.system;
  const total = composition.grand_total || 0;
  return <div className="space-y-2">
    <details open><summary className="cursor-pointer py-1 text-xs font-medium">System prompt <span className="float-right tabular-nums text-text-muted">{tokens(sys?.total || 0)}</span></summary>
      <div className="pl-3">{sections.map(([key, name]) => ({ name, bytes: Number(sys?.[key as keyof typeof sys] || 0) })).filter(row => row.bytes > 0).map(row => <SizeRow key={row.name} {...row} total={total} />)}</div>
    </details>
    <details><summary className="cursor-pointer py-1 text-xs font-medium">Tool schemas · {composition.native_tools?.length || 0} <span className="float-right tabular-nums text-text-muted">{tokens(composition.native_bytes)}</span></summary>
      <div className="pl-3">{[...(composition.native_tools || [])].sort((a, b) => b.bytes - a.bytes).map((tool, index) => <SizeRow key={`${tool.name}:${index}`} name={`${tool.name} · ${tool.kind}`} bytes={tool.bytes} total={total} />)}</div>
    </details>
    <details><summary className="cursor-pointer py-1 text-xs font-medium">Injected context / memories <span className="float-right tabular-nums text-text-muted">{tokens(composition.extra_bytes)}</span></summary>
      <div className="pl-3">{(composition.extra_system || []).map((block, index) => <SizeRow key={index} name={block.preview || `System block ${index + 1}`} bytes={block.bytes} total={total} />)}</div>
    </details>
    <SizeRow name="Messages & tool results" bytes={composition.conv_bytes} total={total} />
    <p className="pt-1 text-[10px] leading-relaxed text-text-dim">Estimates use reported bytes ÷ 4, not a model tokenizer or billing counts. Images/audio and provider formatting can change actual usage. Percentages show each source’s share of the current payload.</p>
  </div>;
}
export function DiagnosticContext({ agentId, threadId, running, onOpen }: { agentId: number; threadId: string; running: boolean; onOpen: () => void }) {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof core.threadContext>> | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const refreshContext = useRef<(() => void) | null>(null);
  useTelemetryEvents(agentId, event => {
    if ((event.thread_id || "main") === threadId && [
      "llm.start", "llm.done", "tool.result", "llm.context_compacted",
      "session.compaction_done", "execution.restored", "thread.message",
    ].includes(event.type)) refreshContext.current?.();
  });
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let reload = false;
    let lastStarted = 0;
    let scheduled: number | undefined;
    setSnapshot(null); setUpdated(null); setError("");
    // Throttle instead of trailing debounce: a busy agent must never postpone
    // context refresh indefinitely. Changes during a request get a follow-up.
    const request = () => {
      if (cancelled || !running) return;
      if (pending) { reload = true; return; }
      if (scheduled !== undefined) return;
      scheduled = window.setTimeout(() => {
        scheduled = undefined;
        void load();
      }, Math.max(0, 750 - (Date.now() - lastStarted)));
    };
    const load = async () => {
      if (cancelled) return;
      pending = true;
      lastStarted = Date.now();
      try {
        const next = await core.threadContext(agentId, threadId);
        if (!cancelled) { setSnapshot(next); setUpdated(new Date()); setError(""); }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Context unavailable");
      } finally {
        pending = false;
        if (reload) { reload = false; request(); }
      }
    };
    refreshContext.current = request;
    request();
    const timer = running ? window.setInterval(request, 5000) : undefined;
    const visible = () => { if (document.visibilityState === "visible") request(); };
    window.addEventListener("apteva.telemetry.reconnected", request);
    window.addEventListener("apteva.telemetry.gap", request);
    window.addEventListener("focus", request);
    window.addEventListener("online", request);
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      refreshContext.current = null;
      clearInterval(timer); clearTimeout(scheduled);
      window.removeEventListener("apteva.telemetry.reconnected", request);
      window.removeEventListener("apteva.telemetry.gap", request);
      window.removeEventListener("focus", request);
      window.removeEventListener("online", request);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [agentId, threadId, running]);
  const composition = snapshot?.composition;
  const estimated = Math.ceil((composition?.grand_total || 0) / 4);
  const capacity = composition?.model_max_tokens || 0;
  const percentage = capacity > 0 ? estimated / capacity * 100 : null;
  return <section className="border-t border-border p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">Context · {threadId === "main" ? "main" : threadId}</h3><span className="text-[10px] text-text-dim">{running ? "Automatic updates" : "Offline"}</span></div>
    {!running ? <p className="mt-3 text-xs text-text-muted">Start the agent to inspect live context.</p> : <>
      {error && <p role="status" className="mt-2 text-xs text-yellow">{snapshot ? "Showing the last snapshot; retrying automatically." : `Context unavailable: ${error} · Retrying automatically…`}</p>}
      {!snapshot && !error && <p className="mt-3 text-xs text-text-muted">Loading context…</p>}
      {snapshot && <>
        <p className="mt-2 truncate text-[11px] text-text-muted" title={snapshot.model}>{snapshot.model || "Model not reported"} · iteration {snapshot.iteration} · {snapshot.count} messages</p>
        {composition ? <><div className="mt-3 flex items-baseline justify-between gap-2"><strong className="text-base font-medium tabular-nums">{tokens(composition.grand_total)} tokens</strong><span className="text-[11px] text-text-muted">{capacity ? `of ${number(capacity)}` : "Window unknown"}</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-bg-hover"><div className={`h-full ${percentage != null && percentage > 85 ? "bg-yellow" : "bg-accent"}`} style={{ width: `${Math.min(100, percentage || 0)}%` }} /></div>
          <p className="my-2 text-[10px] text-text-dim">{percentage != null ? `~${percentage.toFixed(1)}% of model window · ` : ""}{number(composition.grand_total)} bytes</p>
          <PromptContextBreakdown composition={composition} /></> : <p className="mt-2 text-xs text-text-muted">This Core version did not provide a context breakdown.</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-dim"><span>Updated {updated?.toLocaleTimeString()} · refreshes live</span><button type="button" onClick={onOpen} className="cursor-pointer text-accent">Inspect messages →</button></div>
      </>}
    </>}
  </section>;
}
