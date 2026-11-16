import { useCallback, useEffect, useRef, useState } from "react";

import { auth, setReauthHandler, type ReauthChallenge } from "../../api";
import { useAuth } from "../../hooks/useAuth";
import { Modal } from "../Modal";

// Describes what the server is guarding, so the prompt says why it appeared.
export function describeReauthAction(challenge: Pick<ReauthChallenge, "method" | "path">): string {
  const { method, path } = challenge;
  if (/^\/connections\/[^/]+\/credentials$/.test(path)) return "reveal stored credentials";
  if (method === "PATCH" && path.startsWith("/admin/users/")) return "change an administrator role";
  if (path.startsWith("/security/containment")) return "revoke access";
  if (/^\/security\/users\/[^/]+\/(disable|enable)$/.test(path)) return "disable or enable an account";
  if (path.startsWith("/security/host/policy")) return "change SSH monitoring";
  return "continue";
}

export function reauthErrorMessage(err: unknown): string {
  const e = err as { status?: number; message?: string } | null;
  if (e?.message === "unauthorized" || e?.status === 401) return "The password or authentication code is incorrect.";
  if (e?.status === 429) return "Too many attempts. Wait a few minutes and try again.";
  return e?.message || "Could not confirm your identity.";
}

/**
 * Global password re-check. Privileged API calls answer 403
 * reauthentication_required when this session has not confirmed its password
 * recently; api.ts then awaits this prompt and retries the call once.
 * Mount once inside AuthProvider.
 */
export function ReauthPrompt() {
  const { user } = useAuth();
  const [challenge, setChallenge] = useState<ReauthChallenge | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setChallenge(null);
    setPassword("");
    setCode("");
    setBusy(false);
    setError("");
    resolve?.(ok);
  }, []);

  useEffect(() => {
    setReauthHandler((next) => new Promise<boolean>((resolve) => {
      // A newer prompt replaces an unanswered one; the old caller is refused.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setChallenge(next);
    }));
    return () => {
      setReauthHandler(null);
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  const needsCode = !!(user && user.mfaEnabled);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.reauth(password, needsCode ? code.trim() : undefined);
      finish(true);
    } catch (err) {
      setError(reauthErrorMessage(err));
      setBusy(false);
    }
  };

  const minutes = challenge?.windowMinutes || 15;

  return (
    <Modal open={challenge !== null} onClose={() => finish(false)} ariaLabel="Confirm your password" width="max-w-md">
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-bold text-text">Confirm your password</h3>
          <p className="mt-1.5 text-xs leading-5 text-text-muted">
            To {challenge ? describeReauthAction(challenge) : "continue"}, confirm it is you. You won't be asked again for {minutes} minute{minutes === 1 ? "" : "s"}.
          </p>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-text-muted">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus disabled={busy}
            className="mt-1.5 w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none" />
        </label>
        {needsCode && (
          <label className="block">
            <span className="text-xs font-semibold text-text-muted">Authentication or recovery code</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required disabled={busy}
              className="mt-1.5 w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-center font-mono text-base tracking-wider text-text focus:border-accent focus:outline-none" />
          </label>
        )}
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => finish(false)} disabled={busy} className="rounded-lg border border-border px-4 py-2 text-xs text-text-muted hover:text-text">Cancel</button>
          <button type="submit" disabled={busy || !password || (needsCode && !code.trim())} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-50">
            {busy ? "Confirming…" : "Confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
