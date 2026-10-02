import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platform, type PlatformStatus } from "../../api";
import { useAuth } from "../../hooks/useAuth";
import { PlatformUpdateAction } from "../../components/PlatformUpdateAction";
import { ConnectionSummary } from "./ConnectionSummary";
import { ServerTab } from "./ServerSettings";

export function PublicAddressPage() {
  const { user } = useAuth();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return <div className="max-w-4xl space-y-6"><ConnectionSummary revision={revision} />{user && user.role === "admin" && <ServerTab section="public" />}</div>;
}

export function ConnectionLinks() {
  return <div className="grid max-w-4xl gap-4 sm:grid-cols-2">{[
    { to: "/integrations", title: "Connected services", description: "Connect accounts, manage credentials, and check integration status." },
    { to: "/apps", title: "Apps", description: "Install apps, configure them, and choose defaults for new agents." },
  ].map(item => <Link key={item.to} to={item.to} className="rounded-lg border border-border bg-bg-card p-5 transition-colors hover:border-accent focus-visible:outline-accent"><h2 className="font-semibold">{item.title} →</h2><p className="mt-2 text-sm text-text-muted">{item.description}</p></Link>)}</div>;
}

export function UpdatesPage() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (refresh = false) => {
    setBusy(true); setError("");
    try { setStatus(await (refresh ? platform.refresh() : platform.status())); }
    catch { setError("Could not load update information. Try again."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  return <div className="max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Updates</h2><button disabled={busy} onClick={() => void load(true)} className="min-h-10 rounded-lg border border-border px-3 text-xs hover:border-accent disabled:opacity-50">{busy ? "Checking…" : "Check for updates"}</button></div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {status && <><div className="overflow-hidden rounded-lg border border-border">{status.components.map(item => <div key={item.name} className="flex flex-wrap justify-between gap-2 border-b border-border p-3 text-sm last:border-0"><span>{item.name}</span><span className="text-text-muted">{item.current || "Unknown"}{item.update_available && ` → ${item.latest}`}</span></div>)}</div><PlatformUpdateAction status={status} />{status.error && <p className="text-xs text-warn">{status.error}</p>}</>}
  </div>;
}
