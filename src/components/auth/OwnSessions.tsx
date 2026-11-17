import { useEffect, useState } from "react";

import { auth, type OwnSession } from "../../api";

function when(value?: string): string {
  if (!value) return "";
  const date = new Date(value.includes("T") || value.endsWith("Z") ? value : value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// Short, readable device label from a user agent string.
export function describeUserAgent(ua?: string): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|Go-http-client|python|bun/i.test(ua) ? "Script" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** The signed-in user's own dashboard sessions, with per-session sign-out. */
export function OwnSessions() {
  const [sessions, setSessions] = useState<OwnSession[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => auth.sessions().then(setSessions).catch((err) => setError(err?.message || String(err)));
  useEffect(() => { load(); }, []);

  const signOut = async (ref: string) => {
    setBusy(ref);
    setError("");
    try {
      await auth.revokeSession(ref);
      await load();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border border-border rounded-lg p-5 bg-bg-card">
      <h3 className="text-text text-sm font-bold">Signed-in sessions</h3>
      <p className="text-text-muted text-sm mt-1 mb-4">
        Where your account is signed in to this dashboard. Sign out any session you don't recognise, then change your password.
      </p>
      {error && <p className="mb-3 text-xs text-red" role="alert">{error}</p>}
      {!sessions ? <p className="text-xs text-text-muted">Loading…</p> : sessions.length === 0 ? <p className="text-xs text-text-muted">No active sessions.</p> : (
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.ref} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm text-text">
                  {describeUserAgent(s.created_user_agent)}
                  {s.current && <span className="rounded border border-green/35 bg-green/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green">This session</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-text-dim">
                  Signed in {when(s.created_at)}{s.created_ip ? ` from ${s.created_ip}` : ""}
                  {s.last_seen_at ? ` · last active ${when(s.last_seen_at)}${s.last_seen_ip && s.last_seen_ip !== s.created_ip ? ` from ${s.last_seen_ip}` : ""}` : ""}
                </p>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={() => signOut(s.ref)}
                  disabled={busy === s.ref}
                  className="px-3 py-1.5 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors disabled:opacity-50"
                >
                  {busy === s.ref ? "Signing out…" : "Sign out"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
