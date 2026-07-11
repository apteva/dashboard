import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Tailwind width class(es) for the inner panel. Default is
   * `max-w-2xl` (~672px) which matches the original hard-coded
   * value. Pass `max-w-4xl` or `max-w-5xl` for wider flows like
   * the suite matrix.
   */
  width?: string;
  ariaLabel?: string;
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function hasFinePointer() {
  return typeof window !== "undefined"
    && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function Modal({ open, onClose, children, width = "max-w-2xl", ariaLabel = "Dialog" }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        e.preventDefault();
        panelRef.current.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Avoid opening the software keyboard just because a sheet appeared.
      // Desktop keyboard users still land on the first useful control.
      const target = hasFinePointer()
        ? panel.querySelector<HTMLElement>("[autofocus], " + focusableSelector)
        : panel;
      target?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-safe-frame"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`modal-safe-panel relative bg-bg-card border border-border rounded-t-lg sm:rounded-lg shadow-lg ${width} w-full overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
