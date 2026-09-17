import { useId, type CSSProperties } from "react";
import { proactivityDescription, proactivityLabel } from "../agentBehavior";

export function ProactivityControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-xs font-bold uppercase tracking-wide text-text-muted">Proactivity</label>
        <span className="text-xs text-text">{value}% · {proactivityLabel(value)}</span>
      </div>
      <input id={id} type="range" min={0} max={100} step={1} value={value}
        aria-valuetext={`${value}% ${proactivityLabel(value)}`} aria-describedby={`${id}-description`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ "--range-fill": `${Math.min(100, Math.max(0, value))}%` } as CSSProperties}
        className="touch-target block w-full" />
      <div className="flex justify-between text-[11px] text-text-muted"><span>0 · Reactive</span><span>100 · Highly proactive</span></div>
      <p id={`${id}-description`} className="text-xs leading-relaxed text-text-muted">{proactivityDescription(value)}</p>
      <p className="text-xs leading-relaxed text-text-muted">Agent-wide initiative toward standing goals, across all capabilities—even when you are away. Independent of conversations and apps. Safety mode and permissions still govern which actions need approval. Default: 25% Conservative.</p>
    </div>
  );
}
