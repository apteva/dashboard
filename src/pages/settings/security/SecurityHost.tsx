import { useEffect, useState } from "react";

import { security, type SSHPolicy, type SecurityHostStatus } from "../../../api";
import { Card, ErrorNote, StatusPill, buttonClass, errorText, formatTime, inputClass, primaryButtonClass } from "./shared";

export function linesToList(text: string): string[] {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

// Builds the PUT body. The webhook secret is write-only: an empty field keeps
// the stored secret, so it is only sent when the operator typed a new one.
export function policyForSave(base: SSHPolicy, form: PolicyForm): SSHPolicy {
  const next: SSHPolicy = {
    ...base,
    approved_sources: linesToList(form.sources),
    approved_fingerprints: linesToList(form.fingerprints),
    root_login_allowed: form.rootAllowed,
    root_approved_sources: linesToList(form.rootSources),
    failure_burst_threshold: Number(form.burstThreshold) || 0,
    failure_burst_window_seconds: Number(form.burstWindow) || 0,
    alert_webhook_url: form.webhookURL.trim(),
  };
  delete next.alert_webhook_secret_set;
  if (form.webhookSecret.trim()) next.alert_webhook_secret = form.webhookSecret.trim();
  else delete next.alert_webhook_secret;
  return next;
}

export interface PolicyForm {
  sources: string;
  fingerprints: string;
  rootAllowed: boolean;
  rootSources: string;
  burstThreshold: string;
  burstWindow: string;
  webhookURL: string;
  webhookSecret: string;
}

function formFromPolicy(p: SSHPolicy): PolicyForm {
  return {
    sources: (p.approved_sources || []).join("\n"),
    fingerprints: (p.approved_fingerprints || []).join("\n"),
    rootAllowed: !!p.root_login_allowed,
    rootSources: (p.root_approved_sources || []).join("\n"),
    burstThreshold: String(p.failure_burst_threshold || ""),
    burstWindow: String(p.failure_burst_window_seconds || ""),
    webhookURL: p.alert_webhook_url || "",
    webhookSecret: "",
  };
}

export function SecurityHostPanel() {
  const [status, setStatus] = useState<SecurityHostStatus | null>(null);
  const [policy, setPolicy] = useState<SSHPolicy | null>(null);
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    security.host().then((s) => {
      setStatus(s);
      if (s.available) {
        security.hostPolicy().then((p) => { setPolicy(p); setForm(formFromPolicy(p)); }).catch((err) => setError(errorText(err)));
      }
    }).catch((err) => setError(errorText(err)));
  };
  useEffect(load, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy || !form) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const applied = await security.setHostPolicy(policyForSave(policy, form));
      setPolicy(applied);
      setForm(formFromPolicy(applied));
      setSaved("SSH monitoring policy saved.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await security.syncHost();
      setSaved(`Copied ${res.ingested} new SSH event${res.ingested === 1 ? "" : "s"} into the audit trail.`);
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return error ? <ErrorNote error={error} /> : <p className="text-sm text-text-muted">Loading…</p>;
  if (!status.available) {
    return (
      <Card title="SSH access monitoring" description="apteva-host watches SSH logins and authorized_keys changes on this machine and alerts even while the server is down.">
        <div className="space-y-2 text-xs">
          <StatusPill tone="warn">Not monitored</StatusPill>
          <p className="text-text-muted">{status.reason}</p>
        </div>
      </Card>
    );
  }

  const h = status.health || {};
  const set = (key: keyof PolicyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    form && setForm({ ...form, [key]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  return (
    <div className="space-y-4">
      <Card
        title="SSH access monitoring"
        description="Reported by apteva-host: logins (user, source, method, key fingerprint), sessions, authorized_keys changes, and gaps in its own coverage. It does not see commands typed inside a session."
        actions={<button type="button" className={buttonClass} onClick={sync} disabled={busy}>Sync now</button>}
      >
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {status.healthy ? <StatusPill tone="good">Healthy</StatusPill> : <StatusPill tone="warn">Needs attention</StatusPill>}
            {h.hostname && <span className="text-text">{h.hostname}</span>}
            {h.source && <span className="text-text-dim">source: {h.source}</span>}
            {h.heartbeat && <span className="text-text-dim">heartbeat {formatTime(h.heartbeat)}</span>}
            {typeof h.event_count === "number" && <span className="text-text-dim">{h.event_count.toLocaleString()} events</span>}
          </div>
          {(status.problems?.length ?? 0) > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-yellow">{status.problems!.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          {status.ingest?.last_error && <p className="text-red">Copying into the audit trail failed: {status.ingest.last_error}</p>}
        </div>
      </Card>

      {form && (
        <Card title="Policy" description="Logins that break these rules raise alerts. Changes need a recent password confirmation and are recorded.">
          <form onSubmit={save} className="space-y-4 text-xs">
            <div className="grid gap-4 sm:grid-cols-2">
              <Area label="Approved sources" hint="IP addresses or CIDR ranges, one per line" value={form.sources} onChange={set("sources")} />
              <Area label="Approved key fingerprints" hint="SHA256:… one per line; empty allows any key" value={form.fingerprints} onChange={set("fingerprints")} />
            </div>
            <label className="flex items-center gap-2 text-text">
              <input type="checkbox" checked={form.rootAllowed} onChange={set("rootAllowed")} />
              Allow root logins
            </label>
            {form.rootAllowed && <Area label="Root may sign in from" hint="Empty means any approved source" value={form.rootSources} onChange={set("rootSources")} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Failed attempts before alerting" value={form.burstThreshold} onChange={set("burstThreshold")} type="number" />
              <Field label="Within (seconds)" value={form.burstWindow} onChange={set("burstWindow")} type="number" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Alert webhook URL" value={form.webhookURL} onChange={set("webhookURL")} placeholder="https://…" />
              <Field
                label="Webhook signing secret"
                value={form.webhookSecret}
                onChange={set("webhookSecret")}
                type="password"
                placeholder={policy?.alert_webhook_secret_set ? "Saved — leave empty to keep" : "Optional"}
              />
            </div>
            <ErrorNote error={error} />
            {saved && <p className="text-green" role="status">{saved}</p>}
            <div className="flex justify-end">
              <button type="submit" className={primaryButtonClass} disabled={busy}>{busy ? "Saving…" : "Save policy"}</button>
            </div>
          </form>
        </Card>
      )}
      {!form && <ErrorNote error={error} />}
    </div>
  );
}

function Area({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void }) {
  return (
    <label className="block">
      <span className="font-semibold text-text-muted">{label}</span>
      <textarea rows={4} className={`mt-1.5 font-mono ${inputClass}`} value={value} onChange={onChange} spellCheck={false} />
      <span className="mt-1 block text-[11px] text-text-dim">{hint}</span>
    </label>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="font-semibold text-text-muted">{label}</span>
      <input type={type} className={`mt-1.5 ${inputClass}`} value={value} onChange={onChange} placeholder={placeholder} autoComplete="off" />
    </label>
  );
}
