import { useEffect, useState } from "react";

import {
  adminUsers, security,
  type AdminUser, type ContainmentReport, type ContainmentResult,
} from "../../../api";
import { useAuth } from "../../../hooks/useAuth";
import { Card, ErrorNote, StatusPill, buttonClass, dangerButtonClass, errorText, formatTime, inputClass } from "./shared";

// Wording for each per-target containment outcome the server reports.
export const CONTAINMENT_STATUS: Record<string, { label: string; tone: "good" | "bad" | "warn" | "neutral" }> = {
  revoked: { label: "Revoked", tone: "good" },
  disabled_locally: { label: "Disabled", tone: "good" },
  already_inactive: { label: "Already inactive", tone: "neutral" },
  kept: { label: "Kept", tone: "neutral" },
  unsupported: { label: "Not supported", tone: "warn" },
  unconfirmed: { label: "Not confirmed", tone: "warn" },
  error: { label: "Failed", tone: "bad" },
};

export function SecurityContainmentPanel() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userID, setUserID] = useState<number>(0);
  const [report, setReport] = useState<ContainmentReport | null>(null);
  const [error, setError] = useState("");

  const loadUsers = () => adminUsers.list().then(setUsers).catch((err) => setError(errorText(err)));
  useEffect(() => { loadUsers(); }, []);

  // A refresh after an action keeps the current report on screen so the
  // action's outcome stays visible; switching accounts starts blank.
  const loadReport = (id: number, refresh = false) => {
    if (!refresh) setReport(null);
    setError("");
    if (!id) return;
    security.containment(id).then(setReport).catch((err) => setError(errorText(err)));
  };
  useEffect(() => loadReport(userID), [userID]);

  const selected = users.find((u) => u.id === userID);
  const isSelf = !!(me && selected && me.id === selected.id);

  return (
    <div className="space-y-4">
      <Card
        title="Contain an account"
        description="See everything an account can still use, then revoke it. Sessions, API keys, delegated keys and app callbacks of a disabled account stop working immediately."
      >
        <label className="block max-w-md">
          <span className="text-xs font-semibold text-text-muted">Account</span>
          <select aria-label="Account" className={`mt-1.5 ${inputClass}`} value={userID || ""} onChange={(e) => setUserID(Number(e.target.value) || 0)}>
            <option value="">Choose an account…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.email} (#{u.id}){u.role === "admin" ? " · admin" : ""}{u.disabled_at ? " · disabled" : ""}</option>
            ))}
          </select>
        </label>
        <div className="mt-3"><ErrorNote error={error} /></div>
      </Card>

      {selected && report && (
        <>
          <ExposureCard report={report} />
          <ActionsCard
            key={selected.id}
            user={selected}
            isSelf={isSelf}
            report={report}
            onDone={() => { loadReport(selected.id, true); loadUsers(); }}
          />
        </>
      )}
    </div>
  );
}

