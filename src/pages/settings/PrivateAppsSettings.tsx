import { useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { apps, privateApps, type AppPreflight, type AppRow, type MarketplaceEntry, type PrivateInstall } from "../../api";
import { Modal } from "../../components/Modal";
import { GuidedAppSetup } from "../../components/apps/GuidedAppSetup";
import { AppDeploymentPanel } from "../../components/apps/AppDeploymentPanel";
import { useProjects } from "../../hooks/useProjects";

// Private installations are ordinary installs of an app that serve only the
// apps an administrator allows. They never appear in projects, agent tools or
// the Helper, so this screen is where they are installed and managed.

type Dialog =
  | { kind: "install" }
  | { kind: "callers"; app: PrivateInstall }
  | { kind: "configure"; app: PrivateInstall }
  | { kind: "details"; app: PrivateInstall }
  | null;

const button = "min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-text hover:border-accent disabled:opacity-50";
const primary = "min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-50";
const input = "mt-1 min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 text-sm text-text focus:border-accent focus:outline-none";
const busyStatuses = ["pending", "installing", "starting", "upgrading"];

function message(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

function iconSrc(icon?: string) {
  return icon?.startsWith("https://") ? icon : undefined;
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
    <h3 className="min-w-0 text-base font-bold text-text">{title}</h3>
    <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-hover hover:text-text">×</button>
  </div>;
}

export function PrivateAppsSettings() {
  const { projects } = useProjects();
  const [list, setList] = useState<PrivateInstall[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const projectName = (id: string) => id ? projects.find(p => p.id === id)?.name || id : "Shared across projects";

  const load = async () => {
    try { setList(await privateApps.list()); setError(""); }
    catch (e) { setError(message(e, "Could not load private apps")); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!list?.some(a => busyStatuses.includes(a.status))) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [list]);

  const run = async (app: PrivateInstall, action: () => Promise<unknown>, done: string) => {
    setBusy(app.install_id); setError(""); setNotice("");
    try { await action(); setNotice(done); await load(); }
    catch (e) { setError(message(e, "Action failed")); }
    finally { setBusy(null); }
  };
  const label = (app: PrivateInstall) => `${app.display_name}${app.installation_name ? ` · ${app.installation_name}` : ""}`;
  const upgrade = (app: PrivateInstall) => run(app, async () => {
    try { await apps.upgrade(app.install_id); }
    catch (e) {
      if (!/permission/i.test(message(e, ""))) throw e;
      if (!window.confirm(`${message(e, "The new version asks for more permissions.")}\n\nApprove the new permissions and update?`)) return;
      await apps.upgrade(app.install_id, { approveNewPermissions: true });
    }
  }, `${label(app)} update started.`);
  const toggle = (app: PrivateInstall) => run(app, () => apps.setStatus(app.install_id, app.status === "running" ? "disabled" : "running"), app.status === "running" ? `${label(app)} stopped.` : `${label(app)} starting.`);
  const uninstall = (app: PrivateInstall) => {
    if (!window.confirm(`Uninstall ${label(app)}? This removes the installation and its data, and the apps that call it lose access.`)) return;
    void run(app, () => apps.uninstall(app.install_id), `${label(app)} uninstalled.`);
  };

  return <div className="w-full space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-text">Private apps</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Installations that serve only the apps you allow, such as a Messaging install behind a customer API. They have their own data, settings and connections, and they never appear in projects, agent tools or the Helper.</p>
      </div>
      <button type="button" className={primary} onClick={() => setDialog({ kind: "install" })}>Install private app</button>
    </div>

    <div className="rounded-lg border border-border bg-bg-card p-4 text-sm text-text-muted">
      Allowed apps call a private installation by its installation ID, for example <code className="text-text">install_id</code> in a Functions call. A private installation can only call other private installations that allow it.
    </div>

    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {notice && <p role="status" className="text-sm text-text-muted">{notice}</p>}

    {list === null ? <p className="text-sm text-text-muted">Loading…</p> : list.length === 0 ? (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">No private apps yet.</div>
    ) : <ul className="space-y-3">
      {list.map(app => <li key={app.install_id} className="rounded-lg border border-border bg-bg-card p-4">
        <div className="flex min-w-0 items-start gap-3">
          <AppIcon name={app.display_name} src={iconSrc(app.icon)} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-text">{app.display_name}</span>
              {app.installation_name && <span className="text-sm text-text-muted">{app.installation_name}</span>}
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              ID {app.install_id} · {projectName(app.project_id)}{app.version ? ` · v${app.version}` : ""} · <span className={app.status === "running" ? "text-success" : app.status === "error" ? "text-error" : "text-warn"}>{app.status}</span>
            </p>
            {(app.error_message || app.status_message) && <p className="mt-1 break-words text-xs text-text-muted">{app.error_message || app.status_message}</p>}
            <p className="mt-2 text-xs text-text-muted">
              {app.callers.length ? <>Allowed: {app.callers.map(c => <span key={c.install_id} className="mr-1 inline-block rounded border border-border px-1.5 py-0.5 text-text">{c.app}{c.installation_name ? ` · ${c.installation_name}` : ""} (ID {c.install_id})</span>)}</> : "No apps allowed yet. Nothing can call it."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy === app.install_id} onClick={() => setDialog({ kind: "callers", app })}>Allowed apps</button>
          <button type="button" className={button} disabled={busy === app.install_id} onClick={() => setDialog({ kind: "configure", app })}>Configure</button>
          <button type="button" className={button} disabled={busy === app.install_id} onClick={() => setDialog({ kind: "details", app })}>Status</button>
          <button type="button" className={button} disabled={busy === app.install_id} onClick={() => void upgrade(app)}>Update</button>
          <button type="button" className={button} disabled={busy === app.install_id} onClick={() => void toggle(app)}>{app.status === "running" ? "Stop" : "Start"}</button>
          <button type="button" className={`${button} hover:border-red hover:text-red`} disabled={busy === app.install_id} onClick={() => uninstall(app)}>Uninstall</button>
        </div>
      </li>)}
    </ul>}

    {dialog?.kind === "install" && <InstallDialog projects={projects} onInstalled={() => void load()} onClose={() => { setDialog(null); void load(); }} />}
    {dialog?.kind === "callers" && <CallersDialog app={dialog.app} privateInstalls={list || []} projectName={projectName} onSaved={() => { setNotice(`Allowed apps saved for ${label(dialog.app)}.`); void load(); }} onClose={() => setDialog(null)} />}
    {dialog?.kind === "configure" && <Modal open onClose={() => { setDialog(null); void load(); }} width="max-w-3xl" ariaLabel="Configure private app">
      <DialogHeader title={`Configure ${label(dialog.app)}`} onClose={() => { setDialog(null); void load(); }} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><GuidedAppSetup privateInstall installId={dialog.app.install_id} projectId={dialog.app.project_id} onDone={() => { setDialog(null); void load(); }} /></div>
    </Modal>}
    {dialog?.kind === "details" && <Modal open onClose={() => setDialog(null)} width="max-w-3xl" ariaLabel="Private app status">
      <DialogHeader title={label(dialog.app)} onClose={() => setDialog(null)} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text-muted">Installation ID</dt><dd className="text-text">{dialog.app.install_id}</dd>
          <dt className="text-text-muted">Key</dt><dd className="text-text">{dialog.app.installation_key}</dd>
          <dt className="text-text-muted">Scope</dt><dd className="text-text">{projectName(dialog.app.project_id)}</dd>
          <dt className="text-text-muted">Status</dt><dd className="text-text">{dialog.app.status}</dd>
          {(dialog.app.error_message || dialog.app.status_message) && <><dt className="text-text-muted">Message</dt><dd className="break-words text-text">{dialog.app.error_message || dialog.app.status_message}</dd></>}
        </dl>
        <AppDeploymentPanel installId={dialog.app.install_id} projectId={dialog.app.project_id} />
        <p className="text-xs text-text-muted">Apps that run on this server write their output to the server log. Apps on a backend show their logs above.</p>
      </div>
    </Modal>}
  </div>;
}

function InstallDialog({ projects, onInstalled, onClose }: { projects: { id: string; name: string }[]; onInstalled: () => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketplaceEntry[] | null>(null);
  const [entry, setEntry] = useState<MarketplaceEntry | null>(null);
  const [manifestURL, setManifestURL] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [installationName, setInstallationName] = useState("");
  const [installationKey, setInstallationKey] = useState("private");
  const [preflight, setPreflight] = useState<AppPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef<() => boolean>(() => true);
  const close = () => { if (guard.current()) onClose(); };

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await apps.marketplace(undefined, undefined, { query, pageSize: 24 });
        if (live) setResults(res.apps.filter(a => !a.deprecated));
      } catch (e) { if (live) setError(message(e, "Could not load the marketplace")); }
    }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query]);

  const choose = (e: MarketplaceEntry) => {
    setEntry(e); setManifestURL(e.manifest_url);
    setInstallationName(`${e.display_name || e.name} (private)`);
  };
  const next = async () => {
    setBusy(true); setError("");
    try { setPreflight(await apps.preflight(manifestURL.trim(), undefined, projectId)); }
    catch (e) { setError(message(e, "Could not read this app")); }
    finally { setBusy(false); }
  };

  return <Modal open onClose={close} width="max-w-3xl" ariaLabel="Install private app">
    <DialogHeader title="Install private app" onClose={close} />
    {preflight ? <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <GuidedAppSetup privateInstall onExitGuard={g => { guard.current = g; }} preflight={preflight} manifestURL={manifestURL.trim()} projectId={projectId} installationKey={installationKey} installationName={installationName} onInstalled={onInstalled} onDone={onClose} />
    </div> : <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
      <label className="block text-sm text-text-muted">Find an app
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Messaging, Storage…" className={input} />
      </label>
      <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
        {results === null ? <p className="text-sm text-text-muted">Loading…</p> : results.map(a => <button key={a.manifest_url} type="button" onClick={() => choose(a)} aria-pressed={entry?.manifest_url === a.manifest_url}
          className={`flex min-h-11 items-center gap-2 rounded-lg border p-2 text-left text-sm ${entry?.manifest_url === a.manifest_url ? "border-accent bg-accent/10" : "border-border hover:border-accent"}`}>
          <AppIcon name={a.display_name || a.name} src={iconSrc(a.icon)} size="sm" />
          <span className="min-w-0"><span className="block truncate font-medium text-text">{a.display_name || a.name}</span><span className="block truncate text-xs text-text-muted">{a.description}</span></span>
        </button>)}
      </div>
      <label className="block text-sm text-text-muted">Manifest URL
        <input value={manifestURL} onChange={e => { setManifestURL(e.target.value); setEntry(null); }} placeholder="https://…/apteva.yaml" className={`${input} font-mono`} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm text-text-muted">Project
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className={input}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="">Shared across projects</option>
          </select>
        </label>
        <label className="block text-sm text-text-muted">Name
          <input value={installationName} onChange={e => setInstallationName(e.target.value)} maxLength={100} className={input} />
        </label>
        <label className="block text-sm text-text-muted">Key
          <input value={installationKey} onChange={e => setInstallationKey(e.target.value)} pattern="[a-z][a-z0-9-]{0,39}" maxLength={40} className={input} />
        </label>
      </div>
      <p className="text-xs text-text-muted">The installation starts with fresh data. Use a different key for each private installation of the same app in one place.</p>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={busy || !manifestURL.trim() || !/^[a-z][a-z0-9-]{0,39}$/.test(installationKey)} onClick={() => void next()}>{busy ? "Loading…" : "Continue"}</button>
      </div>
    </div>}
  </Modal>;
}

