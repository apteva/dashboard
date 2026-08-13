import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { auth } from "../../api";

export function MFASetup({
  onEnabled,
}: {
  onEnabled?: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<"password" | "scan" | "recovery">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [uri, setURI] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const begin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await auth.beginMFAEnrollment(password);
      setSecret(result.secret);
      setURI(result.otpauth_uri);
      setPassword("");
      setPhase("scan");
    } catch (err: any) {
      setError(err?.message || "Could not start two-factor setup");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await auth.confirmMFAEnrollment(code);
      setRecoveryCodes(result.recovery_codes);
      setCode("");
      setPhase("recovery");
      await onEnabled?.();
    } catch (err: any) {
      setError(err?.message === "unauthorized" ? "That code is not valid. Check your device time and try again." : err?.message || "Could not enable two-factor authentication");
    } finally {
      setBusy(false);
    }
  };

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setError("Could not copy automatically. Select and save the codes manually.");
    }
  };

  if (phase === "recovery") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-green">Two-factor authentication is enabled</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Save these recovery codes somewhere secure. Each code works once, and they will not be shown again.
          </p>
        </div>
        <div className="grid gap-2 rounded-lg border border-border bg-bg-input p-4 font-mono text-xs text-text sm:grid-cols-2">
          {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
        </div>
        <button
          type="button"
          onClick={copyRecoveryCodes}
          className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:border-accent hover:text-accent"
        >
          {copied ? "Copied" : "Copy recovery codes"}
        </button>
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
      </div>
    );
  }

  if (phase === "scan") {
    return (
      <form onSubmit={confirm} className="space-y-5">
        <div>
          <h3 className="text-sm font-bold text-text">Scan the authenticator code</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Scan this QR code with your authenticator app, then enter the six-digit code it generates.
          </p>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="w-fit rounded-xl bg-white p-3">
            <QRCodeSVG value={uri} size={176} bgColor="#ffffff" fgColor="#111111" level="M" />
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-text-dim">Manual setup key</p>
            <code className="block break-all rounded-lg border border-border bg-bg-input p-3 text-xs text-text">
              {secret}
            </code>
            <p className="text-[10px] text-text-dim">Issuer: Apteva · 6 digits · 30 seconds</p>
          </div>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-text-muted">Authentication code</span>
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-border bg-bg-input px-4 py-3 text-center font-mono text-lg tracking-widest text-text focus:border-accent focus:outline-none"
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            autoFocus
          />
        </label>
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.trim().length !== 6}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-bg hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify and enable"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={begin} className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-text">Use an authenticator app</h3>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          Protect dashboard sign-ins with a time-based code. No phone number or external service is required.
        </p>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-text-muted">Confirm your current password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none"
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p className="text-xs text-red" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={busy || !password}
        className="rounded-lg border border-accent bg-accent px-5 py-2.5 text-sm font-bold text-bg hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? "Preparing…" : "Set up authenticator"}
      </button>
    </form>
  );
}
