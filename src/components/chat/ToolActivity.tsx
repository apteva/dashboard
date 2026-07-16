import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolActivity } from "./toolActivityModel";
import {
  resolveToolVisual,
  type ToolGlyph,
  type ToolVisual,
  type ToolVisualRegistry,
} from "./toolVisuals";

interface ToolActivityProps {
  tools: ToolActivity[];
  parallel?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  registry: ToolVisualRegistry;
  detailsId?: string;
}

type VisualState = "preparing" | "running" | "done" | "failed";
const loadedToolIconUrls = new Set<string>();

function visualState(tool: ToolActivity): VisualState {
  if (tool.state !== "done") return tool.state;
  return tool.success === false ? "failed" : "done";
}

function durationLabel(milliseconds?: number): string {
  if (milliseconds === undefined || milliseconds < 0) return "";
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${milliseconds}ms`;
}

function stateLabel(tool: ToolActivity, t: (key: string, options?: Record<string, unknown>) => string): string {
  const state = visualState(tool);
  if (state === "preparing") return t("chat.panel.toolPreparing");
  if (state === "running") return t("chat.panel.toolRunning");
  if (state === "failed") return t("chat.panel.toolFailed");
  return t("chat.panel.toolDone");
}

function reasonLabel(tool: ToolActivity, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (tool.reason.trim()) return tool.reason.trim();
  const state = visualState(tool);
  if (state === "preparing") return t("chat.panel.toolReasonPreparing");
  if (state === "running") return t("chat.panel.toolReasonRunning");
  if (state === "failed") return t("chat.panel.toolReasonFailed");
  return t("chat.panel.toolReasonDone");
}

function aggregateStatus(
  tools: ToolActivity[],
  t: (key: string, options?: Record<string, unknown>) => string,
): { text: string; state: VisualState } {
  const counts = { preparing: 0, running: 0, done: 0, failed: 0 };
  for (const tool of tools) counts[visualState(tool)] += 1;
  const parts = [
    counts.preparing ? t("chat.panel.toolsPreparingCount", { count: counts.preparing }) : "",
    counts.running ? t("chat.panel.toolsRunningCount", { count: counts.running }) : "",
    counts.failed ? t("chat.panel.toolsFailedCount", { count: counts.failed }) : "",
  ].filter(Boolean);
  if (parts.length === 0) parts.push(t("chat.panel.toolsCompleted"));
  const state: VisualState = counts.running || counts.preparing
    ? "running"
    : counts.failed
      ? "failed"
      : "done";
  return { text: parts.join(" · "), state };
}

function stateTextClass(state: VisualState): string {
  if (state === "done") return "text-green";
  if (state === "failed") return "chat-tool-failed-text";
  return "chat-tool-running-text";
}

function summaryFocusTool(tools: ToolActivity[]): ToolActivity {
  const active = tools.filter((tool) => tool.state !== "done");
  const candidates = active.length > 0 ? active : tools;
  return candidates.reduce((latest, tool) => {
    const latestTime = active.length > 0
      ? latest.startedAt
      : latest.finishedAt ?? latest.startedAt;
    const toolTime = active.length > 0
      ? tool.startedAt
      : tool.finishedAt ?? tool.startedAt;
    // Prefer the later item on a timestamp tie: the array order is the
    // stable arrival order, so it best represents what the operator saw last.
    return toolTime >= latestTime ? tool : latest;
  });
}

export function ChatToolActivity({
  tools,
  parallel = false,
  expanded = false,
  onToggle,
  registry,
  detailsId,
}: ToolActivityProps) {
  const { t } = useTranslation();
  if (tools.length === 0) return null;

  const grouped = tools.length > 1;
  const status = grouped
    ? aggregateStatus(tools, t)
    : { text: stateLabel(tools[0]!, t), state: visualState(tools[0]!) };
  const title = grouped
    ? parallel
      ? t("chat.panel.parallelToolCalls", { count: tools.length })
      : t("chat.panel.toolCalls", { count: tools.length })
    : reasonLabel(tools[0]!, t);
  const focusTool = summaryFocusTool(tools);
  const focusReason = reasonLabel(focusTool, t);
  const remainingCount = tools.length - 1;
  const resolvedDetailsId = detailsId || `chat-tool-details-${tools[0]!.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const accessibleSummary = `${title}, ${focusReason}, ${status.text}`;

  return (
    <section className="chat-tool-activity min-w-0 py-2.5 sm:py-3" aria-label={accessibleSummary}>
      <button
        type="button"
        className={`grid min-h-11 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-1 text-left sm:gap-3 ${
          grouped
            ? "hover:bg-bg-hover/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            : "cursor-default"
        }`}
        aria-expanded={grouped ? expanded : undefined}
        aria-controls={grouped ? resolvedDetailsId : undefined}
        aria-disabled={grouped ? undefined : true}
        tabIndex={grouped ? 0 : -1}
        onClick={grouped ? onToggle : undefined}
        title={grouped ? `${title} · ${expanded ? t("chat.panel.hideToolCalls") : t("chat.panel.showToolCalls")}` : focusReason}
      >
        <ToolIconStack tools={tools} registry={registry} />
        <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13px] font-medium text-text sm:text-sm" title={focusReason}>
              {focusReason}
            </span>
            {remainingCount > 0 && (
              <span className="shrink-0 text-[11px] font-medium text-text-muted sm:text-xs">+{remainingCount}</span>
            )}
          </span>
          <span className={`truncate text-[11px] sm:text-xs ${stateTextClass(status.state)}`}>{status.text}</span>
        </span>
        {grouped
          ? <ChevronIcon expanded={expanded} />
          : <span className="h-5 w-5 shrink-0" aria-hidden="true" />}
      </button>
      {grouped && expanded && (
        <div id={resolvedDetailsId} className="mt-2 grid min-w-0 sm:pl-12">
          {tools.map((tool) => (
            <ToolCallRow key={tool.id} tool={tool} registry={registry} />
          ))}
        </div>
      )}
    </section>
  );
}

