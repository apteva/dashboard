import { useState, useEffect, useRef } from "react";
import {
  core,
  telemetry,
  type TelemetryEvent,
  type Thread,
  type ThreadContextMessage,
  type PromptComposition,
} from "../api";
import { Modal } from "./Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  thread: Thread | null;
  instanceId: number;
  liveEvents: TelemetryEvent[]; // live SSE events filtered to this thread
  // Called after a successful kill so the parent can refresh the thread list.
  // Optional — when omitted the modal just closes itself.
  onKilled?: () => void;
}

type Tab = "live" | "history" | "context";

// Context snapshot returned by GET /threads/:id/context. Kept local
// because the tab caches the most recent fetch and we want a single
// shape for the render code below.
interface ContextSnapshot {
  iteration: number;
  model: string;
  count: number;
  total_chars: number;
  messages: ThreadContextMessage[];
  composition?: PromptComposition;
  fetchedAt: number; // ms epoch — surfaced so the user knows how fresh the snapshot is
}

export function ThreadDetailModal({ open, onClose, thread, instanceId, liveEvents, onKilled }: Props) {
  const [tab, setTab] = useState<Tab>("live");
  const [history, setHistory] = useState<TelemetryEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [ctx, setCtx] = useState<ContextSnapshot | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxError, setCtxError] = useState("");
  const [killBusy, setKillBusy] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll live feed
  useEffect(() => {
    if (tab === "live" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveEvents, tab]);

  // Load history when switching to history tab
  useEffect(() => {
    if (!open || !thread || tab !== "history") return;
    setLoadingHistory(true);
    telemetry.query(instanceId, undefined, 200, thread.id).then((events) => {
      setHistory(events.reverse()); // oldest first
      setLoadingHistory(false);
    }).catch(() => setLoadingHistory(false));
  }, [open, thread?.id, tab, instanceId]);

  const loadContext = (threadId: string) => {
    setCtxLoading(true);
    setCtxError("");
    core
      .threadContext(instanceId, threadId)
      .then((res) => {
        setCtx({
          iteration: res.iteration,
          model: res.model,
          count: res.count,
          total_chars: res.total_chars,
          messages: res.messages || [],
          composition: res.composition,
          fetchedAt: Date.now(),
        });
        setCtxLoading(false);
      })
      .catch((e: any) => {
        setCtxError(e?.message || "Failed to load context");
        setCtxLoading(false);
      });
  };

  // Load context on first open of the tab. Explicit refresh is handled
  // by the "refresh" button below — we don't want to refetch the
  // (potentially huge) messages array on every re-render.
  useEffect(() => {
    if (!open || !thread || tab !== "context") return;
    if (ctx) return;
    loadContext(thread.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, thread?.id, tab]);

  const exportContext = () => {
    if (!ctx || !thread) return;
    const payload = {
      instance_id: instanceId,
      thread_id: thread.id,
      iteration: ctx.iteration,
      model: ctx.model,
      count: ctx.count,
      total_chars: ctx.total_chars,
      fetched_at: new Date(ctx.fetchedAt).toISOString(),
      composition: ctx.composition,
      messages: ctx.messages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `context-${thread.id}-iter${ctx.iteration}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTab("live");
      setHistory([]);
      setCtx(null);
      setCtxError("");
    }
  }, [open]);

  if (!thread) return null;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green/60" />
              <h3 className="text-text font-bold text-sm">{thread.id}</h3>
              <span className="text-text-dim text-[10px] bg-border px-1.5 py-0.5 rounded">#{thread.iteration}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                thread.rate === "fast" || thread.rate === "reactive" ? "bg-accent/15 text-accent" :
                thread.rate === "sleep" ? "bg-border text-text-dim" : "bg-border text-text-muted"
              }`}>{thread.rate}</span>
            </div>
            <div className="flex items-center gap-2">
              {confirmReset ? (
                <>
                  <span className="text-[10px] text-text-dim">Reset history?</span>
                  <button
                    onClick={async () => {
                      setResetBusy(true);
                      try {
                        const resp = await core.resetThread(instanceId, thread.id);
                        setConfirmReset(false);
                        setCtx((prev) => prev ? { ...prev, count: resp.count, messages: prev.messages.slice(0, 1), total_chars: 0, fetchedAt: Date.now() } : prev);
                        setHistory([]);
                      } finally {
                        setResetBusy(false);
                      }
                    }}
                    disabled={resetBusy}
                    className="px-2 py-0.5 border border-yellow rounded text-[10px] text-yellow hover:bg-yellow hover:text-bg transition-colors disabled:opacity-50"
                  >
                    {resetBusy ? "…" : "confirm"}
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    disabled={resetBusy}
                    className="text-[10px] text-text-muted hover:text-text"
                  >
                    cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="px-2 py-0.5 border border-border rounded text-[10px] text-text-muted hover:text-yellow hover:border-yellow transition-colors"
                  title="Wipe this thread's conversation history; keep the thread alive"
                >
                  reset
                </button>
              )}
              {thread.id !== "main" && (
                confirmKill ? (
                  <>
                    <span className="text-[10px] text-text-dim">Kill thread?</span>
                    <button
                      onClick={async () => {
                        setKillBusy(true);
                        try {
                          await core.killThread(instanceId, thread.id);
                          setConfirmKill(false);
                          if (onKilled) onKilled();
                          onClose();
                        } finally {
                          setKillBusy(false);
                        }
                      }}
                      disabled={killBusy}
                      className="px-2 py-0.5 border border-red rounded text-[10px] text-red hover:bg-red hover:text-bg transition-colors disabled:opacity-50"
                    >
                      {killBusy ? "…" : "confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmKill(false)}
                      disabled={killBusy}
                      className="text-[10px] text-text-muted hover:text-text"
                    >
                      cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmKill(true)}
                    className="px-2 py-0.5 border border-border rounded text-[10px] text-text-muted hover:text-red hover:border-red transition-colors"
                    title="Kill this sub-thread (removes from config; will not respawn)"
                  >
                    kill
                  </button>
                )
              )}
              <button onClick={onClose} className="text-text-muted hover:text-text text-sm">x</button>
            </div>
          </div>
          {/* Meta row */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-dim">
            {thread.parent_id && <span>parent: <span className="text-text-muted">{thread.parent_id}</span></span>}
            {thread.model && <span>model: <span className="text-text-muted">{thread.model}</span></span>}
            {thread.mcp_names && thread.mcp_names.length > 0 && (
              <span className="flex gap-1">
                {thread.mcp_names.map((m) => (
                  <span key={m} className="px-1 py-0.5 rounded bg-accent/10 text-accent/70">MCP {m}</span>
                ))}
              </span>
            )}
          </div>
          {/* Directive */}
          {thread.directive && (
            <p className="mt-2 text-[10px] text-text-dim leading-relaxed line-clamp-2">{thread.directive}</p>
          )}
          {/* Tabs */}
          <div className="flex items-end gap-1 mt-3">
            {(["live", "history", "context"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 text-xs rounded-t transition-colors capitalize ${
                  tab === t ? "bg-bg text-accent border border-border border-b-0" : "text-text-muted hover:text-text"
                }`}
              >
                {t}
                {t === "live" ? ` (${liveEvents.length})` : ""}
                {t === "context" && ctx ? ` (${ctx.count})` : ""}
              </button>
            ))}
            {tab === "context" && (
              <div className="ml-auto flex items-center gap-2 pb-1">
                {ctx && (
                  <span className="text-[10px] text-text-dim" title={`fetched at ${new Date(ctx.fetchedAt).toLocaleTimeString()}`}>
                    iter #{ctx.iteration} · {formatChars(ctx.total_chars)}
                  </span>
                )}
                <button
                  onClick={() => thread && loadContext(thread.id)}
                  disabled={ctxLoading}
                  className="text-[10px] text-text-muted hover:text-text disabled:opacity-50"
                >
                  {ctxLoading ? "loading…" : "refresh"}
                </button>
                <button
                  onClick={exportContext}
                  disabled={!ctx}
                  className="text-[10px] text-accent hover:text-accent-hover disabled:opacity-50"
                >
                  export .json
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Event feed / context panel */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {tab === "live" && liveEvents.length === 0 && (
            <p className="text-text-muted text-xs text-center py-8">Waiting for events...</p>
          )}
          {tab === "history" && loadingHistory && (
            <p className="text-text-muted text-xs text-center py-8">Loading...</p>
          )}
          {(tab === "live" || tab === "history") && (tab === "live" ? liveEvents : history).map((ev, i) => (
            <EventRow key={ev.id || i} event={ev} />
          ))}
          {tab === "context" && ctxError && (
            <p className="text-red text-xs py-4">{ctxError}</p>
          )}
          {tab === "context" && !ctx && !ctxError && ctxLoading && (
            <p className="text-text-muted text-xs text-center py-8">Loading context...</p>
          )}
          {tab === "context" && ctx && ctx.composition && (
            <CompositionPanel composition={ctx.composition} />
          )}
          {tab === "context" && ctx && ctx.messages.length === 0 && (
            <p className="text-text-muted text-xs text-center py-8">No messages in context yet.</p>
          )}
          {tab === "context" && ctx && ctx.messages.map((m, i) => (
            <ContextMessageRow key={i} index={i} message={m} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

// CompositionPanel renders the bytes breakdown returned by
// GET /threads/:id/context. Two stacked horizontal bars — one for the
// system prompt (broken down by section), one for the tools[] payload
// (broken down by per-tool kind). Clicking a segment reveals the
// per-tool detail. Pure visualization — doesn't mutate anything.
function CompositionPanel({ composition }: { composition: PromptComposition }) {
  const [expanded, setExpanded] = useState(false);
  // Defensive defaults — Go can marshal nil slices as null and the panel
  // shouldn't crash if that ever happens (e.g. older core binary, mid-
  // upgrade rolling restart). Keep the UI alive; show empty sections.
  const sys = composition.system || ({} as PromptComposition["system"]);
  const nativeTools = composition.native_tools || [];
  const extraSystem = composition.extra_system || [];

  // Build an ordered list of system sections with non-zero bytes so
  // the bar only shows meaningful slices. Order matches the prompt's
  // natural flow so the user's mental model holds up across instances.
  const sysSections: Array<{ label: string; bytes: number; color: string; hint: string }> = [
    { label: "Base preamble", bytes: sys.base, color: "#64748b", hint: "Fixed thinking/pacing rules" },
    { label: "Core tools", bytes: sys.core_tools, color: "#3b82f6", hint: "Docs for pace, send, spawn, etc." },
    { label: "Retrieved tools", bytes: sys.retrieved_tools || 0, color: "#22d3ee", hint: "RAG-matched non-core tool docs (per-turn)" },
    { label: "MCP servers", bytes: sys.mcp_servers, color: "#06b6d4", hint: "Sub-thread catalog" },
    { label: "MCP tool docs", bytes: sys.mcp_tool_docs, color: "#0ea5e9", hint: "Full per-tool MCP descriptions" },
    { label: "Providers", bytes: sys.providers, color: "#84cc16", hint: "[AVAILABLE PROVIDERS]" },
    { label: "Active threads", bytes: sys.active_threads, color: "#a855f7", hint: "Live sub-thread list" },
    { label: "Safety mode", bytes: sys.safety_mode, color: "#f97316", hint: "Autonomous/cautious/learn prose" },
    { label: "Skills", bytes: sys.skills, color: "#eab308", hint: "skills/*.md content" },
    { label: "Blob hint", bytes: sys.blob_hint, color: "#14b8a6", hint: "[FILE HANDLES] explainer" },
    { label: "Previous context", bytes: sys.previous_context, color: "#8b5cf6", hint: "Session tail summary" },
    { label: "Directive", bytes: sys.directive, color: "#f43f5e", hint: "Your directive text" },
    { label: "Other", bytes: sys.other, color: "#475569", hint: "Unattributed text" },
  ].filter((s) => s.bytes > 0);

  // Roll up native tools by kind + size for the secondary bar, and
  // keep the full list for the expanded table.
  const toolsByKind = {
    core: nativeTools.filter((t) => t.kind === "core"),
    mcp: nativeTools.filter((t) => t.kind === "mcp"),
    local: nativeTools.filter((t) => t.kind === "local"),
  };
  const toolSegments = [
    { label: "Core", kind: "core" as const, bytes: toolsByKind.core.reduce((s, t) => s + t.bytes, 0), color: "#3b82f6" },
    { label: "MCP (main)", kind: "mcp" as const, bytes: toolsByKind.mcp.reduce((s, t) => s + t.bytes, 0), color: "#0ea5e9" },
    { label: "Local", kind: "local" as const, bytes: toolsByKind.local.reduce((s, t) => s + t.bytes, 0), color: "#84cc16" },
  ].filter((s) => s.bytes > 0);

  const grandTotal = composition.grand_total;

  return (
    <div className="border border-border rounded-md p-3 bg-bg-card/40 space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-text text-xs font-bold uppercase tracking-wide">Composition</h4>
        <span className="text-text-dim text-[10px]">
          what the LLM receives on the next call
        </span>
        <span className="ml-auto text-text text-xs font-bold tabular-nums">
          {formatChars(grandTotal)} total
        </span>
      </div>

      {/* Top-level summary row: system / tools / extra / conversation */}
      <TopLevelBar
        system={sys.total || 0}
        nativeTools={composition.native_bytes || 0}
        extraSystem={composition.extra_bytes || 0}
        conversation={composition.conv_bytes || 0}
      />

      {/* System sections */}
      {sysSections.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-text-muted uppercase tracking-wide font-bold">System prompt</span>
            <span className="text-text-dim tabular-nums">{formatChars(sys.total)}</span>
          </div>
          <SegmentBar total={sys.total} segments={sysSections} />
        </div>
      )}

      {/* Native tools */}
      {toolSegments.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-text-muted uppercase tracking-wide font-bold">Native tools (tools[])</span>
            <span className="text-text-dim tabular-nums">
              {formatChars(composition.native_bytes || 0)} · {nativeTools.length} tools
            </span>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="ml-auto text-[10px] text-accent hover:text-accent-hover"
            >
              {expanded ? "hide list" : "show list"}
            </button>
          </div>
          <SegmentBar total={composition.native_bytes || 0} segments={toolSegments} />
          {expanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5 pt-1">
              {[...nativeTools]
                .sort((a, b) => b.bytes - a.bytes)
                .map((t) => (
                  <div key={t.name} className="flex items-center gap-2 text-[10px]">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          t.kind === "core" ? "#3b82f6" : t.kind === "mcp" ? "#0ea5e9" : "#84cc16",
                      }}
                    />
                    <span className="text-text-dim truncate flex-1 font-mono">{t.name}</span>
                    <span className="text-text-muted tabular-nums">{formatChars(t.bytes)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Extra system blocks (e.g. [memories] per iteration) */}
      {extraSystem.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-text-muted uppercase tracking-wide font-bold">Extra system</span>
            <span className="text-text-dim tabular-nums">
              {formatChars(composition.extra_bytes || 0)} · {extraSystem.length} block
              {extraSystem.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-0.5">
            {extraSystem.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className="text-text-dim flex-1 truncate font-mono">{b.preview || "(empty)"}</span>
                <span className="text-text-muted tabular-nums">{formatChars(b.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// TopLevelBar shows the four major budget slices in one horizontal
// strip — the "big picture" before the per-section detail.
function TopLevelBar({ system, nativeTools, extraSystem, conversation }: {
  system: number; nativeTools: number; extraSystem: number; conversation: number;
}) {
  const total = system + nativeTools + extraSystem + conversation;
  if (total === 0) return null;
  const segs = [
    { label: "System", bytes: system, color: "#8b5cf6" },
    { label: "Tools[]", bytes: nativeTools, color: "#0ea5e9" },
    { label: "Extra system", bytes: extraSystem, color: "#f97316" },
    { label: "Conversation", bytes: conversation, color: "#64748b" },
  ].filter((s) => s.bytes > 0);
  return <SegmentBar total={total} segments={segs} />;
}

// SegmentBar is a single horizontal row of colored slices with a
// legend below. Percentages compute against the caller-supplied
// total so a nested bar (system sections) doesn't look like the
// global bar. Tooltip on each slice shows label + bytes + %.
function SegmentBar({ total, segments }: {
  total: number;
  segments: Array<{ label: string; bytes: number; color: string; hint?: string }>;
}) {
  if (total <= 0 || segments.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-border">
        {segments.map((s) => {
          const pct = (s.bytes / total) * 100;
          return (
            <div
              key={s.label}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              title={`${s.label}: ${s.bytes.toLocaleString()} chars (${pct.toFixed(1)}%)${s.hint ? " — " + s.hint : ""}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        {segments.map((s) => {
          const pct = (s.bytes / total) * 100;
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-text-dim">{s.label}</span>
              <span className="text-text-muted tabular-nums">
                {formatChars(s.bytes)} · {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k chars`;
  return `${n} chars`;
}

// ContextMessageRow renders one entry from the messages array. Long
// contents are collapsed by default so a worker holding a 50k-char
// transcript doesn't blow up the modal — click to expand a specific
// message, or use Export for the full thing.
function ContextMessageRow({ index, message }: { index: number; message: ThreadContextMessage }) {
  const [expanded, setExpanded] = useState(false);
  const roleColor =
    message.role === "system"
      ? "text-blue"
      : message.role === "assistant"
      ? "text-accent"
      : message.role === "tool"
      ? "text-green"
      : "text-text-muted";

  // Pick the "body" text we'll show. Plain content, or the concatenated
  // text of multimodal parts. Tool-only assistant turns and tool-result
  // turns are rendered as compact summaries below.
  const body = message.content && message.content.length > 0
    ? message.content
    : (message.parts || [])
        .map((p) => p.text || (p.type === "image_url" ? "[image]" : p.type === "input_audio" ? "[audio]" : p.type === "audio_url" ? "[audio url]" : ""))
        .filter(Boolean)
        .join("\n");

  const PREVIEW = 400;
  const truncated = body.length > PREVIEW;
  const displayBody = expanded || !truncated ? body : body.slice(0, PREVIEW) + "…";
  const toolCalls = message.tool_calls || [];
  const toolResults = message.tool_results || [];

  return (
    <div className="border border-border rounded-md px-3 py-2 space-y-1 bg-bg-card/30">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-text-dim">#{index}</span>
        <span className={`font-bold uppercase tracking-wide ${roleColor}`}>{message.role}</span>
        {toolCalls.length > 0 && (
          <span className="text-accent/70">· {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}</span>
        )}
        {toolResults.length > 0 && (
          <span className="text-green/70">· {toolResults.length} tool result{toolResults.length === 1 ? "" : "s"}</span>
        )}
        <span className="ml-auto text-text-muted">{body.length.toLocaleString()} chars</span>
      </div>
      {body && (
        <pre
          onClick={truncated ? () => setExpanded(!expanded) : undefined}
          className={`text-[11px] text-text leading-relaxed whitespace-pre-wrap break-words font-mono ${
            truncated ? "cursor-pointer hover:text-white" : ""
          }`}
        >
          {displayBody}
          {truncated && !expanded && (
            <span className="text-text-dim text-[10px] ml-1">[click to expand]</span>
          )}
        </pre>
      )}
      {toolCalls.map((tc, i) => (
        <div key={`tc${i}`} className="text-[10px] text-accent/80 font-mono pl-3 border-l border-accent/30">
          → {tc.name || "?"}({summarizeArgs(tc.arguments)})
        </div>
      ))}
      {toolResults.map((tr, i) => {
        const content = tr.content || "";
        const preview = content.length > 200 ? content.slice(0, 200) + "…" : content;
        return (
          <div key={`tr${i}`} className="text-[10px] text-green/80 font-mono pl-3 border-l border-green/30">
            ← {preview || (tr.image ? "[image]" : "(empty)")}
          </div>
        );
      })}
    </div>
  );
}

function summarizeArgs(args: any): string {
  if (!args) return "";
  if (typeof args === "string") {
    return args.length > 80 ? args.slice(0, 80) + "…" : args;
  }
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch {
    return "";
  }
}

function EventRow({ event }: { event: TelemetryEvent }) {
  const data = event.data || {};
  const time = event.time ? new Date(event.time).toLocaleTimeString() : "";

  // Tool call
  if (event.type === "tool.call") {
    const name = data.name || "?";
    const reason = data.reason || "";
    return (
      <div className="flex items-start gap-2 text-xs py-1">
        <span className="text-accent shrink-0">{">"}</span>
        <div className="min-w-0">
          <span className="text-accent font-medium">{name}</span>
          {reason && <span className="text-text-dim ml-1.5">{reason}</span>}
        </div>
        <span className="text-text-muted text-[10px] ml-auto shrink-0">{time}</span>
      </div>
    );
  }

  // Tool result
  if (event.type === "tool.result") {
    const name = data.name || "?";
    const dur = data.duration_ms != null
      ? data.duration_ms >= 1000 ? `${(data.duration_ms / 1000).toFixed(1)}s` : `${data.duration_ms}ms`
      : "";
    const ok = data.success !== false;
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span className={ok ? "text-green" : "text-red"}>
          {ok ? "+" : "x"}
        </span>
        <span className="text-text-dim">{name}</span>
        {dur && <span className="text-text-muted text-[10px]">({dur})</span>}
        <span className="text-text-muted text-[10px] ml-auto">{time}</span>
      </div>
    );
  }

  // LLM done (thought)
  if (event.type === "llm.done") {
    const msg = String(data.message || "").slice(0, 120);
    const tokens = (data.tokens_in || 0) + (data.tokens_out || 0);
    return (
      <div className="flex items-start gap-2 text-xs py-1">
        <span className="text-text-muted shrink-0">~</span>
        <div className="min-w-0">
          <p className="text-text-dim italic leading-relaxed truncate">{msg || "(no output)"}</p>
          {tokens > 0 && (
            <span className="text-text-muted text-[10px]">
              {data.tokens_in}in/{data.tokens_out}out
              {data.cost_usd ? ` $${data.cost_usd.toFixed(4)}` : ""}
            </span>
          )}
        </div>
        <span className="text-text-muted text-[10px] ml-auto shrink-0">{time}</span>
      </div>
    );
  }

  // Thread spawn/done
  if (event.type === "thread.spawn" || event.type === "thread.done") {
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span className={event.type === "thread.spawn" ? "text-green" : "text-red"}>
          {event.type === "thread.spawn" ? "+" : "-"}
        </span>
        <span className="text-text-dim">{event.type}</span>
        <span className="text-text-muted text-[10px] ml-auto">{time}</span>
      </div>
    );
  }

  // Event received (messages from other threads)
  if (event.type === "event.received") {
    const msg = String(data.message || "").slice(0, 100);
    return (
      <div className="flex items-start gap-2 text-xs py-1">
        <span className="text-green shrink-0">@</span>
        <p className="text-text-dim min-w-0 truncate">{msg}</p>
        <span className="text-text-muted text-[10px] ml-auto shrink-0">{time}</span>
      </div>
    );
  }

  // Generic fallback
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <span className="text-text-muted">.</span>
      <span className="text-text-dim">{event.type}</span>
      <span className="text-text-muted text-[10px] ml-auto">{time}</span>
    </div>
  );
}
