import { useState, useRef, useEffect } from "react";
import { instances } from "../api";
import type { Thread } from "../api";

interface InjectPanelProps {
  instanceId: number;
  threads: Thread[];
}

// InjectPanel — always-visible one-row form that POSTs directly to
// /api/instances/:id/event, bypassing the conversational chat entirely.
// Whatever you type lands in the target thread's inbox on the next
// think iteration. Intended for debug probes, admin pokes, simulating
// a webhook / channel event, or hand-off messages that don't belong in
// the user-facing chat transcript.
//
// Format sent to the agent: "[<tag>] <message>" when tag is non-empty,
// or bare "<message>" in raw mode. The tag is a free-text label for
// YOUR clarity in the activity log — the agent doesn't know "admin" as
// a special channel, it just sees it as context.
export function InjectPanel({ instanceId, threads }: InjectPanelProps) {
  const [target, setTarget] = useState("main");
  const [tag, setTag] = useState("admin");
  const [message, setMessage] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<{ text: string; time: number } | null>(null);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Decay the "last sent" banner after 5s so the form returns to a
  // clean state without the operator having to dismiss it.
  useEffect(() => {
    if (!lastSent) return;
    const timer = setTimeout(() => setLastSent(null), 5000);
    return () => clearTimeout(timer);
  }, [lastSent]);

  // If the currently selected target disappears (sub-thread terminated),
  // fall back to main rather than sending into the void.
  useEffect(() => {
    if (target === "main") return;
    if (!threads.some((t) => t.id === target)) setTarget("main");
  }, [threads, target]);

  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    const payload = rawMode || !tag.trim() ? text : `[${tag.trim()}] ${text}`;
    try {
      await instances.sendEvent(instanceId, payload, target);
      setLastSent({ text: payload, time: Date.now() });
      setMessage("");
      // Reset textarea height after successful send.
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } catch (err: any) {
      setError(err?.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits (single-line default); Shift+Enter for newline;
    // Cmd/Ctrl+Enter also submits so multi-line messages aren't
    // trapped by Shift's newline behaviour.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  // Thread options: main + any running sub-thread the fleet view knows
  // about. Keep main pinned first; alphabetize the rest so the picker
  // is predictable as threads come and go.
  const subThreads = threads
    .filter((t) => t.id !== "main")
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="shrink-0 border-t border-border bg-bg-card/40">
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex items-center gap-2 px-4 py-2"
      >
        <span
          className="text-text-muted text-[10px] uppercase tracking-wide shrink-0"
          title="Inject a raw event into the agent's inbox — bypasses the chat system."
        >
          Inject →
        </span>

        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          title="Target thread for this event"
          className="shrink-0 bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent max-w-[140px]"
        >
          <option value="main">main</option>
          {subThreads.map((t) => (
            <option key={t.id} value={t.id}>{t.id}</option>
          ))}
        </select>

        {!rawMode && (
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="tag"
            title="Prefix applied to the message as [tag]. Label for operator clarity — the agent has no special handling for it."
            className="shrink-0 w-20 bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
            maxLength={20}
          />
        )}

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            const el = e.target as HTMLTextAreaElement;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 96) + "px";
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={rawMode ? "raw event text (no tag)…" : "type event… (Enter to send, Shift+Enter for newline)"}
          style={{ lineHeight: "18px", minHeight: "28px" }}
          className="flex-1 min-w-0 bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent resize-none"
          disabled={sending}
        />

        <button
          type="button"
          onClick={() => setRawMode(!rawMode)}
          title={rawMode ? "Exit raw mode (re-enable tag prefix)" : "Raw mode — send text exactly as typed, no [tag] prefix"}
          className={`shrink-0 px-2 py-1 rounded text-[10px] uppercase tracking-wide transition-colors ${
            rawMode
              ? "bg-red/20 text-red border border-red/40"
              : "bg-border text-text-muted border border-transparent hover:text-text"
          }`}
        >
          raw
        </button>

        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="shrink-0 px-3 py-1 rounded text-xs font-bold bg-accent text-bg disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:bg-accent-hover transition-colors"
          title="Send event (Enter)"
        >
          {sending ? "…" : "send"}
        </button>
      </form>

      {/* Feedback strip — toasts the last injection so the operator can
          confirm it went through, then decays after 5s. Errors persist
          until cleared (a new successful send replaces them). */}
      {(lastSent || error) && (
        <div className="px-4 pb-2 text-[10px] truncate">
          {error && <span className="text-red">✗ {error}</span>}
          {!error && lastSent && (
            <span className="text-text-dim">
              <span className="text-green">✓</span> sent to <span className="text-text-muted">{target}</span>:{" "}
              <span className="font-mono">{lastSent.text.length > 120 ? lastSent.text.slice(0, 120) + "…" : lastSent.text}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
