import { useRef, useState } from "react";
import { apps, type AppRow } from "../../api";

type Status = "running" | "disabled";

/** The same reversible status action in installed rows, cards, and details. */
export function AppStatusAction({ app, disabled, className, onChanged, onBusyChange }: {
  app: AppRow;
  disabled?: boolean;
  className?: string;
  onChanged?: (status: Status) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  if (app.source === "builtin" || app.source === "integration" || app.install_id <= 0 ||
    (app.status !== "running" && app.status !== "disabled")) return null;
  const enable = app.status === "disabled";
  const changeStatus = async () => {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const status = enable ? "running" : "disabled";
      await apps.setStatus(app.install_id, status);
      window.dispatchEvent(new Event("apteva:apps-changed"));
      onChanged?.(status);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Could not ${enable ? "enable" : "disable"} app.`);
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return <div className="min-w-0">
    <button type="button" disabled={busy || disabled} onClick={() => void changeStatus()}
      className={`${className || "min-h-10 rounded border border-border px-3 py-2 text-xs text-text-muted hover:border-accent hover:text-accent"} disabled:cursor-wait disabled:opacity-50`}>
      {busy ? enable ? "Enabling…" : "Disabling…" : enable ? "Enable" : "Disable"}
    </button>
    {error && <p role="alert" className="mt-2 max-w-64 break-words text-xs text-red">{error}</p>}
  </div>;
}
