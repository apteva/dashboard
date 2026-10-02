import { useState } from "react";

import { auth } from "../../api";

import { Modal } from "../../components/Modal";

import { useAuth } from "../../hooks/useAuth";

import { MFASetup } from "../../components/auth/MFASetup";

export function AccountTab({ security = false }: { security?: boolean }) {
  // Pull the authenticated profile straight from the auth hook —
  // /auth/me returns {user_id, email, created_at} on every page load
  // so we don't need our own fetch. Password-change modal state is
  // local: open → collect current/new/confirm → POST /auth/password.
  const { user, refresh } = useAuth();
  const [showPwd, setShowPwd] = useState(false);
  const [showMFASetup, setShowMFASetup] = useState(false);
  const [mfaAction, setMFAAction] = useState<"disable" | "recovery" | null>(null);
  // Success banner state here so the page itself acknowledges the
  // change; the modal's own banner is short-lived.
  const [changed, setChanged] = useState(false);

  // Handle the "user is still null" transient first so the rest of the
  // render can assume a concrete profile.
  if (user === null) {
    return <p className="text-text-muted text-sm">Loading…</p>;
  }
  if (user === false) {
    return <p className="text-text-muted text-sm">Not signed in.</p>;
  }

  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "";

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-text text-base font-bold">{security ? "Account security" : "Your account"}</h2>
        <p className="text-text-muted text-sm mt-1">Manage your account settings.</p>
      </div>

      {!security && <>
      {/* Profile — email + user id + joined date. Small read-only
          card so the user always knows which account they're acting
          under without having to check the sidebar. */}
      <div className="border border-border rounded-lg p-5 bg-bg-card space-y-3">
        <h3 className="text-text text-sm font-bold">Profile</h3>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-4 text-sm">
          <dt className="text-text-muted">Email</dt>
          <dd className="text-text font-mono break-all">{user.email}</dd>
          <dt className="text-text-muted">User ID</dt>
          <dd className="text-text font-mono">#{user.id}</dd>
          {joined && (<>
            <dt className="text-text-muted">Joined</dt>
            <dd className="text-text-muted">{joined}</dd>
          </>)}
        </dl>
      </div>

      {(user.managedLLM.configured || user.limits.daily_model_calls > 0 || user.limits.daily_tokens > 0 || user.workspace.expires_at) && (
        <div className="border border-border rounded-lg p-5 bg-bg-card space-y-3">
          <div>
            <h3 className="text-text text-sm font-bold">Usage and workspace</h3>
            <p className="mt-1 text-xs text-text-muted">Your projects are private and visible only to their members.</p>
          </div>
          <dl className="grid grid-cols-[minmax(130px,1fr)_auto] gap-x-4 gap-y-2 text-sm">
            {user.limits.daily_model_calls > 0 && (<>
              <dt className="text-text-muted">Model calls today</dt>
              <dd className="text-text font-mono">{user.usage.calls.toLocaleString()} / {user.limits.daily_model_calls.toLocaleString()}</dd>
            </>)}
            {user.limits.daily_tokens > 0 && (<>
              <dt className="text-text-muted">Tokens today</dt>
              <dd className="text-text font-mono">{(user.usage.input_tokens + user.usage.output_tokens).toLocaleString()} / {user.limits.daily_tokens.toLocaleString()}</dd>
            </>)}
            {user.limits.agents_per_project > 0 && (<>
              <dt className="text-text-muted">Agent limit</dt>
              <dd className="text-text font-mono">{user.limits.agents_per_project} / project</dd>
            </>)}
            {user.workspace.expires_at && (<>
              <dt className="text-text-muted">Workspace expires</dt>
              <dd className="text-text">{new Date(user.workspace.expires_at).toLocaleString()}</dd>
            </>)}
          </dl>
          {(user.limits.daily_model_calls > 0 || user.limits.daily_tokens > 0) && <p className="text-[11px] text-text-dim">Daily allowances reset at 00:00 UTC.</p>}
        </div>
      )}

      </>}

      {security && <>
      {/* Password — change via the same flow the sidebar AccountMenu
          uses. Other sessions get revoked; the current session stays
          alive. */}
      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <h3 className="text-text text-sm font-bold mb-3">Password</h3>
        <p className="text-text-muted text-sm mb-4">
          Change your password. All other active sessions will be
          signed out; this session stays logged in.
        </p>
        {changed && (
          <div className="mb-3 text-green text-xs bg-green/10 border border-green/30 rounded px-3 py-2">
            Password updated. Other sessions have been signed out.
          </div>
        )}
        <button
          onClick={() => setShowPwd(true)}
          className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-accent hover:border-accent transition-colors"
        >
          Change password
        </button>
      </div>

      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-text text-sm font-bold">Two-factor authentication</h3>
              <span className={`rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${user.mfaEnabled ? "border-green/35 bg-green/10 text-green" : "border-border text-text-dim"}`}>
                {user.mfaEnabled ? "Enabled" : "Optional"}
              </span>
            </div>
            <p className="text-text-muted text-sm mt-2 max-w-2xl">
              Require a code from your authenticator app when signing in to the dashboard. API keys and agent credentials are unaffected.
            </p>
          </div>
        </div>
        {user.mfaEnabled ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-text-dim">
              {user.mfaRecoveryCodesRemaining} recovery code{user.mfaRecoveryCodesRemaining === 1 ? "" : "s"} remaining.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMFAAction("recovery")}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-accent hover:border-accent transition-colors"
              >
                New recovery codes
              </button>
              <button
                type="button"
                onClick={() => setMFAAction("disable")}
                className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
              >
                Disable two-factor
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowMFASetup(true)}
            className="mt-4 px-5 py-2.5 border border-accent text-accent rounded-lg text-sm font-bold hover:bg-accent/10 transition-colors"
          >
            Enable two-factor
          </button>
        )}
      </div>

      </>}
      <div className="border border-border rounded-lg p-5 bg-bg-card">
        <h3 className="text-text text-sm font-bold mb-3">Sign out</h3>
        <p className="text-text-muted text-sm mb-4">
          This will end your current session. You'll need to sign in again.
        </p>
        <button
          onClick={() => auth.logout()}
          className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-red hover:border-red transition-colors"
        >
          Log out
        </button>
      </div>

      <AccountChangePasswordModal
        open={showPwd}
        onClose={() => setShowPwd(false)}
        onChanged={() => { setChanged(true); refresh(); }}
      />
      <Modal open={showMFASetup} onClose={() => setShowMFASetup(false)}>
        <div className="w-full max-w-xl p-5">
          <div className="mb-5 flex items-center gap-3">
            <h3 className="text-sm font-bold text-text">Enable two-factor authentication</h3>
            <button type="button" onClick={() => setShowMFASetup(false)} className="ml-auto text-lg text-text-dim hover:text-text" aria-label="Close">×</button>
          </div>
          <MFASetup onEnabled={refresh} />
        </div>
      </Modal>
      <MFAActionModal
        mode={mfaAction}
        onClose={() => setMFAAction(null)}
        onChanged={refresh}
      />
    </div>
  );
}

