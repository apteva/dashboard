import { useCallback, useEffect, useRef, useState } from "react";
import {
  claudeSubscription,
  integrations,
  type ClaudeSubscriptionProcess,
  type ClaudeSubscriptionSettings,
  type ClaudeSubscriptionStatus,
  type ModelInfo,
  type RuntimeConnection,
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
    return () => {
      live.current = false;
    };
  }, [refresh]);

  // Poll faster while a sign-in runs, so its link and result show promptly.
  const signingIn = !!status?.login.running;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(tick, signingIn ? Math.min(pollMs, 2000) : pollMs);
    return () => window.clearInterval(interval);
  }, [pollMs, refresh, signingIn]);

  return { status, error, loading, refresh, setStatus };
}

const INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";

/** The claude command's version without its "(Claude Code)" suffix. */
export function cliVersion(version?: string): string {
  return (version || "").replace(/\s*\(Claude Code\)\s*$/i, "").trim();
}

function ClaudeCommand() {
  return <code className="font-mono text-[0.95em]">claude</code>;
}

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
        <span>
          The <ClaudeCommand /> command isn't installed on the computer running Apteva.
        </span>
      </div>
    );
  }
  const auth = status.auth;
  const version = cliVersion(status.version);
  if (auth?.subscription) {
    return (
      <div className="flex items-start gap-2 text-sm text-text">
        <CheckIcon />
        <span>
          Signed in with your Claude account · {planLabel(auth.subscription_type)}
          {version && <span className="block text-xs text-text-muted">claude {version}</span>}
        </span>
      </div>
    );
  }
  if (auth?.logged_in) {
    return (
      <div className="flex items-start gap-2 text-sm text-text">
        <AlertIcon />
        <span>
          The <ClaudeCommand /> command is signed in with {auth.auth_method || "another method"}, not a Claude plan. Sign out
          and sign in again with your Claude account to use your plan.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm text-text">
      <AlertIcon />
      <span>
        The <ClaudeCommand /> command is installed{version ? ` (${version})` : ""} but not signed in.
      </span>
    </div>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />;
}

const codeErrors: Record<string, string> = {
  invalid_code: "That doesn't look like the code from Anthropic's page. Copy the whole code and paste it again.",
  not_running: "This sign-in has ended. Start again.",
  code_submitted: "A code was already sent for this sign-in.",
};

/** Steps to install and sign in to Claude Code on the computer running
 *  Apteva. Sign-in runs in Claude Code's own command: the user approves on
 *  Anthropic's page and pastes the code it shows, which Apteva passes on to
 *  Claude Code without keeping it. */
function SignInSteps({ status, onChanged }: { status: ClaudeSubscriptionStatus; onChanged: () => void }) {
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const runAs = status.server_user ? ` as ${status.server_user}` : "";
  const login = status.login;

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
    setCode("");
    try {
      await claudeSubscription.login();
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Could not start sign-in");
    } finally {
      setStarting(false);
    }
  };

  // Not a <form>: these steps render inside the Connect provider form.
  const submit = async () => {
    const value = code.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await claudeSubscription.submitCode(value);
      setCode("");
      onChanged();
    } catch (err: any) {
      setError(codeErrors[err?.message] || err?.message || "Could not send the code");
      if (err?.message !== "invalid_code") onChanged();
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    setError("");
    setCode("");
    try {
      await claudeSubscription.cancelLogin();
    } catch (err: any) {
      setError(err?.message || "Could not cancel the sign-in");
    }
    onChanged();
  };

  return (
    <div className="space-y-3 text-xs text-text-muted">
      {!login.running ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-60"
          >
            {starting ? "Starting…" : login.last_error ? "Try again" : "Sign in with Claude"}
          </button>
          <p>You approve the sign-in on Anthropic's page, then paste the code it shows here.</p>
          {login.last_error && <p className="text-red">The last sign-in did not finish: {login.last_error}</p>}
        </div>
      ) : login.code_submitted ? (
        <p role="status" className="flex items-center gap-2 text-text">
          <Spinner />
          Checking the code…
        </p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="font-medium text-text">1. Approve the sign-in on Anthropic's page</p>
            {login.url ? (
              <a
                href={login.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-lg bg-accent px-3 py-2 text-xs font-bold text-bg hover:bg-accent-hover"
              >
                Open sign-in page
              </a>
            ) : (
              <p role="status" className="flex items-center gap-2">
                <Spinner />
                Starting sign-in…
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="claude-sign-in-code" className="block font-medium text-text">
              2. Paste the code shown after you approve
            </label>
            <div className="flex gap-2">
              <input
                id="claude-sign-in-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
                disabled={submitting}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-xs text-text"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting || !code.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Continue"}
              </button>
            </div>
          </div>
          <button type="button" onClick={() => void cancel()} className="text-xs text-text-muted hover:text-accent">
            Cancel sign-in
          </button>
        </div>
      )}
      {error && <p className="text-red">{error}</p>}
      <details className="space-y-2">
        <summary className="cursor-pointer hover:text-accent">Prefer a terminal?</summary>
        <p className="pt-2">Run this in a terminal on the computer running Apteva{runAs}:</p>
        <CopyCommand command={status.sign_in_command} />
      </details>
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
        <p className="text-sm text-text-muted">Checking the Claude sign-in on the computer running Apteva…</p>
      ) : status ? (
        <>
          <SignInState status={status} />
          <SignInSteps status={status} onChanged={() => void refresh(true)} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-text-dim">Your Claude sign-in stays on that computer; Apteva never stores it.</p>
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

type ProcessTone = "generating" | "waiting" | "idle";

/** What a process is doing, in words, and whether it is generating. */
export function processActivity(proc: Pick<ClaudeSubscriptionProcess, "state" | "detail">): { label: string; tone: ProcessTone } {
  switch (proc.state) {
    case "starting":
      return { label: "Starting", tone: "generating" };
    case "replying":
      return { label: "Generating", tone: "generating" };
    case "finishing":
      return { label: "Finishing", tone: "generating" };
    case "waiting_tool":
      return { label: proc.detail ? `Waiting on ${proc.detail}` : "Waiting on a tool", tone: "waiting" };
    case "idle":
      return { label: "Idle", tone: "idle" };
    default:
      return { label: proc.state, tone: "idle" };
  }
}

/** Generating and waiting counts, from the server or, on servers that
 *  don't report them, from the process list. */
export function poolActivity(pool: NonNullable<ClaudeSubscriptionStatus["pool"]>): { generating: number; waiting: number } {
  const tones = pool.processes.map((proc) => processActivity(proc).tone);
  return {
    generating: pool.generating ?? tones.filter((tone) => tone === "generating").length,
    waiting: pool.waiting_tool ?? tones.filter((tone) => tone === "waiting").length,
  };
}

/** "for 45 s", "for 7 min", "for 2 h 5 min". */
export function forDuration(since: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return `for ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `for ${minutes} min`;
  const rest = minutes % 60;
  return `for ${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

function megabytes(kb?: number): string {
  if (!kb) return "--";
  return `${Math.round(kb / 1024)} MB`;
}

const TONE_DOT: Record<ProcessTone, string> = {
  generating: "bg-accent",
  waiting: "bg-text-muted",
  idle: "bg-text-dim",
};

function ProcessRow({ proc }: { proc: ClaudeSubscriptionProcess }) {
  const activity = processActivity(proc);
  const duration = forDuration(proc.since);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_4.5rem_4rem]">
      <span className="min-w-0 truncate text-xs text-text" title={proc.owner}>
        {proc.owner_label || proc.owner}
        {proc.model && <span className="text-text-dim"> · {proc.model}</span>}
      </span>
      <span className="min-w-0 truncate text-xs text-text-muted sm:order-none" title={activity.label}>
        <span
          aria-hidden="true"
          data-tone={activity.tone}
          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${TONE_DOT[activity.tone]}`}
        />
        <span className={activity.tone === "generating" ? "text-text" : undefined}>{activity.label}</span>
        {duration && <span className="text-text-dim"> {duration}</span>}
      </span>
      <span className="text-xs tabular-nums text-text-muted">{megabytes(proc.memory_kb)}</span>
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

function PoolSummary({ pool }: { pool: NonNullable<ClaudeSubscriptionStatus["pool"]> }) {
  const activity = poolActivity(pool);
  const tiles: Array<{ label: string; value: string; hint?: string; alert?: boolean }> = [
    { label: "Processes", value: `${pool.running} of ${pool.max_processes}` },
    { label: "Generating", value: String(activity.generating), hint: "Processes writing a reply now." },
    {
      label: "Waiting",
      value: String(activity.waiting),
      hint: "Processes waiting for their agent to run a tool, such as pace between turns. They keep their place in the pool but generate nothing while they wait.",
    },
    {
      label: "Queued",
      value: String(pool.waiting),
      hint: "Turns waiting for a free process.",
      alert: pool.waiting > 0,
    },
    { label: "Memory", value: megabytes(pool.memory_kb) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          title={tile.hint}
          className={`rounded border px-3 py-2 ${tile.alert ? "border-yellow/50 bg-yellow/10" : "border-border"}`}
        >
          <dt className="text-[11px] text-text-dim">{tile.label}</dt>
          <dd className={`text-sm tabular-nums ${tile.alert ? "font-semibold text-yellow" : "text-text"}`}>{tile.value}</dd>
        </div>
      ))}
    </dl>
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
    return <p className="text-xs text-text-muted">Checking the Claude subscription…</p>;
  }
  if (!status) {
    return <p className="text-xs text-red">{error || "Could not read the Claude status"}</p>;
  }

  const pool = status.pool;
  const dirty =
    !!draft &&
    (draft.pool_size !== status.settings.pool_size ||
      draft.idle_seconds !== status.settings.idle_seconds ||
      draft.queue_seconds !== status.settings.queue_seconds ||
      !!draft.hold_sleeping !== !!status.settings.hold_sleeping);

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
              This signs the <ClaudeCommand /> command out on the computer running Apteva, including for anything else that uses
              it there. Agents on this provider stop until you sign in again.
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
          <PoolSummary pool={pool} />
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
            hint="Close a process after this long without a turn, or after its agent has slept this long. Its conversation reopens when needed."
            value={draft.idle_seconds}
            min={10}
            max={3600}
            suffix="s"
            onChange={(idle_seconds) => setDraft({ ...draft, idle_seconds })}
          />
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!!draft.hold_sleeping}
              onChange={(event) => setDraft({ ...draft, hold_sleeping: event.target.checked })}
              className="mt-0.5 shrink-0 accent-accent"
            />
            <span className="space-y-1">
              <span className="block text-xs text-text">Keep processes for sleeping agents</span>
              <span className="block text-[11px] text-text-dim">
                A sleeping agent keeps its process and pool slot until it wakes. When off, the process closes after the idle timeout,
                or sooner if another agent needs the slot, and the conversation resumes when the agent wakes.
              </span>
            </span>
          </label>
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

const MODEL_TIERS = ["large", "medium", "small"] as const;

function modelLabel(model: ModelInfo): string {
  if (!model.name || model.name.toLowerCase() === model.id.toLowerCase()) return model.name || model.id;
  return `${model.name} · ${model.id}`;
}

/** Model pickers for the three tiers, listing the models Claude Code
 *  offers the signed-in plan. */
export function ClaudeModelTiers({
  connection,
  disabled,
  onPin,
}: {
  connection: RuntimeConnection;
  disabled?: boolean;
  onPin: (tier: string, model: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    integrations.connectionModels(connection.id).then(
      (list) => {
        if (live) setModels(list);
      },
      (err: any) => {
        if (!live) return;
        setModels([]);
        setError(err?.message || "Could not list Claude models");
      },
    );
    return () => {
      live = false;
    };
  }, [connection.id]);

  return (
    <div className="space-y-1.5">
      {MODEL_TIERS.map((tier) => {
        const current = String(connection.runtime_config?.[`model_${tier}`] || "");
        const options = models || [];
        const listed = !current || options.some((model) => model.id === current);
        return (
          <label key={tier} className="flex items-center gap-3 min-w-0">
            <span className="w-12 shrink-0 text-xs capitalize text-text-muted">{tier}</span>
            <select
              value={current}
              onChange={(event) => onPin(tier, event.target.value)}
              disabled={disabled || models === null}
              aria-label={`${tier} model`}
              className="min-w-0 w-full rounded border border-border bg-bg-input px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">Default</option>
              {!listed && <option value={current}>{current}</option>}
              {options.map((model) => (
                <option key={model.id} value={model.id} title={model.description}>
                  {modelLabel(model)}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {error && <p className="text-xs text-yellow">{error}</p>}
    </div>
  );
}
