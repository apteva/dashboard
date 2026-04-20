import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { invites, type PublicInviteInfo } from "../api";

// Connect — public page for end clients who don't have a dashboard login.
// The operator shared /connect/:token with them; the server validates the
// token, returns the pre-bound app + project info, and the client either
// pastes credentials (api_key apps) or clicks "Connect" which redirects
// them through the provider's OAuth consent screen.
//
// No auth required to reach this page. The token IS the authorization.
export function Connect() {
  const { token = "" } = useParams<{ token: string }>();
  const [info, setInfo] = useState<PublicInviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [creds, setCreds] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"connected" | "updated" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await invites.get(token);
        if (!cancelled) setInfo(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "invalid link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const r = await invites.fulfill(token, { credentials: creds });
      if (r.status === "redirect" && r.redirect_url) {
        window.location.href = r.redirect_url;
        return;
      }
      setDone(r.status as "connected" | "updated");
    } catch (e: any) {
      setError(e?.message || "failed");
    } finally {
      setSubmitting(false);
    }
  };

  const connectOAuth = async () => {
    setSubmitting(true);
    setError("");
    try {
      const r = await invites.fulfill(token, {});
      if (r.status === "redirect" && r.redirect_url) {
        window.location.href = r.redirect_url;
        return;
      }
      setDone(r.status as "connected" | "updated");
    } catch (e: any) {
      setError(e?.message || "failed");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text-dim text-sm">
        Loading…
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <div className="max-w-md w-full border border-border rounded-lg p-6 space-y-2">
          <div className="text-red font-bold text-sm">Link unavailable</div>
          <div className="text-text-muted text-xs leading-snug">{error}</div>
          <div className="text-text-dim text-xs leading-snug pt-1">
            The link may have expired or been mistyped. Ask the person who
            shared it to generate a fresh one.
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <div className="max-w-md w-full border border-border rounded-lg p-6 space-y-2">
          <div className="text-green font-bold text-sm">
            {done === "updated" ? "Credentials updated" : "Connected"}
          </div>
          <div className="text-text-muted text-xs leading-snug">
            You can close this tab. The operator will be notified.
          </div>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const isReauth = !!info.connection_id;
  const isOAuth = info.has_oauth2;
  const fields = info.credential_fields || [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4 py-8">
      <div className="max-w-md w-full border border-border rounded-lg p-6 space-y-4">
        <div>
          <div className="text-text-dim text-xs uppercase tracking-wider mb-1">
            {isReauth ? "Refresh credentials" : "Connect integration"}
          </div>
          <h1 className="text-text text-xl font-bold">
            {info.app_name || info.app_slug}
          </h1>
          {info.connection_name && (
            <div className="text-text-muted text-xs mt-1">
              connection: <span className="text-text">{info.connection_name}</span>
            </div>
          )}
        </div>

        <p className="text-text-muted text-xs leading-snug">
          {isReauth
            ? `You've been asked to refresh the credentials for this integration. The new key replaces the existing one immediately.`
            : `You've been invited to grant access to ${info.app_name || info.app_slug}. ${isOAuth ? "You'll be redirected to the provider's sign-in page." : "Paste the credentials below to authorize."}`}
          {info.allowed_tools && (
            <span className="block mt-2 text-text-dim">
              Scope: {info.allowed_tools}
            </span>
          )}
        </p>

        {isOAuth && !isReauth ? (
          <button
            onClick={connectOAuth}
            disabled={submitting}
            className="w-full px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
          >
            {submitting ? "Redirecting…" : `Connect with ${info.app_name || info.app_slug}`}
          </button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {fields.length === 0 ? (
              <div className="text-text-dim text-xs">
                No credential fields declared for this app. Ask the operator
                to check the catalog entry.
              </div>
            ) : (
              fields.map((f) => (
                <div key={f.name} className="space-y-1">
                  <label className="text-text-muted text-xs">
                    {f.label}
                    {f.required !== false && <span className="text-red"> *</span>}
                  </label>
                  <input
                    type={f.type === "password" ? "password" : "text"}
                    value={creds[f.name] || ""}
                    onChange={(e) => setCreds({ ...creds, [f.name]: e.target.value })}
                    required={f.required !== false}
                    autoComplete="off"
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                  />
                  {f.description && (
                    <div className="text-text-dim text-[10px]">{f.description}</div>
                  )}
                </div>
              ))
            )}
            <button
              type="submit"
              disabled={submitting || fields.length === 0}
              className="w-full px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? "Submitting…" : isReauth ? "Update credentials" : "Authorize"}
            </button>
          </form>
        )}

        {error && <div className="text-red text-xs">{error}</div>}

        <div className="text-text-dim text-[10px] pt-2 border-t border-border">
          link expires {new Date(info.expires_at).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
