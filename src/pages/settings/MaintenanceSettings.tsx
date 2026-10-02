import { useState } from "react";

import { telemetry } from "../../api";

import { Modal } from "../../components/Modal";

export function DataTab() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wiped, setWiped] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const handleWipe = async () => {
    setBusy(true); setError("");
    try {
      const result = await telemetry.wipe();
      setCount(result.deleted); setShowConfirm(false); setWiped(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not clear telemetry."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">Telemetry cleanup</h2>
        <p className="text-text-muted text-sm mt-1">
          Manage telemetry and event data stored by the system.
        </p>
      </div>

      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <h3 className="text-text text-sm font-bold mb-2">Telemetry</h3>
        <p className="text-text-muted text-sm mb-4">
          Clear all stored telemetry events (LLM calls, thread activity, tool usage).
          This does not affect running instances.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfirm(true)}
            className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
          >
            Wipe Telemetry
          </button>
          {wiped && (
            <span className="text-green text-sm">
              Deleted {count} events
            </span>
          )}
        </div>
      </div>

      <Modal open={showConfirm} onClose={() => { if (!busy) setShowConfirm(false); }}>
        <div className="p-6">
          <h3 className="text-text text-base font-bold mb-2">Wipe telemetry data?</h3>
          <p className="text-text-muted text-sm mb-6">
            This will permanently delete all stored telemetry events including LLM call history,
            thread activity, and tool usage data. This action cannot be undone.
          </p>
          {error && <p role="alert" className="mb-3 text-sm text-error">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              disabled={busy}
              onClick={() => setShowConfirm(false)}
              className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={handleWipe}
              className="px-4 py-2.5 bg-red rounded-lg text-sm text-white font-bold hover:opacity-90 transition-colors"
            >
              {busy ? "Clearing…" : "Clear telemetry"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