function ExposureCard({ report }: { report: ContainmentReport }) {
  return (
    <Card title="What this account can use" description={`As of ${formatTime(report.generated_at)}.`}>
      <div className="space-y-5 text-xs">
        <section>
          <h4 className="mb-2 font-semibold text-text">Signed-in sessions ({report.sessions.length})</h4>
          {report.sessions.length === 0 ? <p className="text-text-dim">None active.</p> : (
            <ul className="space-y-1.5">
              {report.sessions.map((s) => (
                <li key={s.ref} className="flex flex-wrap gap-x-3 text-text-muted">
                  <span className="font-mono text-text">{s.ref}</span>
                  <span>from {s.created_ip || "unknown"} · {formatTime(s.created_at)}</span>
                  {s.last_seen_at && <span>last seen {formatTime(s.last_seen_at)}{s.last_seen_ip ? ` from ${s.last_seen_ip}` : ""}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4 className="mb-2 font-semibold text-text">API keys ({report.api_keys.length})</h4>
          {report.api_keys.length === 0 ? <p className="text-text-dim">None active.</p> : (
            <ul className="space-y-1.5">
              {report.api_keys.map((k) => (
                <li key={k.id} className="flex flex-wrap gap-x-3 text-text-muted">
                  <span className="text-text">{k.name || "Unnamed"}</span>
                  <span className="font-mono">{k.key_prefix}…</span>
                  <span>{k.kind}</span>
                  {k.last_used && <span>used {formatTime(k.last_used)}{k.last_used_ip ? ` from ${k.last_used_ip}` : ""}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        {report.fleet_tenants.length > 0 && (
          <section>
            <h4 className="mb-2 font-semibold text-text">Fleet tenants ({report.fleet_tenants.length})</h4>
            <ul className="space-y-1.5">
              {report.fleet_tenants.map((t) => (
                <li key={t.tenant_id} className="flex flex-wrap items-center gap-x-3 text-text-muted">
                  <span className="text-text">{t.slug || t.tenant_id}</span>
                  {t.version && <span>v{t.version}</span>}
                  <StatusPill tone={CONTAINMENT_STATUS[t.status]?.tone || "warn"}>{CONTAINMENT_STATUS[t.status]?.label || t.status}</StatusPill>
                  {t.detail && <span className="text-text-dim">{t.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {report.coverage_gaps.length > 0 && (
          <section className="rounded-lg border border-yellow/30 bg-yellow/10 p-3">
            <h4 className="mb-1 font-semibold text-yellow">Not covered automatically</h4>
            <ul className="list-disc space-y-1 pl-5 text-text-muted">{report.coverage_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
          </section>
        )}
      </div>
    </Card>
  );
}

function ActionsCard({ user, isSelf, report, onDone }: { user: AdminUser; isSelf: boolean; report: ContainmentReport; onDone: () => void }) {
  const [sessions, setSessions] = useState(true);
  const [apiKeys, setAPIKeys] = useState(true);
  const [keep, setKeep] = useState<number[]>([]);
  const [disable, setDisable] = useState(!isSelf);
  const [fleet, setFleet] = useState(report.fleet_tenants.length > 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ContainmentResult | null>(null);

  const toggleKeep = (id: number) => setKeep(keep.includes(id) ? keep.filter((k) => k !== id) : [...keep, id]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await security.revoke({
        user_id: user.id, sessions, api_keys: apiKeys, keep_key_ids: keep,
        disable_user: disable && !isSelf, include_fleet: fleet, reason: reason.trim(),
      });
      setResult(res);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      await security.enableUser(user.id);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Revoke access"
      description="Your password will be re-checked if you have not confirmed it recently. Every action is recorded with your account and the reason."
      actions={user.disabled_at ? <button type="button" className={buttonClass} onClick={enable} disabled={busy}>Re-enable account</button> : undefined}
    >
      {user.disabled_at && <p className="mb-3 text-xs text-yellow">This account was disabled {formatTime(user.disabled_at)}.</p>}
      <form onSubmit={run} className="space-y-3 text-xs">
        <Check checked={sessions} onChange={setSessions} label={isSelf ? "Sign out all my other sessions (this one stays)" : "Sign out every session"} />
        <Check checked={apiKeys} onChange={setAPIKeys} label="Revoke API keys" />
        {apiKeys && report.api_keys.length > 0 && (
          <fieldset className="ml-6 space-y-1">
            <legend className="mb-1 text-text-dim">Keep these keys:</legend>
            {report.api_keys.map((k) => (
              <Check key={k.id} checked={keep.includes(k.id)} onChange={() => toggleKeep(k.id)} label={`${k.name || "Unnamed"} (${k.key_prefix}…)`} />
            ))}
          </fieldset>
        )}
        {!isSelf && <Check checked={disable} onChange={setDisable} label="Disable the account (blocks new sign-ins and every remaining credential)" />}
        {report.fleet_tenants.length > 0 && <Check checked={fleet} onChange={setFleet} label="Include Fleet tenants in the report" />}
        <label className="block">
          <span className="font-semibold text-text-muted">Reason</span>
          <input className={`mt-1.5 ${inputClass}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. suspicious sign-in from an unknown address" required disabled={busy} />
        </label>
        <ErrorNote error={error} />
        <div className="flex justify-end">
          <button type="submit" className={dangerButtonClass} disabled={busy || !reason.trim() || (!sessions && !apiKeys && !disable)}>
            {busy ? "Revoking…" : "Revoke access"}
          </button>
        </div>
      </form>
      {result && <ContainmentOutcome result={result} />}
    </Card>
  );
}

export function ContainmentOutcome({ result }: { result: ContainmentResult }) {
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs" role="status">
      {result.complete ? (
        <p className="font-semibold text-green">Containment complete.</p>
      ) : (
        <p className="font-semibold text-yellow">Containment is incomplete. Review the items below that were not confirmed.</p>
      )}
      <ul className="space-y-1">
        {result.results.map((r, i) => {
          const s = CONTAINMENT_STATUS[r.status] || { label: r.status, tone: "neutral" as const };
          return (
            <li key={`${r.scope}:${r.target}:${i}`} className="flex flex-wrap items-center gap-2 text-text-muted">
              <StatusPill tone={s.tone}>{s.label}</StatusPill>
              <span className="text-text">{r.scope}</span>
              <span className="font-mono">{r.target}</span>
              {r.detail && <span className="text-text-dim">{r.detail}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2 text-text">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