// Inline password-change modal for the Account tab. Mirrors the
// sidebar ChangePasswordModal in AccountMenu but surfaces success
// back to the tab (via onChanged) so the page can render its own
// confirmation banner.
function AccountChangePasswordModal({
  open, onClose, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); setErr(""); setBusy(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (next.length < 8) { setErr("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setErr("New password and confirmation don't match."); return; }
    if (next === current) { setErr("New password must differ from the current one."); return; }
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      onChanged();
      reset();
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }}>
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Change password</h3>
        <label className="block">
          <span className="text-text-muted">Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required autoFocus disabled={busy} />
        </label>
        <label className="block">
          <span className="text-text-muted">New password</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required disabled={busy} />
        </label>
        <label className="block">
          <span className="text-text-muted">Confirm new password</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required disabled={busy} />
        </label>
        {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => { reset(); onClose(); }} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
          <button type="submit" className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MFAActionModal({
  mode,
  onClose,
  onChanged,
}: {
  mode: "disable" | "recovery" | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const resetAndClose = () => {
    setPassword("");
    setCode("");
    setBusy(false);
    setError("");
    setRecoveryCodes([]);
    setCopied(false);
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mode) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "disable") {
        await auth.disableMFA(password, code);
        await onChanged();
        resetAndClose();
        return;
      }
      const result = await auth.regenerateMFARecoveryCodes(password, code);
      setRecoveryCodes(result.recovery_codes);
      setPassword("");
      setCode("");
      await onChanged();
    } catch (err: any) {
      setError(err?.message === "unauthorized" ? "The password or authentication code is incorrect." : err?.message || "Could not update two-factor authentication");
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setError("Could not copy automatically. Select and save the codes manually.");
    }
  };

  return (
    <Modal open={mode !== null} onClose={resetAndClose}>
      <div className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-center gap-3">
          <h3 className="text-sm font-bold text-text">
            {mode === "disable" ? "Disable two-factor authentication" : "Generate new recovery codes"}
          </h3>
          <button type="button" onClick={resetAndClose} className="ml-auto text-lg text-text-dim hover:text-text" aria-label="Close">×</button>
        </div>
        {recoveryCodes.length > 0 ? (
          <div className="space-y-4">
            <p className="text-xs leading-5 text-text-muted">
              Your previous recovery codes no longer work. Save these replacements now; they will not be shown again.
            </p>
            <div className="grid gap-2 rounded-lg border border-border bg-bg-input p-4 font-mono text-xs text-text sm:grid-cols-2">
              {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
            </div>
            <button type="button" onClick={copyCodes} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:border-accent hover:text-accent">
              {copied ? "Copied" : "Copy recovery codes"}
            </button>
            {error && <p className="text-xs text-red" role="alert">{error}</p>}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs leading-5 text-text-muted">
              Confirm this sensitive change with your current password and an authenticator or recovery code.
            </p>
            <label className="block">
              <span className="text-xs font-semibold text-text-muted">Current password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required disabled={busy}
                className="mt-1.5 w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-text-muted">Authentication or recovery code</span>
              <input type="text" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required disabled={busy}
                className="mt-1.5 w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-center font-mono text-base tracking-wider text-text focus:border-accent focus:outline-none" />
            </label>
            {error && <p className="text-xs text-red" role="alert">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={resetAndClose} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-xs text-text-muted hover:text-text">Cancel</button>
              <button type="submit" disabled={busy || !password || !code.trim()} className={`rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-50 ${mode === "disable" ? "border border-red text-red hover:bg-red/10" : "bg-accent text-bg hover:bg-accent-hover"}`}>
                {busy ? "Confirming…" : mode === "disable" ? "Disable" : "Generate codes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
