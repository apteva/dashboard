import { AppIcon } from "@apteva/ui-kit";
import { ToolGlyphIcon } from "./chat/ToolGlyphIcon";
import type { ToolVisual } from "./chat/toolVisuals";

/** Uses the same source identities and fallback glyphs as conversation tools. */
export function AgentToolIcon({ visual, status }: {
  visual: ToolVisual;
  status?: "running" | "success" | "error" | "info";
}) {
  const state = status === "running" ? "In progress" : status === "success" ? "Finished" : status === "error" ? "Failed" : "";
  return <span aria-hidden="true" title={[visual.label, state].filter(Boolean).join(" · ")}
    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-bg-card text-accent ${status === "error" ? "border-error/60" : "border-border"}`}>
    <span className={`inline-flex items-center justify-center ${status === "running" ? "motion-safe:animate-pulse" : ""}`}>
      {visual.iconUrl && /^(https?:|data:|\/)/.test(visual.iconUrl)
      ? <AppIcon src={visual.iconUrl} iconStyle={visual.iconStyle} name={visual.label} size="sm" framed={false} className="text-accent" />
      : <ToolGlyphIcon glyph={visual.glyph} />}
    </span>
  </span>;
}
