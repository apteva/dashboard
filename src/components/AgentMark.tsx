import { useId, useState } from "react";
import { AgentMark, AGENT_ICONS, suggestedAgentIcon, type AgentIconId } from "@apteva/ui-kit";
export { AgentMark, AGENT_ICONS, AGENT_ICON_COLORS, suggestedAgentIcon } from "@apteva/ui-kit";
export type { AgentIconId, AgentIconColor } from "@apteva/ui-kit";

export function AgentIconPicker({ icon, onIconChange, compact = false }: {
  icon: string;
  onIconChange: (icon: AgentIconId) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(!compact);
  const optionsId = useId();
  const selectedIcon = suggestedAgentIcon(icon);
  const selectedLabel = AGENT_ICONS.find((option) => option.id === selectedIcon)?.label || "Generic";
  return <div>
    {compact ? <button type="button" onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded} aria-controls={optionsId}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-bg-input px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent">
      <AgentMark icon={selectedIcon} size="sm" />
      <span className="min-w-0 flex-1"><span className="block text-xs text-text-muted">Icon</span><span className="block text-sm font-medium text-text">{selectedLabel}</span></span>
      <span className="text-xs font-medium text-accent">{expanded ? "Done" : "Change"}</span>
    </button> : <div className="mb-2 text-xs font-semibold text-text-muted">Icon <span className="font-normal text-text-dim">· {AGENT_ICONS.length} choices</span></div>}
    {expanded && <div id={optionsId} role="group" aria-label="Agent icon"
      className={`grid max-h-64 grid-cols-2 gap-2 overflow-y-auto overscroll-contain pr-1 ${compact ? "mt-2" : ""}`}>
      {AGENT_ICONS.map((option) => <button key={option.id} type="button"
        onClick={() => { onIconChange(option.id); if (compact) setExpanded(false); }}
        aria-label={option.label} aria-pressed={selectedIcon === option.id}
        className={`flex min-h-16 min-w-0 items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${selectedIcon === option.id ? "border-accent bg-bg-hover" : "border-border hover:border-text-dim hover:bg-bg-hover"}`}>
        <AgentMark icon={option.id} />
        <span className="min-w-0 truncate text-xs text-text-muted">{option.label}</span>
      </button>)}
    </div>}
  </div>;
}
