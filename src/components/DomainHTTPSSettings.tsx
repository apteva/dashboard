import { useEffect, useRef, useState } from "react";
import { instanceHTTPS, type InstanceHTTPSConfig, type InstanceHTTPSStatus } from "../api";

const modes: { id: InstanceHTTPSConfig["mode"]; title: string; description: string }[] = [
  { id: "direct", title: "Direct to this server", description: "Apteva obtains and renews a trusted certificate. Public ports 80 and 443 must reach this server." },
  { id: "cloudflare", title: "Through Cloudflare", description: "Automatic origin certificates using DNS validation. Works with the Cloudflare proxy and Full (strict)." },
  { id: "proxy", title: "Existing proxy or tunnel", description: "Your proxy manages HTTPS. Apteva verifies the address and trusts only the proxy addresses you specify." },
  { id: "import", title: "Use a certificate", description: "Import a certificate and matching key, including Cloudflare Origin CA. You manage replacement." },
];
const busyPhases = new Set(["queued", "dns", "listener", "certificate", "dns_validation", "verifying"]);
const fieldClass = "w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none";

export function DomainHTTPSSettings({ onActivated }: { onActivated: () => void }) {
  const [status, setStatus] = useState<InstanceHTTPSStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<InstanceHTTPSConfig>({ hostname: "", mode: "direct", http_port: 80, https_port: 443 });
  const [token, setToken] = useState("");
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  const [proxies, setProxies] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const lastActive = useRef("");
  const callback = useRef(onActivated); callback.current = onActivated;
  const busy = saving || !!status && busyPhases.has(status.state.phase);
  const needsTerms = config.mode === "direct" || config.mode === "cloudflare";

  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await instanceHTTPS.get();
        if (stopped) return;
        setStatus(next); setOffline(false);
        if (next.state.phase === "active" && lastActive.current !== next.state.updated_at) {
          lastActive.current = next.state.updated_at; callback.current();
        }
      } catch { if (!stopped) setOffline(true); }
      finally { if (!stopped) timer = setTimeout(refresh, 3000); }
    }
    void refresh(); return () => { stopped = true; clearTimeout(timer); };
  }, []);

  function configure() {
    const current = status?.state.pending || status?.state.active;
    setConfig(current ? { ...current } : { hostname: "", mode: "direct", http_port: 80, https_port: 443 });
    setProxies(current?.trusted_proxy_cidrs?.join(", ") || "");
    setToken(""); setCert(""); setKey(""); setError(""); setStep(0); setEditing(true);
  }
  async function action(kind: "setup" | "check" | "retry" | "cancel") {
    setSaving(true); setError("");
    try {
      const secureInput = window.location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
      if (kind === "setup" && (token || key) && !secureInput) throw new Error("Use HTTPS to send a token or private key, or run apteva https setup locally on the server over SSH.");
      const next = kind === "setup" ? await instanceHTTPS.setup({ ...config, hostname: config.hostname.trim().toLowerCase(), trusted_proxy_cidrs: proxies.split(/[\s,]+/).filter(Boolean), cloudflare_token: config.mode === "cloudflare" && !config.connection_id ? token || undefined : undefined, certificate_pem: config.mode === "import" ? cert || undefined : undefined, private_key_pem: config.mode === "import" ? key || undefined : undefined }) : kind === "check" ? await instanceHTTPS.check() : kind === "cancel" ? await instanceHTTPS.cancel() : await instanceHTTPS.retry();
      setStatus(next); setEditing(false); setToken(""); setKey(""); setCert("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start HTTPS setup"); }
    finally { setSaving(false); }
  }
  const state = status?.state;
  const expires = status?.certificate?.expires_at || status?.certificate?.not_after;
  return <section className="rounded-lg border border-border bg-bg-card p-4 sm:p-5 space-y-4" aria-label="Domain and HTTPS">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-bold text-text">Domain &amp; HTTPS</h3><p className="mt-1 text-xs text-text-muted">Set up a working public address, certificates and renewal. No app installation required.</p></div>
      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${state?.phase === "active" ? "bg-green/10 text-green" : "bg-accent/10 text-accent"}`}>{state?.phase === "active" ? "HTTPS active" : busy ? "Setting up" : "Setup"}</span>
    </div>
    {state?.active && <div className="text-sm"><a className="break-all text-accent hover:underline" href={`https://${state.active.hostname}`} target="_blank" rel="noreferrer">https://{state.active.hostname} ↗</a><p className="mt-1 text-xs text-text-muted">{modes.find(mode => mode.id === state.active?.mode)?.title}{expires && ` · Expires ${new Date(expires).toLocaleDateString()}`}{status?.certificate?.renewal && ` · ${status.certificate.renewal}`}</p></div>}
    {state?.pending && <p className="break-all text-xs text-text-muted">Pending setup: https://{state.pending.hostname}</p>}
    {state?.message && <div role="status" aria-live="polite" className={`break-words text-xs ${state.phase === "error" || state.phase === "renewal_required" ? "text-yellow" : "text-text-muted"}`}>{state.message}</div>}
    {state?.addresses?.length ? <p className="break-all text-xs text-text-muted">DNS resolves to {state.addresses.join(", ")}</p> : null}
    {state?.warnings?.map((warning, i) => <p key={i} className="text-xs text-yellow">{warning}</p>)}
    {offline && <p className="text-xs text-yellow">Waiting for the server. Setup progress is saved and can be checked again later.</p>}
    {!editing && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !status} onClick={configure} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-bg disabled:opacity-50">{state?.active ? "Configure" : "Set up domain & HTTPS"}</button>
      {(state?.active || state?.pending) && <button type="button" disabled={busy} onClick={() => void action("check")} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">Check connection</button>}
      {(state?.pending || state?.phase === "renewal_required") && !busy && <button type="button" onClick={() => void action("retry")} className="rounded-lg border border-border px-3 py-2 text-xs">Retry setup</button>}
      {state?.pending && !busy && <button type="button" onClick={() => void action("cancel")} className="px-3 py-2 text-xs text-text-muted">Discard unfinished setup</button>}
    </div>}
    {editing && <form className="space-y-4 border-t border-border pt-4" onSubmit={event => { event.preventDefault(); if (step < 2) setStep(step + 1); else void action("setup"); }}>
      <ol className="flex gap-4 text-xs" aria-label="Setup steps">{["Domain", "Connection", "Activate"].map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined} className={step === i ? "font-bold text-accent" : "text-text-muted"}>{i + 1}. {label}</li>)}</ol>
      {step === 0 && <>
        <label className="block text-xs font-medium">Your domain<input required autoFocus className={`${fieldClass} mt-2`} value={config.hostname} onChange={event => setConfig({ ...config, hostname: event.target.value })} placeholder="agents.example.com" pattern="[a-zA-Z0-9.-]+" autoComplete="off" /></label>
        <p className="text-xs text-text-muted">Create an A record pointing to your server’s public IPv4 address. Only add AAAA if IPv6 also reaches your server. A Cloudflare proxy will show Cloudflare’s addresses instead.</p>
      </>}
      {step === 1 && <>
        <div className="grid gap-2 sm:grid-cols-2">{modes.map(mode => <button key={mode.id} type="button" onClick={() => { setConfig({ ...config, mode: mode.id, accept_acme_terms: false, trust_cloudflare: false, set_cloudflare_strict: false }); setToken(""); setKey(""); setCert(""); setProxies(""); }} aria-pressed={config.mode === mode.id} className={`rounded-lg border p-3 text-left ${config.mode === mode.id ? "border-accent" : "border-border hover:border-accent/50"}`}><span className="block text-sm font-semibold">{mode.title}</span><span className="mt-1 block text-xs leading-relaxed text-text-muted">{mode.description}</span></button>)}</div>
        {config.mode === "cloudflare" && <>
          <label className="block text-xs">Cloudflare connection<select className={`${fieldClass} mt-1`} value={config.connection_id || 0} onChange={event => { setToken(""); setConfig({ ...config, connection_id: Number(event.target.value) }); }}><option value={0}>Use a token (or retain the saved token)</option>{status?.connections.map(conn => <option key={conn.id} value={conn.id}>{conn.name}</option>)}</select></label>
          {!config.connection_id && <label className="block text-xs">Scoped API token<input type="password" autoComplete="new-password" className={`${fieldClass} mt-1`} value={token} onChange={event => setToken(event.target.value)} placeholder="Zone Read + DNS Edit for this domain" /></label>}
          <label className="block text-xs">Certificate contact email (optional)<input type="email" className={`${fieldClass} mt-1`} value={config.email || ""} onChange={event => setConfig({ ...config, email: event.target.value })} /></label>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={!!config.set_cloudflare_strict} onChange={event => setConfig({ ...config, set_cloudflare_strict: event.target.checked })} />Set this Cloudflare zone to Full (strict). This affects all proxied hostnames in the zone and requires Zone Settings Edit.</label>
          <p className="text-xs text-text-muted">Otherwise select Full (strict) in Cloudflare yourself. Apteva creates temporary certificate-validation TXT records; your A/AAAA records stay under your control.</p>
        </>}
        {config.mode === "import" && <>
          <label className="block text-xs">Certificate chain (PEM)<textarea className={`${fieldClass} mt-1 font-mono`} rows={4} value={cert} onChange={event => setCert(event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" /></label>
          <label className="block text-xs">Matching private key (PEM)<textarea className={`${fieldClass} mt-1 font-mono`} autoComplete="off" rows={3} value={key} onChange={event => setKey(event.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" /></label>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={!!config.trust_cloudflare} onChange={event => setConfig({ ...config, trust_cloudflare: event.target.checked })} />This hostname is proxied through Cloudflare; trust its published proxy IP ranges.</label>
          <p className="text-xs text-text-muted">Origin CA certificates work behind Cloudflare with Full (strict), but browsers do not trust them directly. Imported certificates need manual replacement before expiry.</p>
        </>}
        {(config.mode === "proxy" || config.mode === "import") && !config.trust_cloudflare && <label className="block text-xs">Trusted proxy CIDRs (if applicable)<input className={`${fieldClass} mt-1`} value={proxies} onChange={event => setProxies(event.target.value)} placeholder="10.0.0.5/32, 2001:db8::5/128" /><span className="mt-1 block text-text-muted">Loopback proxies are already trusted. Remote proxies must preserve Host and send X-Forwarded-Proto: https.</span></label>}
      </>}
      {step === 2 && <>
        <p className="text-sm font-semibold break-all">https://{config.hostname}</p><p className="text-xs text-text-muted">{modes.find(mode => mode.id === config.mode)?.description} Your current public URL remains active until verification succeeds.</p>
        {needsTerms && <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={!!config.accept_acme_terms} onChange={event => setConfig({ ...config, accept_acme_terms: event.target.checked })} /><span>I agree to the certificate authority’s terms. The default authority is <a href="https://letsencrypt.org/repository/" className="text-accent underline" target="_blank" rel="noreferrer">Let’s Encrypt</a>.</span></label>}
        {config.mode !== "proxy" && <details className="text-xs"><summary className="cursor-pointer text-text-muted">Advanced listener ports</summary><div className="mt-3 grid grid-cols-2 gap-3"><label>HTTP<input type="number" min={1} max={65535} className={`${fieldClass} mt-1`} value={config.http_port || 80} onChange={event => setConfig({ ...config, http_port: Number(event.target.value) })} /></label><label>HTTPS<input type="number" min={1} max={65535} className={`${fieldClass} mt-1`} value={config.https_port || 443} onChange={event => setConfig({ ...config, https_port: Number(event.target.value) })} /></label></div><p className="mt-2 text-text-muted">If using higher local ports, map public ports 80/443 to them. Router and firewall rules are managed separately.</p></details>}
      </>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || !config.hostname.trim() || step === 2 && needsTerms && !config.accept_acme_terms} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-bg disabled:opacity-50">{saving ? "Starting…" : step === 2 ? "Verify and activate HTTPS" : "Continue"}</button>{step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg border border-border px-3 py-2 text-xs">Back</button>}<button type="button" onClick={() => { setEditing(false); setToken(""); setKey(""); setCert(""); }} className="px-3 py-2 text-xs text-text-muted">Cancel</button></div>
    </form>}
    {error && <p role="alert" className="break-words text-xs text-red">{error}</p>}
  </section>;
}
