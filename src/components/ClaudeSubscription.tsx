import { useCallback, useEffect, useRef, useState } from "react";
import {
  claudeSubscription,
  type ClaudeSubscriptionProcess,
  type ClaudeSubscriptionSettings,
  type ClaudeSubscriptionStatus,
} from "../api";

/** Polls the server's Claude CLI status while the page is visible. */
export function useClaudeSubscriptionStatus(pollMs: number) {
  const [status, setStatus] = useState<ClaudeSubscriptionStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const live = useRef(true);

  const refresh = useCallback(async (force = false) => {
    try {
      const next = await claudeSubscription.status(force);
      if (!live.current) return;
      setStatus(next);
      setError("");
    } catch (err: any) {
      if (live.current) setError(err?.message || "Could not read the Claude status");
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void refresh(true);
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(tick, pollMs);
    return () => {
      live.current = false;
      window.clearInterval(interval);
    };
  }, [pollMs, refresh]);

  return { status, error, loading, refresh, setStatus };
}

const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";

function planLabel(subscription?: string): string {
  if (!subscription) return "Claude plan";
  return `${subscription.charAt(0).toUpperCase()}${subscription.slice(1)} plan`;
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-green">
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-yellow">
      <path d="M12 4 2.5 20h19L12 4Z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-bg-hover px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-text">{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="shrink-0 text-xs text-text-muted hover:text-accent"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Account line shared by the connect dialog and the provider card. */
function SignInState({ status }: { status: ClaudeSubscriptionStatus }) {
  if (!status.installed) {
    return (
      <div className="flex items-start gap-2 text-sm text-text">
        <AlertIcon />
        <span>Claude Code isn't installed on the computer running Apteva.</span>
      </div>
    );
  }
  const auth = status.auth;
  if (auth?.subscription) {
    return (
      <div className="flex items-start gap-2 text-sm text-text">
        <CheckIcon />
        <span>
          Signed in with your Claude account · {planLabel(auth.subscription_type)}
          {status.version && <span className="block text-xs text-text-muted">{status.version}</span>}
        </span>
      </div>
    );
  }
  if (auth?.logged_in) {
    return (
      <div className="flex items-start gap-2 text-sm text-text">
        <AlertIcon />
        <span>
          Claude Code is signed in with {auth.auth_method || "another method"}, not a Claude plan. Sign out and sign in again
          with your Claude account to use your plan.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm text-text">
      <AlertIcon />
      <span>Claude Code is installed{status.version ? ` (${status.version})` : ""} but not signed in.</span>
    </div>
  );
}

/** Steps to install and sign in to the Claude CLI on the server machine.
 *  Sign-in always happens in Claude's own command and on Anthropic's page;
 *  Apteva only checks the result. */
function SignInSteps({ status, onChanged }: { status: ClaudeSubscriptionStatus; onChanged: () => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const runAs = status.server_user ? ` as ${status.server_user}` : "";

  if (!status.installed) {
    return (
      <div className="space-y-2 text-xs text-text-muted">
        <p>Install it in a terminal on that computer{runAs}, then check again:</p>
        <CopyCommand command={INSTALL_COMMAND} />
      </div>
    );
  }
  if (status.auth?.subscription) return null;

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      await claudeSubscription.login();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Could not start sign-in");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-3 text-xs text-text-muted">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting || status.login.running}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-60"
        >
          {status.login.running ? "Waiting for sign-in…" : starting ? "Opening…" : "Open Claude sign-in"}
        </button>
        {status.login.running ? (
          <p>
            A sign-in page opened in the browser on the computer running Apteva. Finish signing in there; this page updates by
            itself.
          </p>
        ) : (
          <p>Opens Anthropic's sign-in page in a browser on the computer running Apteva.</p>
        )}
        {status.login.last_error && !status.login.running && (
          <p className="text-red">The last sign-in did not finish: {status.login.last_error}</p>
        )}
        {error && <p className="text-red">{error}</p>}
      </div>
      <div className="space-y-2">
        <p>If Apteva runs on another machine, or no page opened, run this in a terminal there{runAs}:</p>
        <CopyCommand command={status.sign_in_command} />
      </div>
    </div>
  );
}

/** Shown in the Add-provider dialog before connecting. */
export function ClaudeSignInHelper({ onReadyChange }: { onReadyChange?: (ready: boolean) => void }) {
  const { status, error, loading, refresh } = useClaudeSubscriptionStatus(3000);
  const ready = !!status?.installed && !!status?.auth?.subscription;
  useEffect(() => onReadyChange?.(ready), [ready, onReadyChange]);

  return (
    <div className="space-y-3 rounded-lg border border-border p-4" aria-live="polite">
      {loading && !status ? (
        <p className="text-sm text-text-muted">Checking Claude Code on the computer running Apteva…</p>
      ) : status ? (
        <>
          <SignInState status={status} />
          <SignInSteps status={status} onChanged={() => void refresh(true)} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-text-dim">Apteva never sees or stores your Claude sign-in.</p>
            <button type="button" onClick={() => void refresh(true)} className="shrink-0 text-xs text-text-muted hover:text-accent">
              Check again
            </button>
          </div>
        </>
      ) : null}
      {error && <p className="text-sm text-red">{error}</p>}
    </div>
  );
}

const STATE_LABELS: Record<string, string> = {
  new: "Starting",
  starting: "Starting",
  replying: "Replying",
  waiting_tool: "Waiting for tools",
  waiting_slot: "Waiting for a process",
  finishing: "Finishing",
  idle: "Idle",
};

function shortDuration(since: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function megabytes(kb?: number): string {
  if (!kb) return "--";
  return `${Math.round(kb / 1024)} MB`;
}

function ProcessRow({ proc }: { proc: ClaudeSubscriptionProcess }) {
  const state = STATE_LABELS[proc.state] || proc.state;
  const busy = proc.state !== "idle";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_4.5rem_4rem]">
      <span className="min-w-0 truncate text-xs text-text" title={proc.owner}>
        {proc.owner_label || proc.owner}
        {proc.model && <span className="text-text-dim"> · {proc.model}</span>}
      </span>
      <span className="min-w-0 truncate text-xs text-text-muted sm:order-none">
        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${busy ? "bg-accent" : "bg-text-dim"}`} />
        {state}
        {proc.detail ? `: ${proc.detail}` : ""}
        <span className="text-text-dim"> · {shortDuration(proc.since)}</span>
      </span>
      <span className="text-xs tabular-nums text-text-muted">{megabytes(proc.rss_kb)}</span>
      <span className="text-right text-xs tabular-nums text-text-dim">
        {proc.turns} turn{proc.turns === 1 ? "" : "s"}
      </span>
    </li>
  );
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-2 text-xs text-text">
        {label}
        <span className="ml-auto flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            value={Number.isFinite(value) ? value : ""}
            onChange={(event) => onChange(parseInt(event.target.value, 10))}
            className="w-20 rounded border border-border bg-transparent px-2 py-1 text-right text-xs tabular-nums text-text focus:border-accent focus:outline-none"
          />
          {suffix && <span className="w-3 text-text-dim">{suffix}</span>}
        </span>
      </span>
      <span className="block text-[11px] text-text-dim">{hint}</span>
    </label>
  );
}

/** Provider-card section: sign-in state, the process pool and its settings. */
export function ClaudeSubscriptionPoolSection() {
  const { status, error, loading, refresh } = useClaudeSubscriptionStatus(5000);
  const [draft, setDraft] = useState<ClaudeSubscriptionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (status && !draft) setDraft(status.settings);
  }, [status, draft]);

  if (loading && !status) {
    return <p className="text-xs text-text-muted">Checking Claude Code…</p>;
  }
  if (!status) {
    return <p className="text-xs text-red">{error || "Could not read the Claude status"}</p>;
  }

  const pool = status.pool;
  const dirty =
    !!draft &&
    (draft.pool_size !== status.settings.pool_size ||
      draft.idle_seconds !== status.settings.idle_seconds ||
      draft.queue_seconds !== status.settings.queue_seconds);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setActionError("");
    setSaveMessage("");
    try {
      const result = await claudeSubscription.updateSettings(draft);
      setDraft(result.settings);
      setSaveMessage("Saved");
      await refresh();
    } catch (err: any) {
      setActionError(err?.message || "Could not save the pool settings");
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setActionError("");
    try {
      await claudeSubscription.logout();
      setConfirmSignOut(false);
      await refresh(true);
    } catch (err: any) {
      setActionError(err?.message || "Could not sign out");
    }
  };

  return (
    <div className="space-y-4">
      {!status.available && status.unavailable_reason && (
        <p role="alert" className="text-xs text-red">
          {status.unavailable_reason}
        </p>
      )}
      <div className="space-y-3">
        <SignInState status={status} />
        <SignInSteps status={status} onChanged={() => void refresh(true)} />
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => void refresh(true)} className="text-xs text-text-muted hover:text-accent">
            Check status
          </button>
          {status.auth?.logged_in && !confirmSignOut && (
            <button type="button" onClick={() => setConfirmSignOut(true)} className="text-xs text-text-muted hover:text-red">
              Sign out of Claude
            </button>
          )}
        </div>
        {confirmSignOut && (
          <div role="alertdialog" aria-label="Sign out of Claude" className="space-y-2 rounded border border-border p-3">
            <p className="text-xs text-text">
              This signs Claude Code out on the computer running Apteva, including for anything else that uses it there. Agents on
              this provider stop until you sign in again.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => void signOut()} className="text-xs font-semibold text-red hover:underline">
                Sign out
              </button>
              <button type="button" onClick={() => setConfirmSignOut(false)} className="text-xs text-text-muted hover:text-text">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {pool && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-xs font-semibold text-text">Process pool</h4>
            <span className="text-[11px] text-text-dim">
              {pool.sessions} conversation{pool.sessions === 1 ? "" : "s"} kept
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Running", `${pool.running} of ${pool.max_processes}`],
              ["Busy", String(pool.busy)],
              ["Queued", String(pool.waiting)],
              ["Memory", megabytes(pool.rss_kb)],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-border px-3 py-2">
                <dt className="text-[11px] text-text-dim">{label}</dt>
                <dd className="text-sm tabular-nums text-text">{value}</dd>
              </div>
            ))}
          </dl>
          {pool.processes.length > 0 ? (
            <ul className="divide-y divide-border rounded border border-border" aria-label="Claude processes">
              {pool.processes.map((proc) => (
                <ProcessRow key={`${proc.pid}-${proc.session}`} proc={proc} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">
              No Claude processes running. One starts when an agent thinks and closes after {pool.idle_seconds}s without a turn.
            </p>
          )}
          {pool.waiting > 0 && (
            <p className="text-xs text-yellow">
              {pool.waiting} turn{pool.waiting === 1 ? " is" : "s are"} waiting for a free process. Raise the pool size if this
              happens often.
            </p>
          )}
        </div>
      )}

      {draft && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-text">Pool settings</h4>
          <NumberSetting
            label="Pool size"
            hint="Most Claude processes running at once. Each one uses about 200–300 MB of memory."
            value={draft.pool_size}
            min={1}
            max={16}
            onChange={(pool_size) => setDraft({ ...draft, pool_size })}
          />
          <NumberSetting
            label="Idle timeout"
            hint="Close a process after this long without a turn. Its conversation reopens when needed."
            value={draft.idle_seconds}
            min={10}
            max={3600}
            suffix="s"
            onChange={(idle_seconds) => setDraft({ ...draft, idle_seconds })}
          />
          <NumberSetting
            label="Queue wait"
            hint="How long a turn waits for a free process before it fails and the agent retries."
            value={draft.queue_seconds}
            min={5}
            max={150}
            suffix="s"
            onChange={(queue_seconds) => setDraft({ ...draft, queue_seconds })}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="rounded border border-border px-3 py-1.5 text-xs text-text hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save pool settings"}
            </button>
            {dirty && (
              <button type="button" onClick={() => setDraft(status.settings)} className="text-xs text-text-muted hover:text-text">
                Reset
              </button>
            )}
            <span role="status" className="text-xs text-accent">
              {!dirty && saveMessage}
            </span>
          </div>
        </div>
      )}
      {(actionError || error) && <p className="text-xs text-red">{actionError || error}</p>}
    </div>
  );
}
