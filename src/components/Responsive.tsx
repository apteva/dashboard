import type { ReactNode } from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

interface PageShellProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  maxWidth?: string;
}

/** Standard page scroll container with mobile-first padding and safe areas. */
export function PageShell({
  children,
  className,
  contentClassName,
  maxWidth = "max-w-7xl",
}: PageShellProps) {
  return (
    <div className={classes("h-full overflow-y-auto overscroll-contain scroll-safe-bottom", className)}>
      <div className={classes("page-safe-bottom mx-auto w-full px-4 py-4 sm:px-6 sm:py-6", maxWidth, contentClassName)}>
        {children}
      </div>
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Header whose actions wrap below the title instead of overflowing phones. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={classes("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-text sm:text-2xl">{title}</h1>
        {description && <div className="mt-1 text-sm text-text-muted">{description}</div>}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}

interface ResponsiveTabsProps {
  children: ReactNode;
  className?: string;
  label?: string;
}

/** Horizontally scrollable tab rail with edge-to-edge room on phones. */
export function ResponsiveTabs({ children, className, label = "Sections" }: ResponsiveTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={classes(
        "-mx-4 flex max-w-[calc(100%+2rem)] snap-x snap-mandatory gap-1 overflow-x-auto px-4 py-1 sm:mx-0 sm:max-w-full sm:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface MobileActionMenuProps {
  children: ReactNode;
  className?: string;
}

/** Layout primitive for action groups; callers can add an overflow menu later. */
export function MobileActionMenu({ children, className }: MobileActionMenuProps) {
  return (
    <div className={classes("flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end", className)}>
      {children}
    </div>
  );
}
