import { useEffect, useMemo, useState } from "react";
import {
  apps as appsApi,
  integrations,
  worlds as worldsApi,
  worldSnapshots as snapsApi,
  type AppMCPTool,
  type AppRow,
  type ConnectionInfo,
  type InterceptedCall,
  type WorldSnapshotManifest,
  type WorldSummary,
} from "../api";
import { useProjects } from "../hooks/useProjects";

const MODES = ["block", "mock", "record", "replay", "passthrough"] as const;
const inputClass = "px-2 py-1.5 rounded border border-border bg-bg text-text";
const buttonClass = "text-xs px-2 py-1 rounded border border-border hover:bg-bg-subtle disabled:opacity-50";

type SeedDraft = {
  id: number;
  app: string;
  tool: string;
  values: Record<string, string>;
  jsonInput: string;
  showOptional: boolean;
};

type FixtureDraft = {
  id: number;
  app: string;
  tool: string;
  status: string;
  data: string;
};

export function Worlds() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";

  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [snaps, setSnaps] = useState<WorldSnapshotManifest[]>([]);
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newMode, setNewMode] = useState<string>("block");
  const [newSnapshot, setNewSnapshot] = useState("");
  const [selectedApps, setSelectedApps] = useState<Set<number>>(new Set());
  const [selectedConnections, setSelectedConnections] = useState<Set<number>>(new Set());
  const [appQuery, setAppQuery] = useState("");
  const [connQuery, setConnQuery] = useState("");
  const [appTools, setAppTools] = useState<Record<number, AppMCPTool[]>>({});
  const [seedRows, setSeedRows] = useState<SeedDraft[]>([]);
  const [fixtureRows, setFixtureRows] = useState<FixtureDraft[]>([]);
  const [busy, setBusy] = useState(false);

  const [openCalls, setOpenCalls] = useState<string | null>(null);
  const [calls, setCalls] = useState<InterceptedCall[]>([]);

  const visibleWorlds = useMemo(
    () => worlds.filter((w) => !projectId || w.project_id === projectId),
    [worlds, projectId],
  );

  const selectableApps = useMemo(
    () =>
      installedApps.filter((app) => {
        const source = String(app.source || "");
        return app.install_id > 0 && source !== "integration";
      }),
    [installedApps],
  );

  const selectedAppRows = useMemo(
    () => selectableApps.filter((app) => selectedApps.has(app.install_id)),
    [selectableApps, selectedApps],
  );

  const selectedConnectionRows = useMemo(
    () => connections.filter((conn) => selectedConnections.has(conn.id)),
    [connections, selectedConnections],
  );

  const filteredApps = useMemo(() => {
    const q = appQuery.trim().toLowerCase();
    if (!q) return selectableApps;
    return selectableApps.filter((app) =>
      [app.display_name, app.name, app.description, app.status, app.project_id ? "project" : "global"]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [appQuery, selectableApps]);

  const filteredConnections = useMemo(() => {
    const q = connQuery.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter((conn) =>
      [conn.name, conn.app_name, conn.app_slug, conn.status, conn.project_id ? "project" : "global"]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [connQuery, connections]);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      worldsApi.list(),
      snapsApi.list(),
      projectId ? appsApi.list(projectId) : Promise.resolve([] as AppRow[]),
      projectId ? integrations.connections(projectId) : Promise.resolve([] as ConnectionInfo[]),
    ])
      .then(([w, s, a, c]) => {
        setWorlds(w || []);
        setSnaps(s || []);
        setInstalledApps(a || []);
        setConnections(c || []);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    setSelectedApps(new Set());
    setSelectedConnections(new Set());
    setAppQuery("");
    setConnQuery("");
    setAppTools({});
    setSeedRows([]);
    setFixtureRows([]);
  }, [projectId]);

  useEffect(() => {
    Array.from(selectedApps).forEach((installId) => {
      if (appTools[installId]) return;
      appsApi
        .tools(installId)
        .then((tools) => setAppTools((prev) => ({ ...prev, [installId]: tools || [] })))
        .catch(() => setAppTools((prev) => ({ ...prev, [installId]: [] })));
    });
  }, [selectedApps, appTools]);

  const toggleApp = (installId: number) => {
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(installId)) next.delete(installId);
      else next.add(installId);
      return next;
    });
  };

  const toggleConnection = (connectionId: number) => {
    setSelectedConnections((prev) => {
      const next = new Set(prev);
      if (next.has(connectionId)) next.delete(connectionId);
      else next.add(connectionId);
      return next;
    });
  };

  const addSeed = () => {
    const app = selectedAppRows[0];
    setSeedRows((rows) => [
      ...rows,
      {
        id: Date.now(),
        app: app?.name || "",
        tool: firstToolName(app, appTools),
        values: {},
        jsonInput: "{}",
        showOptional: false,
      },
    ]);
  };

  const updateSeed = (id: number, patch: Partial<SeedDraft>) => {
    setSeedRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const updateSeedValue = (id: number, key: string, value: string) => {
    setSeedRows((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, values: { ...row.values, [key]: value } } : row,
      ),
    );
  };

  const addFixture = () => {
    const conn = selectedConnectionRows[0] || connections[0];
    setFixtureRows((rows) => [
      ...rows,
      {
        id: Date.now(),
        app: conn?.app_slug || "",
        tool: "",
        status: "200",
        data: "{}",
      },
    ]);
  };

  const updateFixture = (id: number, patch: Partial<FixtureDraft>) => {
    setFixtureRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const create = async () => {
    if (!projectId) {
      setError("Select a project first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const seedPlan = seedRows
        .filter((row) => row.app.trim() && row.tool.trim())
        .map((row) => {
          const app = selectedAppRows.find((a) => a.name === row.app);
          const tool = app ? toolForRow(app, row, appTools) : undefined;
          return {
            app: row.app.trim(),
            tool: row.tool.trim(),
            input: seedInputFromRow(row, tool),
          };
        });
      const fixtures = fixtureRows
        .filter((row) => row.app.trim() && row.tool.trim())
        .map((row) => ({
          app: row.app.trim(),
          tool: row.tool.trim(),
          status: Number(row.status || 200),
          data: parseJSON(row.data, `${row.app}.${row.tool} mock response`),
        }));
      await worldsApi.create({
        id: newId.trim() || undefined,
        project_id: projectId,
        app_install_ids: Array.from(selectedApps),
        connection_ids: Array.from(selectedConnections),
        mode: newMode,
        snapshot_id: newSnapshot || undefined,
        seed_plan: seedPlan,
        integration_fixtures: fixtures,
      });
      setShowCreate(false);
      setNewId("");
      setNewSnapshot("");
      setSelectedApps(new Set());
      setSelectedConnections(new Set());
      setAppQuery("");
      setConnQuery("");
      setSeedRows([]);
      setFixtureRows([]);
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
      setCalls(c || []);
      setOpenCalls(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text">Worlds</h1>
            {currentProject && (
              <span className="text-xs px-2 py-1 rounded border border-border text-text-muted">
                {currentProject.name}
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted">
            Isolated test environments with real app sidecars and virtualized integrations.
          </p>
        </div>
        <button
          className="px-3 py-1.5 rounded border border-border text-sm hover:bg-bg-subtle disabled:opacity-50"
          onClick={() => setShowCreate((v) => !v)}
          disabled={!projectId}
        >
          {showCreate ? "Cancel" : "+ New world"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Running" value={visibleWorlds.length} />
        <Metric label="Apps" value={visibleWorlds.reduce((n, w) => n + Object.keys(w.apps || {}).length, 0)} />
        <Metric label="Connections" value={visibleWorlds.reduce((n, w) => n + (w.connections?.length || 0), 0)} />
        <Metric label="Snapshots" value={snaps.filter((s) => !projectId || s.project_id === projectId).length} />
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {!projectId && (
        <div className="rounded border border-border bg-bg-subtle px-3 py-2 text-sm text-text-muted">
          Select a project in the dashboard header to create a world.
        </div>
      )}

      {showCreate && projectId && (
        <div className="rounded border border-border bg-bg-card">
          <div className="grid lg:grid-cols-[1fr_320px]">
            <div className="p-4 flex flex-col gap-5">
              <section className="grid md:grid-cols-3 gap-3">
                <label className="text-sm text-text-muted flex flex-col gap-1">
                  World id
                  <input
                    className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                    value={newId}
                    onChange={(e) => setNewId((e.target as any).value)}
                    placeholder="auto-generated"
                  />
                </label>
                <label className="text-sm text-text-muted flex flex-col gap-1">
                  Edge mode
                  <select
                    className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                    value={newMode}
                    onChange={(e) => setNewMode((e.target as any).value)}
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
                    onChange={(e) => setNewSnapshot((e.target as any).value)}
                  >
                    <option value="">Blank world</option>
                    {snaps
                      .filter((s) => !s.project_id || s.project_id === projectId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id}
                        </option>
                      ))}
                  </select>
                </label>
              </section>

              <section className="flex flex-col gap-2">
                <SectionHeader title="Apps" detail={`${selectedApps.size}/${selectableApps.length} selected`} />
                <SearchBox value={appQuery} onChange={setAppQuery} placeholder="Search installed apps" />
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-48 overflow-auto pr-1">
                  {filteredApps.length === 0 ? (
                    <EmptyLine text="No installed apps visible in this project." />
                  ) : (
                    filteredApps.map((app) => (
                      <CompactPickRow
                        key={app.install_id}
                        checked={selectedApps.has(app.install_id)}
                        disabled={app.status !== "running"}
                        title={app.display_name || app.name}
                        meta={`#${app.install_id} - ${app.project_id ? "project" : "global"} - ${app.status}`}
                        badge={`${app.surfaces?.mcp_tool_count || 0} tools`}
                        onToggle={() => toggleApp(app.install_id)}
                      />
                    ))
                  )}
                </div>
                <SelectedChips
                  items={selectedAppRows.map((app) => ({
                    key: app.install_id,
                    label: app.display_name || app.name,
                    onRemove: () => toggleApp(app.install_id),
                  }))}
                  empty="No apps selected"
                />
              </section>

              <section className="flex flex-col gap-2">
                <SectionHeader title="Connections" detail={`${selectedConnections.size}/${connections.length} selected`} />
                <SearchBox value={connQuery} onChange={setConnQuery} placeholder="Search connections" />
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-48 overflow-auto pr-1">
                  {filteredConnections.length === 0 ? (
                    <EmptyLine text="No integration connections visible in this project." />
                  ) : (
                    filteredConnections.map((conn) => (
                      <CompactPickRow
                        key={conn.id}
                        checked={selectedConnections.has(conn.id)}
                        disabled={conn.status === "disabled"}
                        title={conn.name || conn.app_name || conn.app_slug}
                        meta={`${conn.app_slug} - ${conn.project_id ? "project" : "global"} - ${conn.status}`}
                        badge={`${conn.tool_count || 0} tools`}
                        onToggle={() => toggleConnection(conn.id)}
                      />
                    ))
                  )}
                </div>
                <SelectedChips
                  items={selectedConnectionRows.map((conn) => ({
                    key: conn.id,
                    label: conn.name || conn.app_slug,
                    onRemove: () => toggleConnection(conn.id),
                  }))}
                  empty="No connections selected"
                />
              </section>

              <section className="flex flex-col gap-2">
                <SectionHeader title="Seeds" detail={`${seedRows.length} calls`} />
                <div className="flex flex-col gap-2">
                  {seedRows.map((row) => {
                    const app = selectedAppRows.find((a) => a.name === row.app);
                    const tools = app ? toolsForApp(app, appTools) : [];
                    const selectedTool = app ? toolForRow(app, row, appTools) : undefined;
                    const fields = schemaFields(selectedTool?.inputSchema);
                    return (
                      <div key={row.id} className="rounded border border-border bg-bg p-3 flex flex-col gap-3">
                        <div className="grid md:grid-cols-[180px_220px_1fr_auto] gap-2 items-start">
                          <select
                            className={inputClass}
                            value={row.app}
                            onChange={(e) => {
                              const nextApp = selectedAppRows.find((a) => a.name === (e.target as any).value);
                              updateSeed(row.id, {
                                app: (e.target as any).value,
                                tool: firstToolName(nextApp, appTools),
                                values: {},
                                jsonInput: "{}",
                                showOptional: false,
                              });
                            }}
                          >
                            <option value="">App</option>
                            {selectedAppRows.map((a) => (
                              <option key={a.install_id} value={a.name}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className={inputClass}
                            value={row.tool}
                            onChange={(e) => updateSeed(row.id, { tool: (e.target as any).value, values: {}, jsonInput: "{}", showOptional: false })}
                          >
                            <option value="">Tool</option>
                            {tools.map((tool) => (
                              <option key={tool.name} value={tool.name}>
                                {tool.name}
                              </option>
                            ))}
                          </select>
                          <div className="text-xs text-text-muted min-h-8">
                            {selectedTool?.description || (app && appTools[app.install_id] === undefined ? "Loading tool schema..." : "No schema description.")}
                          </div>
                          <button className={buttonClass} onClick={() => setSeedRows((rows) => rows.filter((r) => r.id !== row.id))}>
                            Remove
                          </button>
                        </div>
                        {fields.length === 0 ? (
                          <label className="text-xs text-text-muted flex flex-col gap-1">
                            Arguments JSON
                            <input className={`${inputClass} font-mono text-xs`} value={row.jsonInput} onChange={(e) => updateSeed(row.id, { jsonInput: (e.target as any).value })} />
                          </label>
                        ) : (
                          <SeedFields row={row} fields={fields} onValue={updateSeedValue} onToggleOptional={() => updateSeed(row.id, { showOptional: !row.showOptional })} />
                        )}
                      </div>
                    );
                  })}
                  <button className={`${buttonClass} self-start`} onClick={addSeed} disabled={selectedAppRows.length === 0}>
                    + Seed call
                  </button>
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <SectionHeader title="Mock Overrides" detail={`${fixtureRows.length} overrides`} />
                <div className="flex flex-col gap-2">
                  {fixtureRows.map((row) => (
                    <div key={row.id} className="grid md:grid-cols-[160px_160px_90px_1fr_auto] gap-2">
                      <input className={inputClass} value={row.app} onChange={(e) => updateFixture(row.id, { app: (e.target as any).value })} placeholder="facebook-api" />
                      <input className={inputClass} value={row.tool} onChange={(e) => updateFixture(row.id, { tool: (e.target as any).value })} placeholder="list_pages" />
                      <input className={inputClass} value={row.status} onChange={(e) => updateFixture(row.id, { status: (e.target as any).value })} />
                      <input className={`${inputClass} font-mono text-xs`} value={row.data} onChange={(e) => updateFixture(row.id, { data: (e.target as any).value })} />
                      <button className={buttonClass} onClick={() => setFixtureRows((rows) => rows.filter((r) => r.id !== row.id))}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <button className={`${buttonClass} self-start`} onClick={addFixture}>
                    + Override
                  </button>
                </div>
              </section>
            </div>

            <aside className="border-t lg:border-t-0 lg:border-l border-border p-4 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-text">Review</h2>
              <ReviewBlock label="Apps" items={selectedAppRows.map((a) => a.name)} empty="No apps selected" />
              <ReviewBlock label="Connections" items={selectedConnectionRows.map((c) => c.name || c.app_slug)} empty="No connections selected" />
              <ReviewBlock label="Seeds" items={seedRows.map((s) => `${s.app || "app"}.${s.tool || "tool"}`)} empty="No seed calls" />
              <ReviewBlock label="Overrides" items={fixtureRows.map((f) => `${f.app || "integration"}.${f.tool || "tool"}`)} empty="Catalog mocks only" />
              <button
                className="mt-2 px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
                onClick={create}
                disabled={busy}
              >
                {busy ? "Creating..." : "Create world"}
              </button>
            </aside>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading...</p>
      ) : visibleWorlds.length === 0 ? (
        <p className="text-text-muted text-sm">No worlds running in this project.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleWorlds.map((w) => (
            <WorldCard
              key={w.id}
              world={w}
              callsOpen={openCalls === w.id}
              calls={calls}
              onCalls={() => inspectCalls(w.id)}
              onSnapshot={() => snapshot(w.id)}
              onDestroy={() => destroy(w.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorldCard({
  world,
  callsOpen,
  calls,
  onCalls,
  onSnapshot,
  onDestroy,
}: {
  world: WorldSummary;
  callsOpen: boolean;
  calls: InterceptedCall[];
  onCalls: () => void;
  onSnapshot: () => void;
  onDestroy: () => void;
}) {
  const appNames = Object.keys(world.apps || {});
  return (
    <div className="rounded border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-text truncate">{world.id}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">{world.mode}</span>
          <span className="text-xs text-text-muted">{appNames.length} apps</span>
          <span className="text-xs text-text-muted">{world.connections?.length || 0} connections</span>
        </div>
        <div className="flex gap-2">
          <button className={buttonClass} onClick={onCalls}>{callsOpen ? "Hide calls" : "Calls"}</button>
          <button className={buttonClass} onClick={onSnapshot}>Snapshot</button>
          <button className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={onDestroy}>
            Destroy
          </button>
        </div>
      </div>

      <div className="mt-3 grid md:grid-cols-2 gap-3">
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase">Apps</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {appNames.length === 0 ? (
              <span className="text-xs text-text-muted">No apps</span>
            ) : (
              appNames.map((name) => (
                <a
                  key={name}
                  className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-subtle text-text"
                  href={`${worldsApi.appBase(world.id, name)}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {name} {world.apps[name]?.kind === "install" ? "install" : "legacy"}
                </a>
              ))
            )}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase">Connections</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(world.connections || []).length === 0 ? (
              <span className="text-xs text-text-muted">No connections</span>
            ) : (
              (world.connections || []).map((conn) => (
                <span key={conn.id} className="text-xs px-2 py-1 rounded border border-border text-text">
                  {conn.name || conn.app_slug}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {callsOpen && (
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
                  <tr key={i} className="border-t border-border/60">
                    <td className="py-1 text-text">{c.method}</td>
                    <td className="text-text-muted">{c.host}</td>
                    <td className="text-text-muted truncate max-w-[28rem]">{c.path}</td>
                    <td className="text-text-muted">{c.status || "-"}</td>
                    <td className="text-text-muted">{c.mocked ? "mocked" : c.allowed ? "allowed" : c.recorded ? "recorded" : c.blocked ? "blocked" : "seen"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      className={`${inputClass} w-full`}
      value={value}
      onChange={(e) => onChange((e.target as any).value)}
      placeholder={placeholder}
    />
  );
}

function CompactPickRow({
  checked,
  disabled,
  title,
  meta,
  badge,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  meta: string;
  badge: string;
  onToggle: () => void;
}) {
  return (
    <label className={`rounded border border-border px-3 py-2 flex gap-2 bg-bg min-w-0 ${disabled ? "opacity-50" : "hover:bg-bg-subtle"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text truncate">{title}</span>
        <span className="block text-xs text-text-muted truncate">{meta}</span>
      </span>
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted h-fit shrink-0">{badge}</span>
    </label>
  );
}

function SelectedChips({
  items,
  empty,
}: {
  items: Array<{ key: string | number; label: string; onRemove: () => void }>;
  empty: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 min-h-7">
      {items.length === 0 ? (
        <span className="text-xs text-text-muted">{empty}</span>
      ) : (
        items.map((item) => (
          <button
            key={item.key}
            className="text-xs px-2 py-1 rounded border border-border bg-bg-subtle text-text hover:border-red-500/50"
            onClick={item.onRemove}
            title="Remove"
          >
            {item.label} x
          </button>
        ))
      )}
    </div>
  );
}

function SeedFields({
  row,
  fields,
  onValue,
  onToggleOptional,
}: {
  row: SeedDraft;
  fields: SchemaField[];
  onValue: (id: number, key: string, value: string) => void;
  onToggleOptional: () => void;
}) {
  const required = fields.filter((f) => f.required);
  const optional = fields.filter((f) => !f.required);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid md:grid-cols-2 gap-2">
        {required.map((field) => (
          <SeedField key={field.key} row={row} field={field} onValue={onValue} />
        ))}
      </div>
      {optional.length > 0 && (
        <div className="border-t border-border pt-2">
          <button className="text-xs text-accent hover:text-accent-hover" onClick={onToggleOptional}>
            {row.showOptional ? `Hide ${optional.length} optional` : `Show ${optional.length} optional`}
          </button>
          {row.showOptional && (
            <div className="grid md:grid-cols-2 gap-2 mt-2">
              {optional.map((field) => (
                <SeedField key={field.key} row={row} field={field} onValue={onValue} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SeedField({
  row,
  field,
  onValue,
}: {
  row: SeedDraft;
  field: SchemaField;
  onValue: (id: number, key: string, value: string) => void;
}) {
  return (
    <label className="text-xs text-text-muted flex flex-col gap-1">
      <span className="flex items-center gap-1">
        <span className="text-text">{field.key}</span>
        {field.required && <span className="text-red-400">*</span>}
        {field.type && <span className="text-text-muted">({field.type})</span>}
      </span>
      {field.description && <span className="line-clamp-2">{field.description}</span>}
      <input
        className={`${inputClass} text-sm`}
        value={row.values[field.key] || ""}
        onChange={(e) => onValue(row.id, field.key, (e.target as any).value)}
        placeholder={placeholderFor(field)}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-bg-card px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-lg font-semibold text-text">{value}</div>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      <span className="text-xs text-text-muted">{detail}</span>
    </div>
  );
}

function PickRow({
  checked,
  disabled,
  title,
  subtitle,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  subtitle: string;
  onToggle: () => void;
}) {
  return (
    <label className={`rounded border border-border p-3 flex gap-3 bg-bg ${disabled ? "opacity-50" : "hover:bg-bg-subtle"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="mt-1" />
      <span className="min-w-0">
        <span className="block text-sm text-text truncate">{title}</span>
        <span className="block text-xs text-text-muted truncate">{subtitle}</span>
      </span>
    </label>
  );
}

function ReviewBlock({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-text-muted uppercase">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.length === 0 ? (
          <span className="text-xs text-text-muted">{empty}</span>
        ) : (
          items.map((item, i) => (
            <span key={`${item}-${i}`} className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text">
              {item}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-sm text-text-muted">{text}</p>;
}

type SchemaField = {
  key: string;
  type: string;
  description: string;
  required: boolean;
  schema: any;
};

function toolsForApp(app: AppRow, appTools: Record<number, AppMCPTool[]>): AppMCPTool[] {
  const loaded = appTools[app.install_id];
  if (loaded && loaded.length > 0) return loaded;
  return (app.surfaces?.mcp_tool_names || []).map((name) => ({ name, inputSchema: { type: "object" } }));
}

function firstToolName(app: AppRow | undefined, appTools: Record<number, AppMCPTool[]>): string {
  if (!app) return "";
  return toolsForApp(app, appTools)[0]?.name || "";
}

function toolForRow(app: AppRow, row: SeedDraft, appTools: Record<number, AppMCPTool[]>): AppMCPTool | undefined {
  return toolsForApp(app, appTools).find((tool) => tool.name === row.tool);
}

function schemaFields(schema: Record<string, any> | undefined): SchemaField[] {
  const props = (schema?.properties || {}) as Record<string, any>;
  const required = new Set((schema?.required || []) as string[]);
  return Object.entries(props)
    .map(([key, prop]) => ({
      key,
      type: String(prop?.type || "string"),
      description: String(prop?.description || ""),
      required: required.has(key),
      schema: prop,
    }))
    .sort((a, b) => Number(b.required) - Number(a.required) || a.key.localeCompare(b.key));
}

function seedInputFromRow(row: SeedDraft, tool: AppMCPTool | undefined): Record<string, any> {
  const fields = schemaFields(tool?.inputSchema);
  if (fields.length === 0) {
    return parseJSON(row.jsonInput, `${row.app}.${row.tool} seed input`);
  }
  const out: Record<string, any> = {};
  for (const field of fields) {
    const raw = row.values[field.key];
    if (raw === undefined || raw === "") continue;
    out[field.key] = coerceFieldValue(raw, field);
  }
  return out;
}

function coerceFieldValue(raw: string, field: SchemaField): any {
  switch (field.type) {
    case "number":
    case "integer":
      return Number(raw);
    case "boolean":
      return raw === "true" || raw === "1" || raw.toLowerCase() === "yes";
    case "array":
    case "object":
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

function placeholderFor(field: SchemaField): string {
  if (field.schema?.default !== undefined) return String(field.schema.default);
  if (field.type === "number" || field.type === "integer") return "0";
  if (field.type === "boolean") return "true";
  if (field.type === "array") return "[]";
  if (field.type === "object") return "{}";
  return "";
}

function parseJSON(raw: string, label: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return parsed;
  } catch (e) {
    throw new Error(`${label}: ${(e as Error).message}`);
  }
}
