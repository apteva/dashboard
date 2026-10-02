import type { ReactNode } from "react";

export function PickerOption({
  selected,
  disabled,
  onToggle,
  name,
  description,
  badge,
  icon,
}: {
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
  name: string;
  description: string;
  badge?: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent enabled:hover:border-accent/60 enabled:active:bg-accent/15 disabled:cursor-not-allowed ${selected ? "border-accent/50 bg-accent/5 enabled:hover:bg-accent/10" : "border-transparent enabled:hover:bg-bg-hover"}`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text">{name}</span>
        <span className="mt-1 line-clamp-2 text-xs text-text-muted">
          {description}
        </span>
        {badge && (
          <span className="mt-1 block text-[10px] text-accent">{badge}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${selected ? "border-accent bg-accent text-bg" : "border-border"}`}
      >
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}
