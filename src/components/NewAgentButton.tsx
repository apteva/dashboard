import type { MouseEventHandler } from "react";
import { Link } from "react-router-dom";

export function NewAgentButton({
  label = "New Agent",
  title,
  className = "",
  iconOnly = false,
  onClick,
  to = "/agents/new",
}: {
  label?: string;
  title?: string;
  className?: string;
  iconOnly?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  to?: string;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-accent text-sm font-bold text-bg transition-colors hover:bg-accent-hover ${iconOnly ? "h-10 w-10 p-0" : "px-3 py-2"} ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
      <span className={iconOnly ? "sr-only" : undefined}>{label}</span>
    </Link>
  );
}
