import { useEffect, useState } from "react";

import { security, type SecurityAlert, type SecurityChainStatus, type SecurityOverview as Overview } from "../../../api";
import { Card, ErrorNote, SeverityBadge, StatusPill, buttonClass, errorText, formatTime } from "./shared";

export function SecurityOverviewPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [chain, setChain] = useState<SecurityChainStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const load = () => {
    setError("");
    security.overview().then(setData).catch((err) => setError(errorText(err)));
  };
  useEffect(load, []);

  const verify = async () => {
    setChecking(true);
    try {
      setChain(await security.verifyChain());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <p className="text-sm text-text-muted">Loading…</p>;
  const { audit, inventory, host } = data;
  const srv = inventory.server;

  return (
    <div className="space-y-4">
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Open alerts" value={data.open_alerts} tone={data.open_alerts > 0 ? "bad" : "good"} />
        <Stat label="Denied requests, 24h" value={data.denied_24h} />
        <Stat label="Sign-ins, 24h" value={data.login_events_24h} />
        <Stat label="Admins with MFA" value={`${srv.admins_with_mfa} / ${srv.admins}`} tone={srv.admins_with_mfa < srv.admins ? "warn" : "good"} />
      </div>

      <Card
        title="Audit trail"
        description="A separate, append-only record of sign-ins, credential and permission changes, exports and containment. Each entry is linked to the previous one, so edits and deletions are detectable."
        actions={<button type="button" className={buttonClass} onClick={verify} disabled={checking}>{checking ? "Checking…" : "Verify integrity"}</button>}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {audit.available === false ? <StatusPill tone="bad">Unavailable</StatusPill>
            : audit.degraded ? <StatusPill tone="warn">Degraded</StatusPill> : <StatusPill tone="good">Recording</StatusPill>}
          {audit.forward_enabled ? <StatusPill tone="good">Forwarded off-server</StatusPill> : <StatusPill tone="warn">Kept on this server only</StatusPill>}
          {audit.retention_days ? <span className="text-text-dim">Kept {audit.retention_days} days</span> : null}
        </div>
        {(audit.degraded_reasons?.length ?? 0) > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-yellow">
            {audit.degraded_reasons!.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
        {chain && (
          <p className={`mt-3 text-xs ${chain.ok ? "text-green" : "text-red"}`} role="status">
            {chain.ok ? `Integrity verified across ${chain.checked.toLocaleString()} entries.`
              : `Integrity check failed at entry ${chain.broken_at_seq}: ${chain.reason || "the record was changed or removed"}.`}
          </p>
        )}
      </Card>

      <Card title="SSH access to this machine" description={host.available ? "Logins, key changes and coverage gaps reported by the apteva-host collector." : undefined}>
        {host.available ? (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {host.healthy ? <StatusPill tone="good">Monitored</StatusPill> : <StatusPill tone="warn">Needs attention</StatusPill>}
              {host.health?.hostname && <span className="text-text-dim">{host.health.hostname}</span>}
              {host.health?.last_event_at && <span className="text-text-dim">Last event {formatTime(host.health.last_event_at)}</span>}
            </div>
            {(host.problems?.length ?? 0) > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-yellow">{host.problems!.map((p) => <li key={p}>{p}</li>)}</ul>
            )}
          </div>
        ) : (
          <div className="space-y-1 text-xs">
            <StatusPill tone="warn">Not monitored</StatusPill>
            <p className="text-text-muted">{host.reason}</p>
          </div>
        )}
      </Card>

      <Card title="Findings" description="Configuration that weakens this server's security posture.">
        {inventory.findings.length === 0 ? <p className="text-xs text-green">No findings.</p> : (
          <ul className="space-y-2 text-xs">
            {inventory.findings.map((f) => (
              <li key={f} className="flex gap-2 text-text"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow" aria-hidden="true" /><span>{f}</span></li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid grid-cols-[minmax(150px,auto)_1fr] gap-x-4 gap-y-1.5 border-t border-border pt-4 text-xs">
          {(srv.listeners || []).map((l) => (<Row key={l.name + l.address} label={l.name} value={<>{l.address} {l.public ? <StatusPill tone="warn">Public</StatusPill> : <StatusPill tone="neutral">Loopback</StatusPill>}</>} />))}
          <Row label="App environment" value={srv.child_env_mode === "inherit" ? "Inherits server environment" : "Allowlist"} />
          <Row label="App OS users" value={srv.app_isolation === "uid" ? "Separate user per app" : srv.app_isolation === "unavailable" ? "Requested, unavailable on this host" : "Off"} />
          <Row label="Password re-check" value={`Every ${srv.privileged_reauth_minutes} minute${srv.privileged_reauth_minutes === 1 ? "" : "s"} for privileged actions`} />
          <Row label="Active sessions / API keys" value={`${srv.active_sessions} / ${srv.active_api_keys}`} />
          <Row label="Disabled accounts" value={String(srv.disabled_users)} />
        </dl>
      </Card>

      <Card title="What the evidence covers" description="So an investigation does not assume evidence that does not exist.">
        <div className="space-y-3 text-xs">
          {data.evidence_coverage.map((c) => (
            <div key={c.source} className="grid gap-1 sm:grid-cols-[180px_1fr]">
              <div className="font-semibold text-text">{c.source}</div>
              <div className="space-y-0.5 text-text-muted">
                <p><span className="text-text-dim">Shows: </span>{c.proves}</p>
                <p><span className="text-text-dim">Does not show: </span>{c.does_not_prove}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "bad" ? "text-red" : tone === "warn" ? "text-yellow" : "text-text";
  return (
    <div className="rounded-lg border border-border bg-bg-card px-4 py-3">
      <div className={`text-lg font-bold ${color}`}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (<><dt className="capitalize text-text-muted">{label}</dt><dd className="flex flex-wrap items-center gap-2 text-text">{value}</dd></>);
}

export function SecurityAlertsPanel() {
  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    security.alerts(openOnly).then(setAlerts).catch((err) => setError(errorText(err)));
  };
  useEffect(load, [openOnly]);

  const acknowledge = async (id: number) => {
    try {
      await security.acknowledgeAlert(id);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Card
      title="Alerts"
      description="Raised by fixed rules as events are recorded: new sign-in sources, failed-login bursts, credential reveals, role changes, refused privileged actions, containment and SSH findings."
      actions={(
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={!openOnly} onChange={(e) => setOpenOnly(!e.target.checked)} />
          Include acknowledged
        </label>
      )}
    >
      <ErrorNote error={error} />
      {!alerts ? <p className="text-sm text-text-muted">Loading…</p> : alerts.length === 0 ? (
        <p className="text-xs text-text-muted">{openOnly ? "No open alerts." : "No alerts recorded."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
              <SeverityBadge severity={a.severity} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">{a.message}</p>
                <p className="mt-0.5 text-[11px] text-text-dim">
                  {a.rule} · {formatTime(a.created_at)}
                  {a.delivery_error ? ` · webhook: ${a.delivery_error}` : a.delivered_at ? " · delivered" : ""}
                  {a.acknowledged_at ? ` · acknowledged ${formatTime(a.acknowledged_at)}` : ""}
                </p>
              </div>
              {!a.acknowledged_at && <button type="button" className={buttonClass} onClick={() => acknowledge(a.id)}>Acknowledge</button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
