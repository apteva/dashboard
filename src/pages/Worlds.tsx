// Worlds — isolated test environments (agent-testing-as-a-virtual-world).
//
// A World runs real app sidecars (real DB writes) behind one HTTP edge that
// virtualises outbound calls (mock | record | replay | block). This page
// lets an operator create/inspect Worlds, watch the edge's intercepted
// calls, snapshot a World's state, and fork a new World from a snapshot.
// "Open" on an app links to that app's panel driven against the in-world
// sidecar (server/world_handlers.go proxy).

import { useEffect, useState } from "react";
import {
  worlds as worldsApi,
  worldSnapshots as snapsApi,
  type WorldSummary,
  type WorldSnapshotManifest,
  type InterceptedCall,
} from "../api";

const MODES = ["block", "mock", "record", "replay", "passthrough"] as const;

export function Worlds() {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [snaps, setSnaps] = useState<WorldSnapshotManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newApps, setNewApps] = useState("");
  const [newMode, setNewMode] = useState<string>("block");
  const [newSnapshot, setNewSnapshot] = useState("");
  const [busy, setBusy] = useState(false);

  // per-world call inspector
  const [openCalls, setOpenCalls] = useState<string | null>(null);
  const [calls, setCalls] = useState<InterceptedCall[]>([]);

  const refresh = () => {
    setLoading(true);
    Promise.all([worldsApi.list(), snapsApi.list()])
      .then(([w, s]) => {
        setWorlds(w);
        setSnaps(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await worldsApi.create({
        id: newId.trim() || undefined,
        apps: newApps.split(",").map((a) => a.trim()).filter(Boolean),
        mode: newMode,
        snapshot_id: newSnapshot || undefined,
      });
      setShowCreate(false);
      setNewId("");
      setNewApps("");
      setNewSnapshot("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (id: string) => {
    if (!confirm(`Tear down world "${id}"?`)) return;
    try {
      await worldsApi.destroy(id);
      if (openCalls === id) setOpenCalls(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const snapshot = async (id: string) => {
    try {
      await worldsApi.snapshot(id, {});
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const inspectCalls = async (id: string) => {
    if (openCalls === id) {
      setOpenCalls(null);
      return;
    }
    try {
      const c = await worldsApi.calls(id);
      setCalls(c);
      setOpenCalls(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Worlds</h1>
          <p className="text-sm text-text-muted">
            Isolated test environments — real app sidecars, virtualised edge.
          </p>
        </div>
        <button
          className="px-3 py-1.5 rounded border border-border text-sm hover:bg-bg-subtle"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? "Cancel" : "+ New world"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="rounded border border-border p-4 flex flex-col gap-3 max-w-2xl">
          <label className="text-sm text-text-muted flex flex-col gap-1">
            World id <span className="text-text-muted/60">(optional — auto-generated)</span>
            <input
              className="px-2 py-1.5 rounded border border-border bg-bg text-text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="acme-sales-test"
            />
          </label>
          <label className="text-sm text-text-muted flex flex-col gap-1">
            Apps <span className="text-text-muted/60">(comma-separated sidecar names)</span>
            <input
              className="px-2 py-1.5 rounded border border-border bg-bg text-text"
              value={newApps}
              onChange={(e) => setNewApps(e.target.value)}
              placeholder="crm, storage, tasks"
            />
          </label>
          <div className="flex gap-4">
            <label className="text-sm text-text-muted flex flex-col gap-1">
              Edge mode
              <select
                className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                value={newMode}
                onChange={(e) => setNewMode(e.target.value)}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-text-muted flex flex-col gap-1">
              Fork from snapshot
              <select
                className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                value={newSnapshot}
                onChange={(e) => setNewSnapshot(e.target.value)}
              >
                <option value="">— blank —</option>
                {snaps.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <button
              className="px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50"
              onClick={create}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create world"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : worlds.length === 0 ? (
        <p className="text-text-muted text-sm">No worlds running. Create one to start testing.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {worlds.map((w) => (
            <div key={w.id} className="rounded border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text">{w.id}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">
                    {w.mode}
                  </span>
                  {w.project_id && (
                    <span className="text-xs text-text-muted">{w.project_id}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-subtle" onClick={() => inspectCalls(w.id)}>
                    {openCalls === w.id ? "Hide calls" : "Calls"}
                  </button>
                  <button className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-subtle" onClick={() => snapshot(w.id)}>
                    Snapshot
                  </button>
                  <button className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={() => destroy(w.id)}>
                    Destroy
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {Object.keys(w.apps).length === 0 ? (
                  <span className="text-xs text-text-muted">no sidecars</span>
                ) : (
                  Object.keys(w.apps).map((name) => (
                    <a
                      key={name}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-subtle text-text"
                      href={`${worldsApi.appBase(w.id, name)}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {name} ↗
                    </a>
                  ))
                )}
              </div>

              {openCalls === w.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {calls.length === 0 ? (
                    <p className="text-xs text-text-muted">No edge calls recorded yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-text-muted text-left">
                        <tr>
                          <th className="py-1">Method</th>
                          <th>Host</th>
                          <th>Path</th>
                          <th>Status</th>
                          <th>Disposition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calls.map((c, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="py-1 font-mono">{c.method}</td>
                            <td className="font-mono">{c.host}</td>
                            <td className="font-mono truncate max-w-[16rem]">{c.path}</td>
                            <td>{c.status}</td>
                            <td>
                              {c.mocked && <span className="text-blue-400">mocked</span>}
                              {c.recorded && <span className="text-amber-400">recorded</span>}
                              {c.allowed && !c.mocked && !c.recorded && (
                                <span className="text-green-400">passthrough</span>
                              )}
                              {c.blocked && <span className="text-red-400">blocked</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {snaps.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-text mb-2">Snapshots</h2>
          <div className="flex flex-col gap-1">
            {snaps.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm rounded border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-text">{s.id}</span>
                  <span className="text-xs text-text-muted">
                    {s.apps.join(", ")}
                    {s.has_cassette ? " · cassette" : ""}
                  </span>
                </div>
                <button
                  className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
                  onClick={async () => {
                    if (!confirm(`Delete snapshot "${s.id}"?`)) return;
                    await snapsApi.delete(s.id);
                    refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