function ToolIconStack({ tools, registry }: { tools: ToolActivity[]; registry: ToolVisualRegistry }) {
  const sources: Array<{ tool: ToolActivity; visual: ToolVisual }> = [];
  for (const tool of tools) {
    const visual = resolveToolVisual(tool.name, registry);
    const existing = sources.find((source) => source.visual.key === visual.key);
    if (existing) {
      // Preserve first-seen source ordering, but let any active call for that
      // source drive the single representative icon's running state.
      if (existing.tool.state === "done" && tool.state !== "done") existing.tool = tool;
      continue;
    }
    sources.push({ tool, visual });
  }
  const visible = sources.slice(0, 4);
  const extra = Math.max(0, sources.length - visible.length);
  return (
    <span className="flex min-w-[2.15rem] items-center py-1 pl-0.5" aria-hidden="true">
      {visible.map(({ tool, visual }, index) => (
        <span key={visual.key} className={index === 0 ? "relative" : "relative -ml-1.5"} style={{ zIndex: visible.length - index }}>
          <ToolSourceIcon tool={tool} visual={visual} compact />
        </span>
      ))}
      {extra > 0 && (
        <span className="relative -ml-1.5 inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-bg-hover px-1 text-[10px] font-semibold text-text-muted">
          +{extra}
        </span>
      )}
    </span>
  );
}

function ToolCallRow({
  tool,
  registry,
  standalone = false,
}: {
  tool: ToolActivity;
  registry: ToolVisualRegistry;
  standalone?: boolean;
}) {
  const { t } = useTranslation();
  const visual = useMemo(() => resolveToolVisual(tool.name, registry), [tool.name, registry]);
  const state = visualState(tool);
  const duration = durationLabel(tool.durationMs);
  const stateText = stateLabel(tool, t);
  const reason = reasonLabel(tool, t);
  return (
    <div
      className={`grid min-h-12 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 sm:gap-3 ${
        standalone ? "chat-tool-activity px-1" : "border-t border-border/60 first:border-t-0"
      }`}
      aria-label={`${reason}, ${stateText}${duration ? `, ${duration}` : ""}`}
    >
      <ToolSourceIcon tool={tool} visual={visual} />
      <span className="min-w-0 [overflow-wrap:anywhere] text-[13px] font-medium leading-relaxed text-text sm:text-sm">
        {reason}
      </span>
      <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide sm:text-[11px] ${stateTextClass(state)}`}>
        {state === "done" && <CheckIcon />}
        {state === "failed" && <FailureIcon />}
        <span>{stateText}</span>
        {duration && <span className="text-text-dim">· {duration}</span>}
      </span>
    </div>
  );
}

function ToolSourceIcon({
  tool,
  visual,
  compact = false,
}: {
  tool: ToolActivity;
  visual: ToolVisual;
  compact?: boolean;
}) {
  const canRenderImage = !!visual.iconUrl && /^(https?:|data:|\/)/.test(visual.iconUrl);
  const iconUrl = canRenderImage ? visual.iconUrl! : "";
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(() => loadedToolIconUrls.has(iconUrl));
  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(loadedToolIconUrls.has(iconUrl));
  }, [iconUrl]);
  const state = visualState(tool);
  const size = compact ? "h-8 w-8 rounded-lg" : "h-9 w-9 rounded-[0.6rem]";
  const stateClass = state === "running" || state === "preparing"
    ? "chat-tool-icon-running"
    : "";
  return (
    <span
      className={`chat-tool-icon relative inline-flex shrink-0 items-center justify-center bg-bg-hover text-text-muted ${size} ${stateClass}`}
      title={visual.label}
      aria-hidden="true"
    >
      <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${imageLoaded && !imageFailed ? "opacity-0" : "opacity-100"}`}>
        <ToolGlyphIcon glyph={visual.glyph} />
      </span>
      {canRenderImage && !imageFailed && (
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 h-full w-full rounded-[inherit] bg-bg-hover object-contain p-1 transition-opacity duration-150 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => {
            loadedToolIconUrls.add(iconUrl);
            setImageLoaded(true);
          }}
          onError={() => setImageFailed(true)}
        />
      )}
    </span>
  );
}

function ToolGlyphIcon({ glyph }: { glyph: ToolGlyph }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (glyph === "agent") return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M6.5 19c.8-3.4 2.6-5 5.5-5s4.7 1.6 5.5 5"/><path d="M18 6h3m-1.5-1.5v3"/></svg>;
  if (glyph === "chart") return <svg {...common}><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>;
  if (glyph === "document") return <svg {...common}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/></svg>;
  if (glyph === "globe") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>;
  if (glyph === "memory") return <svg {...common}><path d="M9 5a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 5 14v2a3 3 0 0 0 4 2.8M15 5a3 3 0 0 1 5 2.2A3.5 3.5 0 0 1 19 14v2a3 3 0 0 1-4 2.8M9 4v16m6-16v16M9 9h6m-6 6h6"/></svg>;
  if (glyph === "message") return <svg {...common}><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8m-8 3h5"/></svg>;
  if (glyph === "search") return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;
  if (glyph === "table") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>;
  return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z"/></svg>;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-5 w-5 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8.5 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function FailureIcon() {
  return <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" /></svg>;
}
