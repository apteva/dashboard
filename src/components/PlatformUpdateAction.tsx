import { useEffect, useRef, useState } from "react";
import { platform, type PlatformStatus, type PlatformUpdateStatus } from "../api";
import { useAuth } from "../hooks/useAuth";

const terminal = new Set(["succeeded", "failed", "rolled_back", "recovery_required"]);
const phases: Record<string, string> = {
  queued: "Preparing", preparing: "Preparing", downloading: "Downloading",
  verifying: "Verifying", preflight: "Checking database", activating: "Activating",
  restarting: "Reconnecting", rolling_back: "Restoring previous version",
  succeeded: "Updated", failed: "Update failed", rolled_back: "Previous version restored",
  recovery_required: "Recovery required",
};

export function PlatformUpdateAction({ status }: { status: PlatformStatus }) {
  const { user } = useAuth();
  const isAdmin = !!user && user.role === "admin";
  const [view, setView] = useState<PlatformUpdateStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState("restart");
  const reloadScheduled = useRef(false);
  const job = view?.job;
  const active = !!job && !terminal.has(job.state);
  const stale = active && Date.now() - new Date(job.updated_at).getTime() > 120_000;

  useEffect(() => {
    if (!isAdmin) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await platform.updateStatus();
        if (!stopped) { setView(next); setDisconnected(false); }
      } catch {
        if (!stopped) setDisconnected(true);
      } finally {
        if (!stopped) timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [isAdmin]);

  useEffect(() => {
    if (job?.state !== "succeeded" || reloadScheduled.current) return;
    const key = `apteva:platform-update:${job.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch { return; }
    reloadScheduled.current = true;
    const timer = setTimeout(() => {
      try { sessionStorage.setItem(key, "reloaded"); } catch { return; }
      window.location.reload();
    }, 1500);
    return () => { clearTimeout(timer); reloadScheduled.current = false; };
  }, [job?.id, job?.state]);

  async function start() {
    if (!status.bundle_version || submitting || active) return;
    setSubmitting(true); setError("");
    try { setView(await platform.update(status.bundle_version, policy)); }
    catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the update.");
      // A lost HTTP response doesn't imply the job failed to start.
      try { setView(await platform.updateStatus()); } catch { setDisconnected(true); }
    } finally { setSubmitting(false); }
  }

  if (!isAdmin) return <p className="mb-4 text-xs text-text-muted">An instance administrator can install platform updates.</p>;
  return <section className="mb-4 space-y-3" aria-label="Install platform update">
    {job && <div className="rounded-lg border border-border p-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium">
        {active && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true" />}
        <span>{phases[job.state] || job.state}</span>
        <span className="ml-auto text-xs text-text-muted">v{job.target_version}</span>
      </div>
      <p className="mt-2 break-words text-xs text-text-muted">{job.message}</p>
      {job.state === "succeeded" && <button type="button" className="mt-2 text-xs text-accent hover:underline" onClick={() => window.location.reload()}>Reload dashboard</button>}
      {stale && <p className="mt-2 text-xs text-yellow">The updater has stopped reporting progress. Check the service and platform-update.log on the host before retrying.</p>}
    </div>}
    {disconnected && <p role="status" className="text-xs text-yellow">{active ? "Waiting for the server to reconnect… You can leave this page and return to check progress." : "Could not reach the updater. Retrying…"}</p>}
    {!view && !disconnected && <p className="text-xs text-text-muted">Checking update support…</p>}
    {view?.reason && <p className="text-xs text-text-muted">{view.reason}</p>}
    {view?.supported && status.update_available && !active && job?.state !== "recovery_required" && !(job?.state === "succeeded" && job.target_version === status.bundle_version) && <>
      <label className="block text-xs font-medium" htmlFor="update-agent-policy">Running agents</label>
      <select id="update-agent-policy" value={policy} onChange={event => setPolicy(event.target.value)} disabled={submitting} className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text">
        <option value="restart">Restart agents with the new Core</option>
        <option value="rolling">Update agents gradually</option>
        <option value="preserve">Keep agents on their current Core</option>
      </select>
      <p className="text-xs text-text-muted">{policy === "restart" ? "Running agent work may be interrupted. Agents restart on the new version." : policy === "rolling" ? "Agents update in sequence after the server returns. Each agent restarts during its update." : "Agents continue using their existing Core version and can be updated separately."} The dashboard will briefly disconnect while the server restarts.</p>
      <button type="button" disabled={submitting || disconnected} onClick={() => void start()} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {submitting ? "Starting update…" : `Update to v${status.bundle_version} and restart`}
      </button>
    </>}
    {error && <p role="alert" className="break-words text-xs text-red">{error}</p>}
  </section>;
}
