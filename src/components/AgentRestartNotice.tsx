import { useState } from "react";
import { instances, type Agent } from "../api";
import { restartNeededMessage, type ProviderSaveNotice } from "../utils/providerRestart";

/** A running agent that can't use its saved provider credentials until it restarts. */
export function AgentRestartNotice({ agent, onRestarted }: { agent: Agent; onRestarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const message = restartNeededMessage(agent);
  if (!message) return null;

  const restart = async () => {
    setBusy(true);
    setError("");
    try {
      await instances.restart(agent.id);
      onRestarted();
    } catch (err: any) {
      setError(err?.message || "Restart failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-yellow/30 bg-yellow/10 px-4 py-2 text-xs">
      <span className="font-bold text-yellow">Restart needed</span>
      <span className="text-text-muted" title={agent.provider_unavailable?.reason}>{message}</span>
      {error && <span className="text-red">{error}</span>}
      <button
        type="button"
        onClick={restart}
        disabled={busy}
        className="ml-auto rounded border border-yellow/40 px-2 py-1 font-bold text-yellow hover:bg-yellow/10 disabled:opacity-50"
      >
        {busy ? "Restarting…" : "Restart"}
      </button>
    </div>
  );
}

/** The outcome of a provider change that restarted the agent, until dismissed. */
export function ProviderSaveNoticeBar({ notice, onDismiss }: { notice: ProviderSaveNotice | null; onDismiss: () => void }) {
  if (!notice) return null;
  const error = notice.tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex items-center gap-3 border-b px-4 py-2 text-xs ${error ? "border-red/30 bg-red/10 text-red" : "border-green/30 bg-green/10 text-green"}`}
    >
      <span>{notice.message}</span>
      <button type="button" onClick={onDismiss} className="ml-auto text-text-muted hover:text-text">
        Dismiss
      </button>
    </div>
  );
}
