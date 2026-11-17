import type { ReactNode } from "react";

import type { SecuritySeverity } from "../../../api";

export const inputClass = "w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none";
export const buttonClass = "rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50";
export const primaryButtonClass = "rounded-lg bg-accent px-4 py-2 text-xs font-bold text-bg transition-colors hover:bg-accent-hover disabled:opacity-50";
export const dangerButtonClass = "rounded-lg border border-red px-4 py-2 text-xs font-bold text-red transition-colors hover:bg-red/10 disabled:opacity-50";

const SEVERITY_STYLE: Record<string, string> = {
  critical: "border-red/40 bg-red/10 text-red",
  warning: "border-yellow/40 bg-yellow/10 text-yellow",
  notice: "border-blue/40 bg-blue/10 text-blue",
  info: "border-border text-text-dim",
};

export function SeverityBadge({ severity }: { severity: SecuritySeverity | string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[severity] || SEVERITY_STYLE.info}`}>
      {severity}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  good: "border-green/35 bg-green/10 text-green",
  bad: "border-red/40 bg-red/10 text-red",
  warn: "border-yellow/40 bg-yellow/10 text-yellow",
  neutral: "border-border text-text-dim",
};

export function StatusPill({ tone, children }: { tone: keyof typeof STATUS_STYLE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text">{title}</h3>
          {description && <p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

export function ErrorNote({ error }: { error: string }) {
  if (!error) return null;
  return <p className="rounded border border-red/30 bg-red/10 px-3 py-2 text-xs text-red" role="alert">{error}</p>;
}

export function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value.includes("T") || value.endsWith("Z") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function errorText(err: unknown): string {
  const e = err as { message?: string } | null;
  return e?.message || String(err);
}

export function ShieldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.2-2.9 7.8-7 9-4.1-1.2-7-4.8-7-9V6l7-3z" />
    </svg>
  );
}
