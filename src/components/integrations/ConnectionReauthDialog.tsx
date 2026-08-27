import { useEffect, useRef, useState } from "react";
import {
  integrations,
  type ConnectionInfo,
  type DeviceAuthStart,
} from "../../api";
import { Modal } from "../Modal";

type ReauthConnection = Pick<ConnectionInfo, "id" | "name"> & { auth_type?: string };

export function isConnectionReauthable(authType: string): boolean {
  return authType === "oauth1" || authType === "oauth2" || authType === "oauth_device_code";
}

export function DeviceCodeAuthPanel({
  auth,
  onConnected,
  onError,
}: {
  auth: DeviceAuthStart;
  onConnected: () => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState("pending");
  const [pollTick, setPollTick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStatus("pending");
    setCopied(false);
  }, [auth.session_id]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await integrations.deviceAuthPoll(auth.session_id);
        if (cancelled) return;
        setStatus(next.status);
        if (next.status === "connected") {
          onConnected();
        } else if (next.status === "pending") {
          window.setTimeout(() => setPollTick((value) => value + 1), 0);
        } else if (next.status === "expired" || next.status === "failed") {
          onError(next.error || `Authentication ${next.status}`);
        }
      } catch (err: any) {
        if (!cancelled) onError(err?.message || "Authentication check failed");
      }
    }, Math.max(2, auth.interval_seconds || 5) * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [auth.session_id, auth.interval_seconds, pollTick, onConnected, onError]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(auth.user_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onError("Could not copy the code. Select it and copy it manually.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2.5">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />
        <span className="text-xs font-semibold text-text">
          {status === "pending" ? "Waiting for authorization" : status}
        </span>
        <span className="ml-auto text-[10px] text-text-muted">Checking automatically</span>
      </div>

      <div className="rounded-lg border border-border bg-bg-hover/60 px-4 py-5 text-center">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted">
          Enter this code when prompted
        </div>
        <div className="select-all font-mono text-2xl font-bold tracking-[0.12em] text-text">
          {auth.user_code}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void copyCode()}
          className="inline-flex flex-1 items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-semibold text-text-muted transition-colors hover:border-accent/50 hover:text-text"
        >
          {copied ? "Copied" : "Copy code"}
        </button>
        <a
          href={auth.verification_uri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-bold text-bg transition-colors hover:bg-accent-hover"
        >
          Open sign-in page
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M6 3h7v7M13 3 7.5 8.5" />
            <path d="M11 9.5V13H3V5h3.5" />
          </svg>
        </a>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-text-muted">
        Approve access in the new window, then return here. This dialog will finish automatically.
      </p>
    </div>
  );
}

export function ConnectionReauthDialog({
  connection,
  onClose,
  onComplete,
}: {
  connection: ReauthConnection | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuthStart | null>(null);
  const [waitingForPopup, setWaitingForPopup] = useState(false);
  const [error, setError] = useState("");
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    setStarting(false);
    setDeviceAuth(null);
    setWaitingForPopup(false);
    setError("");
    popupRef.current = null;
  }, [connection?.id]);

  useEffect(() => {
    if (!waitingForPopup) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; ok?: boolean } | null;
      if (!data || data.type !== "apteva-oauth-result") return;
      if (data.ok) {
        onComplete();
      } else {
        setWaitingForPopup(false);
        setError("OAuth re-auth did not complete");
      }
    };
    window.addEventListener("message", onMessage);
    const closePoll = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setWaitingForPopup(false);
      }
    }, 500);
    const timeout = window.setTimeout(() => {
      popupRef.current = null;
      setWaitingForPopup(false);
      setError("OAuth re-authentication timed out. Try again.");
    }, 180_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(closePoll);
      window.clearTimeout(timeout);
    };
  }, [waitingForPopup, onComplete]);

  const start = async () => {
    if (!connection) return;
    setStarting(true);
    setError("");
    try {
      const result = await integrations.reauth(connection.id);
      if (result.device_auth) {
        setDeviceAuth(result.device_auth);
        return;
      }
      if (result.redirect_url) {
        const popup = window.open(
          result.redirect_url,
          "apteva-oauth",
          "width=540,height=680,menubar=no,toolbar=no,location=no",
        );
        if (!popup) {
          setError("The sign-in popup was blocked. Allow popups and try again.");
          return;
        }
        popupRef.current = popup;
        setWaitingForPopup(true);
        return;
      }
      setError("The connection did not return a supported authentication flow.");
    } catch (err: any) {
      setError(err?.message || "Failed to start re-authentication");
    } finally {
      setStarting(false);
    }
  };

  const complete = () => {
    onComplete();
  };

  return (
    <Modal open={!!connection} onClose={onClose} width="max-w-md" ariaLabel="Reconnect provider">
      <div className="w-full">
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M15.5 6.5A6 6 0 1 0 16 13" strokeLinecap="round" />
              <path d="M15.5 3v3.5H12" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7.5 9.5h5v4h-5z" />
              <path d="M8.5 9.5V8a1.5 1.5 0 0 1 3 0v1.5" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-text">Reconnect {connection?.name}</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Sign in again to refresh this provider connection. Your agents, models, and app bindings will not change.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text"
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 pb-5">
          {deviceAuth ? (
            <DeviceCodeAuthPanel auth={deviceAuth} onConnected={complete} onError={setError} />
          ) : waitingForPopup ? (
            <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent/10 p-3">
              <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold text-text">Waiting for sign-in</div>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                  Complete authorization in the provider window. This dialog will update automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-md border border-border bg-bg-hover/50 p-3">
              <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-green" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="m3 8 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-xs leading-relaxed text-text-muted">
                Your current credentials stay active until the new sign-in succeeds.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red/30 bg-red/10 px-3 py-2.5 text-xs leading-relaxed text-red">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-bg-hover/20 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-semibold text-text-muted transition-colors hover:bg-bg-hover hover:text-text"
          >
            {deviceAuth || waitingForPopup ? "Close" : "Cancel"}
          </button>
          {!deviceAuth && !waitingForPopup && (
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-bg transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {starting ? "Starting…" : "Continue to sign in"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
