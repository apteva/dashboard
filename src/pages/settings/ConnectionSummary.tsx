import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { serverSettings, type PublicAddressSettings } from "../../api";

export function ConnectionSummary({ compact = false, revision = 0 }: { compact?: boolean; revision?: number }) {
  const [data, setData] = useState<PublicAddressSettings | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    serverSettings.publicAddress().then(value => { if (!cancelled) setData(value); }).catch(() => { if (!cancelled) setError("Could not load the public address."); });
    return () => { cancelled = true; };
  }, [revision, retry]);
  const safeURL = data?.public_url && /^https?:\/\//i.test(data.public_url) ? data.public_url : null;
  const copy = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(data.public_url); setCopied(true); }
    catch { setError("Could not copy. Select and copy the address below."); }
  };
  return <section className="rounded-lg border border-border bg-bg-card p-4 sm:p-5" aria-label="Public address and HTTPS">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-text">Public address &amp; HTTPS</h2><p className="mt-1 text-xs text-text-muted">Used for external access, OAuth callbacks, and webhooks.</p></div>
      {compact && <Link to="/settings?tab=server" className="text-xs font-semibold text-accent hover:underline">{data?.can_manage ? "Configure →" : "View →"}</Link>}
    </div>
    {!data && !error && <p role="status" className="mt-3 text-xs text-text-muted">Loading address…</p>}
    {error && <p role="alert" className="mt-3 text-xs text-error">{error} <button type="button" onClick={() => setRetry(value => value + 1)} className="text-accent underline">Retry</button></p>}
    {data && <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <code className="min-w-0 flex-1 select-all break-all text-sm text-text">{data.public_url || "Not configured"}</code>
        {safeURL && <><button type="button" onClick={() => void copy()} className="min-h-9 rounded-lg border border-border px-3 text-xs hover:border-accent">{copied ? "Copied" : "Copy"}</button><a href={safeURL} target="_blank" rel="noreferrer" className="min-h-9 rounded-lg border border-border px-3 py-2 text-xs hover:border-accent">Open ↗</a></>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <span className={data.configured ? "text-text-muted" : "text-warn"}>{data.configured ? "Public address configured" : "Public address not configured · local fallback"}</span>
        <span className={data.verified ? "text-success" : "text-text-muted"}>{data.verified ? "HTTPS verified by Apteva" : data.https ? "HTTPS address · not verified by Apteva" : "HTTP address"}</span>
      </div>
      {!compact && <>
        <p className="mt-3 text-xs text-text-dim">{data.updated_at ? `HTTPS setup status updated ${new Date(data.updated_at).toLocaleString()}.` : "No HTTPS setup check recorded."} {data.phase === "error" || data.phase === "renewal_required" ? "HTTPS setup needs administrator attention." : ""}</p>
        {!data.can_manage && <p className="mt-3 text-xs text-text-muted">Managed by your administrator. Ask them to configure or change this address.</p>}
      </>}
    </>}
  </section>;
}
