import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { auth } from "../api";

// ResetPassword is where a one-time reset link an admin created lands:
// /reset-password#<token>. The token sits in the #fragment so loading the
// page never sends it to the server; it is posted in a request body instead.
// Setting the password does not sign in, so MFA still applies at login.

function tokenFromHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export function ResetPassword() {
  usePageTitle("Reset Password");
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromHash(location.hash));
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">(token ? "checking" : "invalid");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(token ? "" : "This reset link is incomplete. Copy the whole link and try again.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    auth.checkPasswordReset(token)
      .then((info) => {
        if (cancelled) return;
        setEmail(info.email);
        setState("ready");
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || String(e));
        setState("invalid");
      });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const result = await auth.resetPassword(token, password);
      setEmail(result.email || email);
      setState("done");
      // The link is spent; keep it out of the address bar and history.
      navigate(location.pathname, { replace: true });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-text text-3xl font-bold">Reset password</h1>
          {state === "ready" && (
            <p className="text-text-muted text-base mt-2">
              Choose a new password for <span className="font-mono">{email}</span>.
            </p>
          )}
        </div>

        <div className="border border-border rounded-lg p-8 bg-bg-card">
          {state === "checking" && <p className="text-text-muted text-sm">Checking the link…</p>}

          {state === "invalid" && (
            <div className="space-y-4">
              <p className="text-red text-sm">{error}</p>
              <Link to="/login" className="block text-center text-sm text-text-muted hover:text-text">Go to sign in</Link>
            </div>
          )}

          {state === "done" && (
            <div className="space-y-5">
              <p className="text-text text-sm">
                Your password is changed. Sign in with the new password
                {email ? <> as <span className="font-mono">{email}</span></> : null}.
              </p>
              <Link
                to="/login"
                className="block w-full text-center bg-accent text-bg font-bold py-3 rounded-lg text-base hover:bg-accent-hover transition-colors"
              >
                Sign in
              </Link>
            </div>
          )}

          {state === "ready" && (
            <form onSubmit={submit}>
              <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
              <div className="mb-5">
                <label htmlFor="reset-password" className="block text-text-muted text-sm mb-2">New password</label>
                <input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div className="mb-5">
                <label htmlFor="reset-password-confirm" className="block text-text-muted text-sm mb-2">Repeat new password</label>
                <input
                  id="reset-password-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              {error && <div className="text-red text-sm mb-4">{error}</div>}
              <button
                type="submit"
                disabled={busy}
                className="w-full bg-accent text-bg font-bold py-3 rounded-lg text-base hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {busy ? "Saving…" : "Set new password"}
              </button>
              <p className="mt-4 text-xs text-text-dim">
                Every session of this account signs out once the password changes.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