function CallersDialog({ app, privateInstalls, projectName, onSaved, onClose }: { app: PrivateInstall; privateInstalls: PrivateInstall[]; projectName: (id: string) => string; onSaved: () => void; onClose: () => void }) {
  const [installs, setInstalls] = useState<AppRow[] | null>(null);
  const [selected, setSelected] = useState<number[]>(app.callers.map(c => c.install_id));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    apps.list().then(setInstalls).catch(e => setError(message(e, "Could not load installed apps")));
  }, []);
  type Option = { id: number; name: string; detail: string; private?: boolean };
  const options = useMemo<Option[]>(() => {
    const out: Option[] = (installs || []).map(i => ({ id: i.install_id, name: i.display_name || i.name, detail: `${i.installation_name ? `${i.installation_name} · ` : ""}${projectName(i.project_id)}` }));
    for (const p of privateInstalls) if (p.install_id !== app.install_id) out.push({ id: p.install_id, name: p.display_name, detail: `${p.installation_name ? `${p.installation_name} · ` : ""}${projectName(p.project_id)} · private`, private: true });
    const known = new Set(out.map(o => o.id));
    for (const c of app.callers) if (!known.has(c.install_id)) out.push({ id: c.install_id, name: c.app, detail: c.installation_name || "" });
    const q = filter.trim().toLowerCase();
    return out.filter(o => !q || `${o.name} ${o.detail} ${o.id}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }, [installs, privateInstalls, app, filter, projectName]);
  const save = async () => {
    setBusy(true); setError("");
    try { await privateApps.setCallers(app.install_id, selected); onSaved(); onClose(); }
    catch (e) { setError(message(e, "Could not save allowed apps")); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={() => { if (!busy) onClose(); }} width="max-w-xl" ariaLabel="Allowed apps">
    <DialogHeader title={`Apps allowed to call ${app.display_name}`} onClose={() => { if (!busy) onClose(); }} />
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
      <p className="text-sm text-text-muted">Only these installations can call installation {app.install_id}. They reach it by its ID; looking it up by app name never finds it.</p>
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter installed apps" aria-label="Filter installed apps" className={input} />
      {installs === null && !error ? <p className="text-sm text-text-muted">Loading…</p> : <ul className="space-y-1">
        {options.map(o => <li key={o.id}><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 hover:border-accent">
          <input type="checkbox" className="size-4 accent-accent" checked={selected.includes(o.id)} onChange={e => setSelected(old => e.target.checked ? [...old, o.id] : old.filter(id => id !== o.id))} />
          <span className="min-w-0"><span className="block text-sm text-text">{o.name} <span className="text-text-muted">· ID {o.id}</span></span><span className="block truncate text-xs text-text-muted">{o.detail}</span></span>
        </label></li>)}
      </ul>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={busy || installs === null} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  </Modal>;
}
