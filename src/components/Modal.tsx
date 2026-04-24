import { useEffect } from "react";

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
}

export function Modal({ open, onClose, children, width = "max-w-2xl" }: Props) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />
      <div
        className={`relative bg-bg-card border border-border rounded-lg shadow-lg ${width} w-full mx-4 overflow-hidden flex flex-col max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
