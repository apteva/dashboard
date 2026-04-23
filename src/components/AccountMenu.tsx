import { useState } from "react";
import { auth } from "../api";
import type { AuthUser } from "../hooks/useAuth";
import { Modal } from "./Modal";

interface Props {
  user: AuthUser;
  onLogout: () => void;
}

// AccountMenu — sidebar footer block that shows the signed-in email and
// exposes the self-service account actions (change password, log out).
// Intentionally inline rather than a dropdown menu so both actions stay
// one click away on every page and there's nowhere for them to hide.
export function AccountMenu({ user, onLogout }: Props) {
  const [showPwd, setShowPwd] = useState(false);

  return (
    <div className="px-5 py-3 border-t border-border">
      <div
        className="text-text text-xs font-mono truncate"
        title={`Signed in as ${user.email}`}
      >
        {user.email}
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <button
          onClick={() => setShowPwd(true)}
          className="text-[10px] text-text-muted hover:text-accent transition-colors"
          title="Change your password"
        >
          Change password
        </button>
        <button
          onClick={onLogout}
          className="text-[10px] text-text-muted hover:text-red transition-colors"
          title="Log out of this session"
        >
          Log out
        </button>
      </div>

      <ChangePasswordModal
        open={showPwd}
        onClose={() => setShowPwd(false)}
      />
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setErr("");
    setOk(false);
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (next.length < 8) {
      setErr("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setErr("New password and confirmation don't match.");
      return;
    }
    if (next === current) {
      setErr("New password must differ from the current one.");
      return;
    }
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      setOk(true);
      // Clear the form but keep the modal open briefly so the success
      // message is visible, then auto-close.
      setCurrent("");
      setNext("");
      setConfirm("");
      setTimeout(() => {
        reset();
        onClose();
      }, 1500);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
    >
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Change password</h3>
        <p className="text-text-muted leading-relaxed">
          Enter your current password to change it. All other active
          sessions for your account will be signed out; this one
          stays logged in.
        </p>

        <label className="block">
          <span className="text-text-muted">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required
            disabled={busy || ok}
          />
        </label>

        <label className="block">
          <span className="text-text-muted">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required
            disabled={busy || ok}
          />
        </label>

        <label className="block">
          <span className="text-text-muted">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
            required
            disabled={busy || ok}
          />
        </label>

        {err && (
          <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">
            {err}
          </div>
        )}
        {ok && (
          <div className="text-green text-[11px] bg-green/10 border border-green/30 rounded px-2 py-1">
            Password updated. Other sessions have been signed out.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            disabled={busy || ok}
          >
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
