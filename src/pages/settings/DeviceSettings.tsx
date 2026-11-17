import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { devices, instances, projects as projectsAPI, type AccountDevice, type Agent, type Project, type DevicePairingRequest } from "../../api";

import { DeviceAgentSettings } from "./DeviceAgentSettings";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text";
const buttonClass = "min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text hover:border-accent disabled:opacity-50";

function DeviceDefaults({ projectID, agentID, setProject, setAgent, projects, agents }: {
  projectID: string; agentID: string; setProject: (id: string) => void; setAgent: (id: string) => void;
  projects: Project[]; agents: Agent[];
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-xs text-text-muted">Default project
      <select className={inputClass} value={projectID} onChange={event => { setProject(event.target.value); setAgent(""); }}>
        <option value="">No default project</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </label>
    <label className="space-y-1 text-xs text-text-muted">Default agent
      <select className={inputClass} value={agentID} onChange={event => setAgent(event.target.value)}>
        <option value="">Choose on device</option>
        {agents.filter(agent => (agent.project_id || "") === projectID).map(agent => <option key={agent.id} value={String(agent.id)}>{agent.name}</option>)}
      </select>
    </label>
  </div>;
}

function DeviceRow({ device, projects, agents, reload }: { device: AccountDevice; projects: Project[]; agents: Agent[]; reload: () => Promise<void> }) {
  const [showAccess, setShowAccess] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [projectID, setProject] = useState(device.project_id);
  const [agentID, setAgent] = useState(device.agent_id);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const edit = () => { setName(device.name); setProject(device.project_id); setAgent(device.agent_id); setError(""); setEditing(true); };
  const save = async () => {
    setBusy(true); setError("");
    try { await devices.update(device.id, { name, project_id: projectID, agent_id: agentID }); setEditing(false); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save device."); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError("");
    try { await devices.revoke(device.id); setConfirmRevoke(false); setEditing(false); await reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove device."); }
    finally { setBusy(false); }
  };
  const currentProject = projects.find(project => project.id === device.project_id)?.name;
  const currentAgent = agents.find(agent => String(agent.id) === device.agent_id)?.name;
  return <article className="space-y-3 rounded-lg border border-border bg-bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold text-text">{device.name}{device.current ? " · This device" : ""}</h3>
        <p className="mt-1 text-xs text-text-muted">{device.revoked_at ? "Removed" : device.connected ? "Connected" : "Offline"}{device.version ? " · v" + device.version : ""}</p>
        <p className="mt-1 text-xs text-text-dim">Last seen: {device.last_seen ? new Date(device.last_seen * 1000).toLocaleString() : "Not connected yet"}</p>
      </div>
      {!device.revoked_at && <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={edit}>Edit</button>
        <button type="button" className={buttonClass + " text-red"} disabled={busy} onClick={() => setConfirmRevoke(true)}>Remove</button>
      </div>}
    </div>
    {(currentProject || currentAgent) && <p className="text-xs text-text-muted">{[currentProject, currentAgent].filter(Boolean).join(" · ")}</p>}
    {device.hardware?.length > 0 && <p className="text-xs text-text-muted">Hardware: {device.hardware.map(item => item.description || item.id).join(", ")}</p>}
    {!!device.tools?.length && <p className="text-xs text-text-dim">{device.tools.length} hardware tools available</p>}
    {editing && !device.revoked_at && <form className="space-y-3 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="block space-y-1 text-xs text-text-muted">Device name<input className={inputClass} value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label>
      <DeviceDefaults projectID={projectID} agentID={agentID} setProject={setProject} setAgent={setAgent} projects={projects} agents={agents} />
      <p className="text-xs text-text-dim">Defaults choose where the device starts. It can switch to any project or agent your account can access. Saving reconnects an online device.</p>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy || !name.trim()}>Save device</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}
    {confirmRevoke && <div className="space-y-3 rounded border border-red/30 p-3">
      <p className="text-sm text-text">Remove {device.name}? It will disconnect immediately and must pair again to access your account.</p>
      <div className="flex gap-2"><button type="button" className={buttonClass + " text-red"} disabled={busy} onClick={() => void revoke()}>Confirm removal</button><button type="button" className={buttonClass} disabled={busy} onClick={() => setConfirmRevoke(false)}>Keep device</button></div>
    </div>}
    {!device.revoked_at && <div className="border-t border-border pt-3"><button type="button" className={buttonClass} onClick={() => setShowAccess(!showAccess)} aria-expanded={showAccess}>Agent tools &amp; events</button>
      {showAccess && <DeviceAgentSettings device={device} agents={agents} projects={projects} />}
    </div>}
    {error && <p role="alert" className="text-sm text-red">{error}</p>}
  </article>;
}

export function DeviceSettings() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(() => params.get("code") || "");
  const [pairing, setPairing] = useState<DevicePairingRequest | null>(null);
  const [checkedCode, setCheckedCode] = useState("");
  const [projectID, setProject] = useState("");
  const [agentID, setAgent] = useState("");
  const [rows, setRows] = useState<AccountDevice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const reload = useCallback(async () => { const result = await devices.list(); setRows(result.devices); setLoaded(true); }, []);
  useEffect(() => {
    let active = true;
    const load = () => devices.list().then(result => { if (active) { setRows(result.devices); setLoaded(true); } }).catch(err => { if (active) { setError(err.message); setLoaded(true); } });
    void load();
    Promise.all([projectsAPI.list(), instances.list()]).then(([projectRows, agentRows]) => { if (active) { setProjects(projectRows || []); setAgents(agentRows || []); } }).catch(err => { if (active) setError(err.message); });
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const lookup = async (value: string) => {
    setBusy(true); setError(""); setNotice(""); setPairing(null);
    try { const result = await devices.pairing(value.trim()); setPairing(result); setCheckedCode(value.trim()); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not find pairing request."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const incoming = params.get("code");
    if (incoming) { setCode(incoming); void lookup(incoming); }
  }, [params.get("code")]);
  const decide = async (approve: boolean) => {
    setBusy(true); setError("");
    try {
      if (approve) await devices.approve(checkedCode, projectID, agentID); else await devices.deny(checkedCode);
      setNotice(approve ? "Device approved. It can now connect to your account." : "Pairing request denied.");
      setPairing(null); setCode("");
      const next = new URLSearchParams(params); next.delete("code"); setParams(next, { replace: true });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update pairing request."); }
    finally { setBusy(false); }
  };
  return <section className="w-full max-w-4xl space-y-5">
    <div><h2 className="text-base font-bold text-text">Devices</h2><p className="mt-1 text-sm text-text-muted">Connect Apteva Nodes to your account. Paired devices have the same access to apps, projects, and agents as you.</p></div>
    <div className="space-y-4 rounded-lg border border-border bg-bg-card p-4">
      <h3 className="text-sm font-semibold text-text">Pair a device</h3>
      <p className="text-xs text-text-muted">Start pairing on your device, then enter the code shown on its screen.</p>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void lookup(code); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">Pairing code</span><input className={inputClass + " font-mono uppercase"} value={code} maxLength={16} autoComplete="off" placeholder="ABCD-EFGH" onChange={event => { setCode(event.target.value); setPairing(null); }} required /></label>
        <button className={buttonClass} disabled={busy || !code.trim()}>Find device</button>
      </form>
      {pairing && <div className="space-y-3 border-t border-border pt-3">
        <h4 className="text-sm font-semibold">Connect {pairing.name}?</h4>
        <p className="text-xs text-text-muted">Check that {checkedCode.toUpperCase()} matches the code on the device. Expires {new Date(pairing.expires_at * 1000).toLocaleTimeString()}.</p>
        {!!pairing.hardware.length && <ul className="list-inside list-disc text-xs text-text-muted">{pairing.hardware.map(item => <li key={item.id}>{item.description || item.id} · {item.kind}</li>)}</ul>}
        <DeviceDefaults projectID={projectID} agentID={agentID} setProject={setProject} setAgent={setAgent} projects={projects} agents={agents} />
        <div className="flex gap-2"><button type="button" className={buttonClass + " bg-accent text-bg"} disabled={busy} onClick={() => void decide(true)}>Approve device</button><button type="button" className={buttonClass} disabled={busy} onClick={() => void decide(false)}>Deny</button></div>
      </div>}
    </div>
    {error && <p role="alert" className="text-sm text-red">{error}</p>}
    {notice && <p role="status" className="text-sm text-green">{notice}</p>}
    {!loaded ? <p className="text-sm text-text-muted">Loading devices…</p> : !rows.some(row => !row.revoked_at) && <p className="text-sm text-text-muted">No paired devices yet.</p>}
    {rows.some(row => !!row.revoked_at) && <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={showRemoved} onChange={event => setShowRemoved(event.target.checked)} />Show removed devices</label>}
    {rows.filter(row => showRemoved || !row.revoked_at).map(device => <DeviceRow key={device.id} device={device} projects={projects} agents={agents} reload={reload} />)}
  </section>;
}
