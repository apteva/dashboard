import { useState } from "react";

/** Fallback when the Conversations composer is unavailable or rejects insertion. */
export function HelperPromptSuggestion({ text, reason, onDismiss, onRetry }: { text: string; reason?: string; onDismiss: () => void; onRetry?: () => void }) {
  const [status, setStatus] = useState("");
  return <div className="shrink-0 space-y-2 border-b border-border px-3 py-2 text-xs text-text-muted">
    <p role="status">{reason || "Copy this suggestion and paste it into the conversation."}</p>
    <textarea aria-label="Suggested message" readOnly value={text} rows={2} className="w-full resize-none rounded border border-border bg-bg-input p-2 text-xs" />
    <div className="flex flex-wrap items-center gap-3">
      {onRetry && <button type="button" className="min-h-9 text-accent" onClick={onRetry}>Try inserting again</button>}
      <button type="button" className="min-h-9 text-accent" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setStatus("Copied"); }
        catch { setStatus("Select the text above to copy it manually."); }
      }}>Copy suggestion</button>
      <button type="button" className="min-h-9" onClick={onDismiss}>Dismiss</button>
      <span role="status">{status}</span>
    </div>
  </div>;
}
