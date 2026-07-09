import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  apps as appsApi,
  instances,
  integrations,
  environments as environmentsApi,
  environmentSnapshots as snapsApi,
  type Agent,
  type AppMCPTool,
  type AppRow,
  type ConnectionInfo,
  type EnvironmentConnectionInfo,
  type InterceptedCall,
  type TelemetryEvent,
  type Thread,
  type ThreadContextMessage,
	  type EnvironmentAgentStatus,
	  type EnvironmentSnapshotManifest,
	  type EnvironmentSummary,
	  type EnvironmentSubscriptionInfo,
	} from "../api";
import {
  SystemMap,
  type SystemMapActivity,
  type SystemMapEdge,
  type SystemMapEdgeKind,
  type SystemMapNode,
  type SystemMapNodeLatestKind,
  type SystemMapStatus,
} from "../components/system-map/SystemMap";
import { Modal } from "../components/Modal";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";

const NETWORK_MODES = ["passthrough", "block", "record", "replay"] as const;
const INTEGRATION_MODES = ["mock", "real"] as const;
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

type EnvironmentAppBusEvent = {
  topic: string;
  app: string;
  project_id: string;
  install_id: number;
  seq: number;
  time: string;
  data: unknown;
};

type EnvironmentAgentContext = {
  id: string;
  iteration: number;
  model: string;
  count: number;
  total_chars: number;
  messages: ThreadContextMessage[];
};

export function Environments() {
  usePageTitle("Environments");

  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const navigate = useNavigate();

  const [environments, setEnvironments] = useState<EnvironmentSummary[]>([]);
  const [snaps, setSnaps] = useState<EnvironmentSnapshotManifest[]>([]);
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newNetworkMode, setNewNetworkMode] = useState<string>("passthrough");
  const [newIntegrationMode, setNewIntegrationMode] = useState<string>("mock");
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
  const [destroyTarget, setDestroyTarget] = useState<EnvironmentSummary | null>(null);
  const [destroying, setDestroying] = useState(false);

  const visibleEnvironments = useMemo(
    () => environments.filter((w) => !projectId || w.project_id === projectId),
    [environments, projectId],
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
      environmentsApi.list(),
      snapsApi.list(),
      projectId ? appsApi.list(projectId) : Promise.resolve([] as AppRow[]),
      projectId ? integrations.connections(projectId) : Promise.resolve([] as ConnectionInfo[]),
      projectId ? instances.list(projectId) : Promise.resolve([] as Agent[]),
    ])
      .then(([w, s, a, c, ag]) => {
        setEnvironments(w || []);
        setSnaps(s || []);
        setInstalledApps(a || []);
        setConnections(c || []);
        setAgents(ag || []);
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
      await environmentsApi.create({
        id: newId.trim() || undefined,
        project_id: projectId,
        app_install_ids: Array.from(selectedApps),
        connection_ids: Array.from(selectedConnections),
        mode: newNetworkMode,
        network_mode: newNetworkMode,
        integration_mode: newIntegrationMode,
        snapshot_id: newSnapshot || undefined,
        seed_plan: seedPlan,
        integration_fixtures: fixtures,
      });
      setShowCreate(false);
      setNewId("");
      setNewNetworkMode("passthrough");
      setNewIntegrationMode("mock");
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

  const confirmDestroy = async () => {
    if (!destroyTarget) return;
    setDestroying(true);
    try {
      await environmentsApi.destroy(destroyTarget.id);
      if (openCalls === destroyTarget.id) setOpenCalls(null);
      setDestroyTarget(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDestroying(false);
    }
  };

  const snapshot = async (id: string) => {
    try {
      await environmentsApi.snapshot(id, {});
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startEnvironment = async (id: string) => {
    try {
      await environmentsApi.start(id);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stopEnvironment = async (id: string) => {
    try {
      await environmentsApi.stop(id);
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
      const c = await environmentsApi.calls(id);
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
            <h1 className="text-xl font-semibold text-text">Environments</h1>
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
          {showCreate ? "Cancel" : "+ New environment"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Running" value={visibleEnvironments.filter((w) => environmentIsRunning(w)).length} />
        <Metric label="Apps" value={visibleEnvironments.reduce((n, w) => n + Object.keys(w.apps || {}).length, 0)} />
        <Metric label="Connections" value={visibleEnvironments.reduce((n, w) => n + (w.connections?.length || 0), 0)} />
        <Metric label="Snapshots" value={snaps.filter((s) => !projectId || s.project_id === projectId).length} />
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {!projectId && (
        <div className="rounded border border-border bg-bg-subtle px-3 py-2 text-sm text-text-muted">
          Select a project in the dashboard header to create an environment.
        </div>
      )}

      {showCreate && projectId && (
        <div className="rounded border border-border bg-bg-card">
          <div className="grid lg:grid-cols-[1fr_320px]">
            <div className="p-4 flex flex-col gap-5">
              <section className="grid md:grid-cols-4 gap-3">
                <label className="text-sm text-text-muted flex flex-col gap-1">
                  Environment id
                  <input
                    className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                    value={newId}
                    onChange={(e) => setNewId((e.target as any).value)}
                    placeholder="auto-generated"
                  />
                </label>
                <label className="text-sm text-text-muted flex flex-col gap-1">
                  Network
                  <select
                    className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                    value={newNetworkMode}
                    onChange={(e) => setNewNetworkMode((e.target as any).value)}
                  >
                    {NETWORK_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-text-muted flex flex-col gap-1">
                  Integrations
                  <select
                    className="px-2 py-1.5 rounded border border-border bg-bg text-text"
                    value={newIntegrationMode}
                    onChange={(e) => setNewIntegrationMode((e.target as any).value)}
                  >
                    {INTEGRATION_MODES.map((m) => (
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
                    <option value="">Blank environment</option>
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
                {busy ? "Creating..." : "Create environment"}
              </button>
              {busy && (
                <p className="text-xs text-text-muted">
                  Building selected local apps, starting sidecars, and waiting for health checks.
                </p>
              )}
            </aside>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading...</p>
      ) : visibleEnvironments.length === 0 ? (
        <p className="text-text-muted text-sm">No environments running in this project.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleEnvironments.map((w) => (
            <EnvironmentCard
              key={w.id}
              environment={w}
              callsOpen={openCalls === w.id}
              calls={calls}
              onCalls={() => inspectCalls(w.id)}
              onSnapshot={() => snapshot(w.id)}
              onStart={() => startEnvironment(w.id)}
              onStop={() => stopEnvironment(w.id)}
              onDestroy={() => setDestroyTarget(w)}
              onOpen={() => navigate(`/environments/${encodeURIComponent(w.id)}`)}
            />
          ))}
        </div>
      )}

      {destroyTarget && (
        <ConfirmDialog
          title="Destroy environment"
          body={`Destroy ${destroyTarget.id}? This stops its in-environment apps and removes the live environment. Snapshots are kept.`}
          confirmLabel={destroying ? "Destroying..." : "Destroy"}
          tone="danger"
          busy={destroying}
          onCancel={() => {
            if (!destroying) setDestroyTarget(null);
          }}
          onConfirm={confirmDestroy}
        />
      )}
    </div>
  );
}

function EnvironmentCard({
  environment,
  callsOpen,
  calls,
  onCalls,
  onSnapshot,
  onStart,
  onStop,
  onDestroy,
  onOpen,
}: {
  environment: EnvironmentSummary;
  callsOpen: boolean;
  calls: InterceptedCall[];
  onCalls: () => void;
  onSnapshot: () => void;
  onStart: () => void;
  onStop: () => void;
  onDestroy: () => void;
  onOpen: () => void;
}) {
  const appNames = Object.keys(environment.apps || {});
  const running = environmentIsRunning(environment);
  const networkMode = environmentNetworkMode(environment);
  const integrationMode = environmentIntegrationMode(environment);
  return (
    <div className="rounded border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-text truncate">{environment.id}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">network: {networkMode}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">integrations: {integrationMode}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded border ${environmentStatusClass(environment)}`}>
            {environment.status || (running ? "running" : "stopped")}
          </span>
          {environment.persisted && <span className="text-xs px-1.5 py-0.5 rounded border border-border text-text-muted">persistent</span>}
          {environment.ephemeral && <span className="text-xs px-1.5 py-0.5 rounded border border-yellow/40 text-yellow">ephemeral</span>}
          <span className="text-xs text-text-muted">{appNames.length} apps</span>
          <span className="text-xs text-text-muted">{environment.connections?.length || 0} connections</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="text-xs px-2 py-1 rounded border border-accent/50 text-accent hover:bg-accent/10" onClick={onOpen}>
            Open
          </button>
          {!running && environment.persisted && <button className={buttonClass} onClick={onStart}>Start</button>}
          {running && environment.persisted && <button className={buttonClass} onClick={onStop}>Stop</button>}
          <button className={buttonClass} onClick={onCalls} disabled={!running}>{callsOpen ? "Hide calls" : "Calls"}</button>
          <button className={buttonClass} onClick={onSnapshot} disabled={!running}>Snapshot</button>
          <button className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={onDestroy}>
            Delete
          </button>
        </div>
      </div>
      {environment.error_message && (
        <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400">
          {environment.error_message}
        </div>
      )}

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
                  href={`${environmentsApi.appBase(environment.id, name)}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {name} {environment.apps[name]?.kind === "install" ? "install" : "legacy"}
                </a>
              ))
            )}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-text-muted uppercase">Connections</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(environment.connections || []).length === 0 ? (
              <span className="text-xs text-text-muted">No connections</span>
            ) : (
              (environment.connections || []).map((conn) => (
                <span key={conn.id} className="text-xs px-2 py-1 rounded border border-border text-text">
                  {conn.name || conn.app_slug}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {callsOpen && running && (
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

export function EnvironmentDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const [environment, setEnvironment] = useState<EnvironmentSummary | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [calls, setCalls] = useState<InterceptedCall[]>([]);
  const [showCalls, setShowCalls] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [destroyTarget, setDestroyTarget] = useState<EnvironmentSummary | null>(null);
  const [destroying, setDestroying] = useState(false);
  usePageTitle(["Environment", environment?.id || id || "loading"]);

  const load = async (showLoading = false) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    try {
      const env = await environmentsApi.get(id);
      setEnvironment(env);
      const projectID = env.project_id || currentProject?.id || "";
      const projectAgents = projectID ? await instances.list(projectID).catch(() => [] as Agent[]) : [];
      setAgents(projectAgents || []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [id, currentProject?.id]);

  const running = environment ? environmentIsRunning(environment) : false;
  const appNames = environment ? Object.keys(environment.apps || {}) : [];
  const networkMode = environment ? environmentNetworkMode(environment) : "";
  const integrationMode = environment ? environmentIntegrationMode(environment) : "";

  const start = async () => {
    if (!environment) return;
    try {
      const next = await environmentsApi.start(environment.id);
      setEnvironment(next);
      setRefreshKey((key) => key + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = async () => {
    if (!environment) return;
    try {
      await environmentsApi.stop(environment.id);
      await load(false);
      setRefreshKey((key) => key + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const snapshot = async () => {
    if (!environment) return;
    try {
      await environmentsApi.snapshot(environment.id, {});
      await load(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const inspectCalls = async () => {
    if (!environment) return;
    if (showCalls) {
      setShowCalls(false);
      return;
    }
    try {
      const next = await environmentsApi.calls(environment.id);
      setCalls(next || []);
      setShowCalls(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirmDestroy = async () => {
    if (!destroyTarget) return;
    setDestroying(true);
    try {
      await environmentsApi.destroy(destroyTarget.id);
      navigate("/environments");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDestroying(false);
    }
  };

  const handleAgentsChanged = () => {
    setRefreshKey((key) => key + 1);
    void load(false);
  };

  if (loading && !environment) {
    return <div className="h-full overflow-auto p-6 text-sm text-text-muted">Loading environment...</div>;
  }

  if (!environment) {
    return (
      <div className="h-full overflow-auto p-6">
        <button className={buttonClass} onClick={() => navigate("/environments")}>Back</button>
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error || "Environment not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button className={buttonClass} onClick={() => navigate("/environments")}>Back</button>
            <h1 className="text-xl font-semibold text-text truncate">{environment.id}</h1>
            <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">network: {networkMode}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted">integrations: {integrationMode}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${environmentStatusClass(environment)}`}>
              {environment.status || (running ? "running" : "stopped")}
            </span>
            {environment.persisted && <span className="text-xs px-1.5 py-0.5 rounded border border-border text-text-muted">persistent</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>{appNames.length} app{appNames.length === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{(environment.agents || []).length} agent{(environment.agents || []).length === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{environment.connections?.length || 0} connection{(environment.connections?.length || 0) === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>{calls.length} call{calls.length === 1 ? "" : "s"}</span>
            {appNames.map((name) => (
              <a
                key={name}
                className="ml-1 rounded border border-border px-1.5 py-0.5 text-text hover:bg-bg-subtle"
                href={`${environmentsApi.appBase(environment.id, name)}/`}
                target="_blank"
                rel="noreferrer"
              >
                {name} {environment.apps[name]?.kind === "install" ? `#${environment.apps[name]?.install_id}` : "legacy"}
              </a>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!running && environment.persisted && <button className={buttonClass} onClick={start}>Start</button>}
          {running && environment.persisted && <button className={buttonClass} onClick={stop}>Stop</button>}
          <button className={buttonClass} onClick={inspectCalls} disabled={!running}>{showCalls ? "Hide calls" : "Calls"}</button>
          <button className={buttonClass} onClick={snapshot} disabled={!running}>Snapshot</button>
          <button className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={() => setDestroyTarget(environment)}>
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <EnvironmentSystemMap environment={environment} refreshKey={refreshKey} wide />

      <EnvironmentSubscriptionsPanel
        environment={environment}
        onError={(message) => setError(message)}
        onChanged={() => {
          setRefreshKey((key) => key + 1);
          void load(false);
        }}
      />

      {running ? (
        <EnvironmentAgentPanel
          environment={environment}
          agents={agents}
          onError={(message) => setError(message)}
          onAgentsChanged={handleAgentsChanged}
        />
      ) : (
        <div className="rounded border border-border bg-bg-card p-4 text-sm text-text-muted">
          Start this environment to inspect live agents, threads, telemetry, and app state.
        </div>
      )}

      {showCalls && running && (
        <EnvironmentCallsTable calls={calls} />
      )}

      {destroyTarget && (
        <ConfirmDialog
          title="Delete environment"
          body={`Delete ${destroyTarget.id}? This stops its in-environment apps and removes the live environment. Snapshots are kept.`}
          confirmLabel={destroying ? "Deleting..." : "Delete"}
          tone="danger"
          busy={destroying}
          onCancel={() => {
            if (!destroying) setDestroyTarget(null);
          }}
          onConfirm={confirmDestroy}
        />
      )}
    </div>
  );
}

function EnvironmentCallsTable({ calls }: { calls: InterceptedCall[] }) {
  return (
    <div className="rounded border border-border bg-bg-card p-3">
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
              <tr key={`${c.ts}-${i}`} className="border-t border-border/60">
                <td className="py-1 text-text">{c.method}</td>
                <td className="text-text-muted">{c.host}</td>
                <td className="text-text-muted truncate max-w-[42rem]">{c.path}</td>
                <td className="text-text-muted">{c.status || "-"}</td>
                <td className="text-text-muted">{c.mocked ? "mocked" : c.allowed ? "allowed" : c.recorded ? "recorded" : c.blocked ? "blocked" : "seen"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EnvironmentSystemMap({
  environment,
  refreshKey = 0,
  wide,
}: {
  environment: EnvironmentSummary;
  refreshKey?: number;
  wide?: boolean;
}) {
  const [mapAgents, setMapAgents] = useState<EnvironmentAgentStatus[]>(environment.agents || []);
  const [threadsByAgent, setThreadsByAgent] = useState<Record<number, Thread[]>>({});
  const [contexts, setContexts] = useState<Record<string, EnvironmentAgentContext>>({});
  const [calls, setCalls] = useState<InterceptedCall[]>([]);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [appBusEvents, setAppBusEvents] = useState<EnvironmentAppBusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedOnceRef = useRef(false);
  const runningAgentIDs = useMemo(
    () =>
      mapAgents
        .filter((agent) => (agent.status || "running") === "running")
        .map((agent) => agent.agent_id)
        .sort((a, b) => a - b)
        .join(","),
    [mapAgents],
  );

  useEffect(() => {
    let cancelled = false;
    const fallbackAgents = environment.agents || [];
    setEvents([]);
    setAppBusEvents([]);
    const load = async (showLoading = false) => {
      if (showLoading && !loadedOnceRef.current) setLoading(true);
      try {
        const [agents, edgeCalls] = await Promise.all([
          environmentsApi.agents(environment.id).catch(() => fallbackAgents),
          environmentsApi.calls(environment.id).catch(() => [] as InterceptedCall[]),
        ]);
        if (cancelled) return;
        setMapAgents(agents || []);
        setCalls(edgeCalls || []);

        const threadPairs = await Promise.all(
          (agents || []).map(async (agent) => {
            const threads = await environmentsApi.agentThreads(environment.id, agent.agent_id).catch(() => [] as Thread[]);
            return [agent.agent_id, threads || []] as const;
          }),
        );
        if (cancelled) return;
        const nextThreads: Record<number, Thread[]> = {};
        threadPairs.forEach(([agentID, threads]) => {
          nextThreads[agentID] = threads;
        });
        setThreadsByAgent(nextThreads);

        const contextEntries = await Promise.all(
          threadPairs.flatMap(([agentID, threads]) =>
            threads.slice(0, 8).map(async (thread) => {
              const context = await environmentsApi
                .agentContext(environment.id, thread.id || "main", agentID)
                .catch(() => null);
              return context ? [`${agentID}:${thread.id}`, context] as const : null;
            }),
          ),
        );
        if (cancelled) return;
        const nextContexts: Record<string, EnvironmentAgentContext> = {};
        contextEntries.forEach((entry) => {
          if (entry) nextContexts[entry[0]] = {
            id: entry[1].id,
            iteration: entry[1].iteration,
            model: entry[1].model,
            count: entry[1].count,
            total_chars: entry[1].total_chars,
            messages: entry[1].messages || [],
          };
        });
        setContexts(nextContexts);
      } finally {
        if (!cancelled) {
          loadedOnceRef.current = true;
          setLoading(false);
        }
      }
    };
    void load(true);
    const timer = environmentIsRunning(environment)
      ? window.setInterval(() => {
          void load(false);
        }, 3000)
      : null;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [environment.id, environment.status, refreshKey]);

  const appBusKey = useMemo(() => Object.keys(environment.apps || {}).sort().join(","), [environment.apps]);

  useEffect(() => {
    const appNames = appBusKey ? appBusKey.split(",").filter(Boolean) : [];
    if (!environmentIsRunning(environment) || appNames.length === 0) return;
    const sources = appNames.map((app) => {
      const source = new EventSource(
        `/api/app-events/${encodeURIComponent(app)}?project_id=${encodeURIComponent(environment.id)}`,
        { withCredentials: true },
      );
      source.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as EnvironmentAppBusEvent;
          setAppBusEvents((prev) => {
            const key = appBusEventKey(ev);
            if (prev.some((seen) => appBusEventKey(seen) === key)) return prev;
            return [...prev, ev].slice(-160);
          });
        } catch {
          // Ignore malformed appbus frames.
        }
      };
      return source;
    });
    return () => {
      sources.forEach((source) => source.close());
    };
  }, [environment.id, environment.status, appBusKey]);

  useEffect(() => {
    if (!runningAgentIDs) return;
    const sources = mapAgents
      .filter((agent) => (agent.status || "running") === "running")
      .map((agent) => {
        const source = new EventSource(environmentsApi.agentEventsURL(environment.id, agent.agent_id), { withCredentials: true });
        source.onmessage = (e) => {
          try {
            const ev = JSON.parse(e.data) as TelemetryEvent;
            setEvents((prev) => {
              const key = telemetryEventKey(ev);
              if (prev.some((seen) => telemetryEventKey(seen) === key)) return prev;
              return [...prev, ev].slice(-160);
            });
          } catch {
            // Ignore malformed telemetry frames.
          }
        };
        return source;
      });
    return () => {
      sources.forEach((source) => source.close());
    };
  }, [environment.id, runningAgentIDs]);

  const model = useMemo(
    () => buildEnvironmentSystemMap(environment, mapAgents, threadsByAgent, contexts, calls, events, appBusEvents),
    [environment, mapAgents, threadsByAgent, contexts, calls, events, appBusEvents],
  );

  return (
    <div className="mt-3">
      <SystemMap
        title="System Map"
        subtitle="Agents, threads, app tools, telemetry, and network policy."
        scope="environment"
        boundaryLabel={environment.id}
        nodes={model.nodes}
        edges={model.edges}
        activity={model.activity}
        stats={model.stats}
        loading={loading}
        wide={wide}
        heightClass={wide ? "h-[520px] min-h-[420px]" : undefined}
        notice={
          environmentIsRunning(environment) && mapAgents.length === 0
            ? {
                title: "No agents in this environment yet",
                detail: "Spawn an agent to see live threads, tool calls, and telemetry.",
              }
            : undefined
        }
      />
    </div>
  );
}

function environmentIsRunning(environment: EnvironmentSummary): boolean {
  return (environment.status || "running") === "running";
}

function telemetryEventKey(event: TelemetryEvent): string {
  if (event.id) return `id:${event.id}`;
  return [
    event.time || "",
    event.instance_id || "",
    event.thread_id || "",
    event.type || "",
    JSON.stringify(event.data || {}),
  ].join("|");
}

function environmentStatusClass(environment: EnvironmentSummary): string {
  switch (environment.status || "running") {
    case "running":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "error":
      return "border-red-500/40 bg-red-500/10 text-red-400";
    case "starting":
      return "border-yellow/40 bg-yellow/10 text-yellow";
    default:
      return "border-border bg-bg-subtle text-text-muted";
  }
}

function EnvironmentSubscriptionsPanel({
  environment,
  onError,
  onChanged,
}: {
  environment: EnvironmentSummary;
  onError: (message: string) => void;
  onChanged: () => void;
}) {
  const appNames = Object.keys(environment.apps || {}).sort();
  const agentAliases = (environment.agents || []).map((agent) => agent.alias || "main");
  const [app, setApp] = useState(appNames[0] || "");
  const [topic, setTopic] = useState("");
  const [targetAlias, setTargetAlias] = useState(agentAliases[0] || "main");
  const [threadID, setThreadID] = useState("main");
  const [busy, setBusy] = useState<string | null>(null);
  const subscriptions = environment.subscriptions || [];

  useEffect(() => {
    if (!app && appNames.length > 0) setApp(appNames[0]);
  }, [app, appNames.join(",")]);

  useEffect(() => {
    if (!targetAlias && agentAliases.length > 0) setTargetAlias(agentAliases[0]);
  }, [targetAlias, agentAliases.join(",")]);

  const create = async () => {
    const trimmedTopic = topic.trim();
    if (!app || !trimmedTopic) {
      onError("Pick an app and topic for the subscription.");
      return;
    }
    setBusy("create");
    try {
      await environmentsApi.createSubscription(environment.id, {
        app,
        topic: trimmedTopic,
        target_agent_alias: targetAlias.trim() || "main",
        thread_id: threadID.trim() || "main",
      });
      setTopic("");
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (sub: EnvironmentSubscriptionInfo) => {
    setBusy(sub.id);
    try {
      await environmentsApi.deleteSubscription(environment.id, sub.id);
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded border border-border bg-bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text">Subscriptions</h3>
          <p className="mt-0.5 text-xs text-text-muted">Environment-owned app-event routes into agent threads.</p>
        </div>
        <span className="text-xs px-2 py-1 rounded border border-border bg-bg text-text-muted">
          {subscriptions.length} route{subscriptions.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 grid lg:grid-cols-[minmax(120px,180px)_minmax(160px,1fr)_minmax(120px,180px)_minmax(100px,140px)_auto] gap-2 items-end">
        <label className="text-xs text-text-muted flex flex-col gap-1">
          App
          <select className={inputClass} value={app} onChange={(e) => setApp((e.target as HTMLSelectElement).value)} disabled={appNames.length === 0}>
            {appNames.length === 0 ? <option value="">No apps</option> : appNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs text-text-muted flex flex-col gap-1">
          Topic
          <input className={inputClass} value={topic} onChange={(e) => setTopic((e.target as HTMLInputElement).value)} placeholder="media.completed or row.*" />
        </label>
        <label className="text-xs text-text-muted flex flex-col gap-1">
          Agent alias
          <select className={inputClass} value={targetAlias} onChange={(e) => setTargetAlias((e.target as HTMLSelectElement).value)}>
            {(agentAliases.length > 0 ? agentAliases : ["main"]).map((alias) => <option key={alias} value={alias}>{alias}</option>)}
          </select>
        </label>
        <label className="text-xs text-text-muted flex flex-col gap-1">
          Thread
          <input className={inputClass} value={threadID} onChange={(e) => setThreadID((e.target as HTMLInputElement).value)} placeholder="main" />
        </label>
        <button className={`${buttonClass} mb-0.5`} onClick={create} disabled={busy === "create" || appNames.length === 0 || !topic.trim()}>
          {busy === "create" ? "Adding..." : "Add"}
        </button>
      </div>

      {subscriptions.length > 0 && (
        <div className="mt-3 grid gap-2">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-bg px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="text-text truncate">{sub.app}.{sub.topic}</div>
                <div className="text-text-muted truncate">
                  {sub.target_agent_alias || "main"}/{sub.thread_id || "main"} - {sub.status}
                  {sub.subscription_id ? ` - row ${sub.subscription_id}` : ""}
                </div>
              </div>
              <button className="px-2 py-1 rounded border border-border hover:bg-bg-subtle disabled:opacity-50" onClick={() => remove(sub)} disabled={busy === sub.id}>
                {busy === sub.id ? "Removing..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EnvironmentAgentPanel({
  environment,
  agents,
  onError,
  onAgentsChanged,
}: {
  environment: EnvironmentSummary;
  agents: Agent[];
  onError: (message: string) => void;
  onAgentsChanged?: () => void;
}) {
  const [sourceAgentID, setSourceAgentID] = useState("");
  const [alias, setAlias] = useState("");
  const [directive, setDirective] = useState("");
  const [environmentAgents, setEnvironmentAgents] = useState<EnvironmentAgentStatus[]>(environment.agents || []);
  const [activeAgentID, setActiveAgentID] = useState<number | null>((environment.agents || [])[0]?.agent_id || null);
  const [threadID, setThreadID] = useState("main");
  const [message, setMessage] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "connecting" | "live" | "reconnecting" | "closed">("idle");
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [context, setContext] = useState<EnvironmentAgentContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<EnvironmentAgentStatus | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const activeAgentRef = useRef<EnvironmentAgentStatus | null>(null);
  const threadRef = useRef("main");
  const contextRefreshRef = useRef<() => void>(() => {});
  const refreshTimerRef = useRef<number | null>(null);

  const activeAgent = environmentAgents.find((agent) => agent.agent_id === activeAgentID) || null;
  const runningAgents = environmentAgents.filter((agent) => (agent.status || "running") === "running");
  const statusLabel = agentsLoading ? "Checking" : `${runningAgents.length} running`;
  const statusClass = runningAgents.length > 0
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
    : agentsLoading
      ? "border-border bg-bg-subtle text-text-muted"
      : "border-border bg-bg text-text-muted";

  useEffect(() => {
    if (!sourceAgentID && agents.length > 0) setSourceAgentID(String(agents[0].id));
  }, [agents, sourceAgentID]);

  useEffect(() => {
    threadRef.current = threadID.trim() || "main";
  }, [threadID]);

  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    environmentsApi
      .agents(environment.id)
      .then((next) => {
        if (cancelled) return;
        const list = next || [];
        setEnvironmentAgents(list);
        setActiveAgentID((current) => (current && list.some((agent) => agent.agent_id === current) ? current : list[0]?.agent_id || null));
      })
      .catch((e: any) => {
        if (cancelled) return;
        setEnvironmentAgents([]);
        setActiveAgentID(null);
        if (e?.status && e.status !== 404) onError(e.message || "Failed to load environment agents.");
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [environment.id, environment.agents]);

  const loadContext = async (nextThreadID = threadRef.current) => {
    const agent = activeAgentRef.current;
    if (!agent) return;
    setContextLoading(true);
    setContextError(null);
    try {
      const next = await environmentsApi.agentContext(environment.id, nextThreadID || "main", agent.agent_id);
      setContext({
        id: next.id,
        iteration: next.iteration,
        model: next.model,
        count: next.count,
        total_chars: next.total_chars,
        messages: next.messages || [],
      });
    } catch (e) {
      setContextError((e as Error).message);
    } finally {
      setContextLoading(false);
    }
  };

  contextRefreshRef.current = () => {
    void loadContext(threadRef.current);
  };

  useEffect(() => {
    if (!activeAgent) {
      setStreamState("idle");
      setEvents([]);
      setContext(null);
      return;
    }
    void loadContext(threadRef.current);
  }, [environment.id, activeAgent?.agent_id]);

  useEffect(() => {
    if (!activeAgent) {
      setStreamState("idle");
      return;
    }
    setStreamState("connecting");
    const source = new EventSource(environmentsApi.agentEventsURL(environment.id, activeAgent.agent_id), { withCredentials: true });
    source.onopen = () => setStreamState("live");
    source.onmessage = (e) => {
      let ev: TelemetryEvent;
      try {
        ev = JSON.parse(e.data) as TelemetryEvent;
      } catch {
        return;
      }
      setEvents((prev) => {
        if (prev.some((seen) => seen.id && seen.id === ev.id)) return prev;
        return [...prev, ev].slice(-100);
      });
      if (!ev.thread_id || ev.thread_id === threadRef.current) {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          refreshTimerRef.current = null;
          contextRefreshRef.current();
        }, 350);
      }
    };
    source.onerror = () => {
      setStreamState(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    };
    return () => {
      source.close();
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [environment.id, activeAgent?.agent_id]);

  const spawn = async () => {
    const sourceID = Number(sourceAgentID);
    if (!sourceID) {
      onError("Pick a source agent to spawn into the environment.");
      return;
    }
    setBusy("spawn");
    try {
      const next = await environmentsApi.spawnAgent(environment.id, {
        source_agent_id: sourceID,
        directive: directive.trim() || undefined,
        alias: alias.trim() || undefined,
      });
      setEnvironmentAgents((prev) => [...prev.filter((agent) => agent.agent_id !== next.agent_id), next]);
      setActiveAgentID(next.agent_id);
      setAlias("");
      setDirective("");
      setEvents([]);
      setContext(null);
      setContextError(null);
      setShowSpawn(false);
      onAgentsChanged?.();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!activeAgent) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    setBusy("send");
    try {
      await environmentsApi.sendAgentEvent(environment.id, { message: trimmed, thread_id: threadID.trim() || "main" }, activeAgent.agent_id);
      setMessage("");
      void loadContext(threadID.trim() || "main");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const stop = async (agent: EnvironmentAgentStatus) => {
    setBusy("stop");
    try {
      await environmentsApi.stopAgent(environment.id, agent.agent_id);
      setEnvironmentAgents((prev) => {
        const next = prev.filter((item) => item.agent_id !== agent.agent_id);
        setActiveAgentID((current) => (current === agent.agent_id ? next[0]?.agent_id || null : current));
        return next;
      });
      setStopTarget(null);
      if (activeAgentID === agent.agent_id) {
        activeAgentRef.current = null;
        setStreamState("closed");
        setEvents([]);
        setContext(null);
      }
      onAgentsChanged?.();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 border-t border-border pt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text">Environment Agents</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass}`}>{statusLabel}</span>
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {activeAgent
              ? `${agentLabel(activeAgent)} - ${activeAgent.status || "running"} on port ${activeAgent.port} - telemetry ${streamState}`
              : "Spawn one or more project agents into this environment."}
          </div>
        </div>
        <button className="text-xs px-3 py-1.5 rounded border border-accent/50 text-accent hover:bg-accent/10" onClick={() => setShowSpawn(true)}>
          Spawn Agent
        </button>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-3">
        <div className="rounded border border-border bg-bg p-3 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-text-muted uppercase">Spawned Agents</h3>
            <span className="text-xs text-text-muted">{environmentAgents.length}</span>
          </div>
          {environmentAgents.length === 0 ? (
            <p className="text-xs text-text-muted">No agents running in this environment.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {environmentAgents.map((agent) => (
                <button
                  key={agent.agent_id}
                  className={`rounded border px-3 py-2 text-left hover:bg-bg-subtle ${
                    activeAgentID === agent.agent_id ? "border-accent bg-accent/10" : "border-border bg-bg-card"
                  }`}
                  onClick={() => setActiveAgentID(agent.agent_id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text truncate">{agentLabel(agent)}</span>
                    <span className="text-[11px] text-text-muted shrink-0">{agent.status || "running"} :{agent.port}</span>
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    source {agent.source_name || agent.source_agent_id || "agent"} - #{agent.agent_id}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-bg p-3 min-w-0">
          <h3 className="text-xs font-semibold text-text-muted uppercase mb-2">Selected Agent</h3>
          {activeAgent ? (
            <div className="space-y-2 text-xs">
              <div className="text-sm text-text">{agentLabel(activeAgent)}</div>
              <div className="text-text-muted">status {activeAgent.status || "running"}</div>
              <div className="text-text-muted">port {activeAgent.port}</div>
              <div className="text-text-muted">telemetry {streamState}</div>
              <button
                className="mt-2 text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                onClick={() => setStopTarget(activeAgent)}
                disabled={busy === "stop"}
              >
                Stop
              </button>
            </div>
          ) : (
            <p className="text-xs text-text-muted">No selected environment agent.</p>
          )}
        </div>
      </div>

      {activeAgent && (
        <>
          <h3 className="text-xs font-semibold text-text-muted uppercase">Drive {agentLabel(activeAgent)}</h3>
          <div className="grid lg:grid-cols-[150px_1fr_auto] gap-2 items-end">
            <label className="text-xs text-text-muted flex flex-col gap-1">
              Thread
              <input
                className={inputClass}
                value={threadID}
                onChange={(e) => setThreadID((e.target as HTMLInputElement).value)}
                placeholder="main"
              />
            </label>
            <label className="text-xs text-text-muted flex flex-col gap-1">
              Message
              <textarea
                className={`${inputClass} min-h-16 text-sm`}
                value={message}
                onChange={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
                placeholder="Send an event to the agent"
              />
            </label>
            <button className={`${buttonClass} mb-1`} onClick={send} disabled={busy === "send" || !message.trim()}>
              {busy === "send" ? "Sending..." : "Send"}
            </button>
          </div>

          <div className="grid xl:grid-cols-2 gap-3">
            <div className="rounded border border-border bg-bg p-3 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-xs font-semibold text-text-muted uppercase">Telemetry</h3>
                <span className="text-xs text-text-muted">{events.length} live events</span>
              </div>
              <div className="max-h-72 overflow-auto flex flex-col gap-2">
                {events.length === 0 ? (
                  <p className="text-xs text-text-muted">
                    {streamState === "live" ? "Waiting for agent telemetry." : `Telemetry ${streamState}.`}
                  </p>
                ) : (
                  [...events].reverse().map((ev, i) => <EnvironmentTelemetryRow key={ev.id || `${ev.time}-${i}`} event={ev} />)
                )}
              </div>
            </div>

            <div className="rounded border border-border bg-bg p-3 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <h3 className="text-xs font-semibold text-text-muted uppercase">Context</h3>
                  {context && (
                    <p className="text-[11px] text-text-muted">
                      {context.id} - {context.count} messages - iteration {context.iteration}
                    </p>
                  )}
                </div>
                <button className={buttonClass} onClick={() => loadContext(threadID.trim() || "main")} disabled={contextLoading || !activeAgent}>
                  {contextLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
              {contextError && <p className="text-xs text-red-400 mb-2">{contextError}</p>}
              <div className="max-h-72 overflow-auto flex flex-col gap-2">
                {!context ? (
                  <p className="text-xs text-text-muted">No context snapshot yet.</p>
                ) : context.messages.length === 0 ? (
                  <p className="text-xs text-text-muted">Context is empty.</p>
                ) : (
                  context.messages.map((msg, i) => <EnvironmentContextMessageRow key={i} message={msg} />)
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {stopTarget && (
        <ConfirmDialog
          title="Stop environment agent"
          body={`Stop ${agentLabel(stopTarget)} in ${environment.id}? The environment and its apps will stay running.`}
          confirmLabel={busy === "stop" ? "Stopping..." : "Stop agent"}
          tone="danger"
          busy={busy === "stop"}
          onCancel={() => {
            if (busy !== "stop") setStopTarget(null);
          }}
          onConfirm={() => stop(stopTarget)}
        />
      )}

      <Modal open={showSpawn} onClose={() => {
        if (busy !== "spawn") setShowSpawn(false);
      }} width="max-w-xl">
        <div className="p-4 border-b border-border">
          <h2 className="text-base font-semibold text-text">Spawn Agent</h2>
          <p className="mt-1 text-sm text-text-muted">Create an isolated copy of a project agent inside {environment.id}.</p>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-auto">
          <label className="text-xs text-text-muted flex flex-col gap-1">
            Source agent
            <select
              className={inputClass}
              value={sourceAgentID}
              onChange={(e) => setSourceAgentID((e.target as HTMLSelectElement).value)}
              disabled={agents.length === 0}
            >
              {agents.length === 0 ? (
                <option value="">No agents</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || `Agent ${agent.id}`} #{agent.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="text-xs text-text-muted flex flex-col gap-1">
            Alias
            <input className={inputClass} value={alias} onChange={(e) => setAlias((e.target as HTMLInputElement).value)} placeholder="main, reviewer, worker" />
          </label>
          <label className="text-xs text-text-muted flex flex-col gap-1">
            Directive override
            <textarea
              className={`${inputClass} min-h-28 text-sm`}
              value={directive}
              onChange={(e) => setDirective((e.target as HTMLTextAreaElement).value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button className={buttonClass} onClick={() => setShowSpawn(false)} disabled={busy === "spawn"}>Cancel</button>
          <button className="text-xs px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50" onClick={spawn} disabled={busy === "spawn" || agents.length === 0}>
            {busy === "spawn" ? "Spawning..." : "Spawn"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function EnvironmentTelemetryRow({ event }: { event: TelemetryEvent }) {
  return (
    <div className="rounded border border-border bg-bg-card px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-text">{event.type}</span>
        <span className="text-text-muted shrink-0">{formatTime(event.time)}</span>
      </div>
      <div className="text-text-muted break-words">{telemetrySummary(event)}</div>
      {event.thread_id && <div className="text-[11px] text-text-muted mt-1">thread {event.thread_id}</div>}
    </div>
  );
}

function agentLabel(agent: EnvironmentAgentStatus): string {
  const alias = (agent.alias || "").trim();
  if (alias) return `${alias} #${agent.agent_id}`;
  if (agent.source_name) return `${agent.source_name} #${agent.agent_id}`;
  return `Agent #${agent.agent_id}`;
}

function EnvironmentContextMessageRow({ message }: { message: ThreadContextMessage }) {
  const body = contextMessageBody(message);
  return (
    <div className="rounded border border-border bg-bg-card px-2 py-1.5 text-xs">
      <div className="font-mono text-text mb-1">{message.role || "message"}</div>
      {body && <pre className="whitespace-pre-wrap break-words text-text-muted font-sans">{body}</pre>}
      {(message.tool_calls || []).map((call, i) => (
        <div key={`call-${call.id || i}`} className="mt-1 text-text-muted">
          tool call: <span className="font-mono text-text">{call.name || call.id || "tool"}</span>{" "}
          {summarizeValue(call.arguments)}
        </div>
      ))}
      {(message.tool_results || []).map((result, i) => (
        <div key={`result-${result.id || i}`} className="mt-1 text-text-muted">
          tool result: <span className="font-mono text-text">{result.id || "result"}</span>{" "}
          {shortText(result.content || summarizeValue(result.image), 240)}
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const danger = tone === "danger";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-md rounded border border-border bg-bg-card shadow-xl">
        <div className="p-4 border-b border-border">
          <h2 className="text-base font-semibold text-text">{title}</h2>
        </div>
        <div className="p-4">
          <p className="text-sm text-text-muted">{body}</p>
        </div>
        <div className="p-4 border-t border-border flex justify-end gap-2">
          <button className={buttonClass} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`text-xs px-3 py-1.5 rounded border disabled:opacity-50 ${
              danger
                ? "border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-border bg-accent text-white hover:bg-accent-hover"
            }`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
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

function buildEnvironmentSystemMap(
  environment: EnvironmentSummary,
  agents: EnvironmentAgentStatus[],
  threadsByAgent: Record<number, Thread[]>,
  contexts: Record<string, EnvironmentAgentContext>,
  calls: InterceptedCall[],
  events: TelemetryEvent[],
  appBusEvents: EnvironmentAppBusEvent[],
): { nodes: SystemMapNode[]; edges: SystemMapEdge[]; activity: SystemMapActivity[]; stats: Array<{ label: string; value: string | number }> } {
  const nodes = new Map<string, SystemMapNode>();
  const edges = new Map<string, SystemMapEdge>();
  const activity: SystemMapActivity[] = [];
  const appNames = Object.keys(environment.apps || {});
	  const connections = environment.connections || [];
	  const subscriptions = environment.subscriptions || [];
	  const networkMode = environmentNetworkMode(environment);
  const integrationMode = environmentIntegrationMode(environment);
  const boundaryPortID = "boundary:network";
  const streamingToolByCall = new Map<string, string>();
  const threadStreamText = new Map<string, string>();

  const addNode = (node: SystemMapNode) => {
    const current = nodes.get(node.id);
    if (!current) {
      nodes.set(node.id, node);
      return;
    }
    const currentActiveAt = current.lastActiveAt || 0;
    const nodeActiveAt = node.lastActiveAt || 0;
	    nodes.set(node.id, {
	      ...current,
	      ...node,
	      badges: mergeBadges(current.badges, node.badges),
	      latest: latestNodeActivity(current.latest, node.latest),
	      activeKind: nodeActiveAt >= currentActiveAt ? node.activeKind || current.activeKind : current.activeKind,
	      lastActiveAt: Math.max(currentActiveAt, nodeActiveAt) || undefined,
	    });
	  };
  const touchNodeActivity = (id: string, activeKind: SystemMapEdgeKind, time: number) => {
    const current = nodes.get(id);
    if (!current) return;
    nodes.set(id, {
      ...current,
      status: current.kind === "thread" ? "running" : current.status,
      activeKind,
      lastActiveAt: Math.max(current.lastActiveAt || 0, time),
    });
  };
  const setThreadLatest = (id: string, kind: SystemMapNodeLatestKind, text: string, time: number) => {
    const current = nodes.get(id);
    if (!current) return;
    const compact = shortText(text, 58);
    if (!compact) return;
    nodes.set(id, {
      ...current,
      latest: latestNodeActivity(current.latest, { kind, text: compact, time }),
    });
  };
  const appendThreadStream = (id: string, kind: Extract<SystemMapNodeLatestKind, "thinking" | "message">, data: Record<string, unknown>, time: number) => {
    const text = String(data.text || "");
    if (!text) return;
    const streamKey = `${id}:${kind}:${String(data.iteration || data.id || data.call_id || "latest")}`;
    const next = `${threadStreamText.get(streamKey) || ""}${text}`.slice(-1000);
    threadStreamText.set(streamKey, next);
    setThreadLatest(id, kind, next, time);
  };
  const addEdge = (edge: SystemMapEdge) => {
    const current = edges.get(edge.id);
    if (!current) {
      edges.set(edge.id, edge);
      return;
    }
    edges.set(edge.id, {
      ...current,
      kind:
        (edge.lastActiveAt || edge.softActiveAt || 0) >= (current.lastActiveAt || current.softActiveAt || 0) &&
        (edge.lastActiveAt || edge.softActiveAt)
          ? edge.kind
          : current.kind,
      count: Math.max(current.count || 0, edge.count || 0),
      lastActiveAt: Math.max(current.lastActiveAt || 0, edge.lastActiveAt || 0) || undefined,
      softActiveAt: Math.max(current.softActiveAt || 0, edge.softActiveAt || 0) || undefined,
      packetDirection:
        (edge.lastActiveAt || 0) >= (current.lastActiveAt || 0)
          ? edge.packetDirection || current.packetDirection
          : current.packetDirection,
      label: edge.label || current.label,
      status: edge.status || current.status,
      detail: edge.detail || current.detail,
    });
  };

  appNames.forEach((name, index) => {
    const app = environment.apps[name];
    addNode({
      id: appNodeID(name),
      kind: "app",
      label: name,
      status: app?.kind === "install" ? "running" : "unknown",
      subtitle: app?.kind === "install" ? `install #${app.install_id}` : app?.kind || "app",
      detail: app?.data_dir ? `Data dir: ${app.data_dir}` : app?.url || "",
      ...appSlot(index, Math.max(1, appNames.length), agents.length > 0),
    });
  });

  const appNameByInstallID = new Map<number, string>();
  appNames.forEach((name) => {
    const installID = environment.apps[name]?.install_id;
    if (installID) appNameByInstallID.set(installID, name);
  });

  appNames.forEach((name) => {
    const bindings = environment.apps[name]?.bindings || {};
    Object.entries(bindings).forEach(([role, installID]) => {
      const targetName = appNameByInstallID.get(Number(installID));
      if (!targetName || targetName === name) return;
      addEdge({
        id: `appdep:${appNodeID(name)}:${appNodeID(targetName)}`,
        source: appNodeID(name),
        target: appNodeID(targetName),
        kind: "tool",
        status: "ok",
        label: `requires ${role}`,
        detail: `${name} is bound to ${targetName} install #${installID}`,
      });
    });
  });

  const rawCalls = calls.filter((call) => !connectionForHost(call.host || "", connections));
  const topologyNetworkCalls = rawCalls.filter((call) => shouldShowNetworkCallOnMap(call, networkMode));
  if (topologyNetworkCalls.length > 0) {
    addNode({
      id: boundaryPortID,
      kind: "gateway",
      label: "network",
      status: networkMode === "block" ? "blocked" : "running",
      subtitle: networkMode,
      detail: `Network policy: ${networkMode}\nProxy: ${environment.proxy_url}`,
      x: 94,
      y: agents.length > 0 ? 55 : 50,
    });
  }

	  agents.forEach((agent, index) => {
    const agentThreads = threadsByAgent[agent.agent_id] || [];
    const agentID = agentNodeID(agent.agent_id);
    addNode({
      id: agentID,
      kind: "agent",
      label: agent.alias || agent.source_name || `Agent ${agent.agent_id}`,
      status: ((agent.status || "running") === "running" ? "running" : "idle") as SystemMapStatus,
      subtitle: `${agent.source_name || "source agent"} #${agent.agent_id}`,
      detail: `Port ${agent.port}`,
      ...agentSlot(index, Math.max(1, agents.length)),
	  });

	    agentThreads.forEach((thread, threadIndex) => {
      const threadID = threadNodeID(agent.agent_id, thread.id);
      addNode({
        id: threadID,
        kind: "thread",
        label: thread.id || "main",
        status: thread.rate === "sleep" || thread.rate?.includes("h") ? "idle" : "running",
        subtitle: `${thread.model || "model"} - ${thread.rate || "active"}`,
        detail: thread.directive || "",
        ...threadSlot(index, agents.length, threadIndex, agentThreads.length),
      });
      addEdge({
        id: `owns:${agentID}:${threadID}`,
        source: agentID,
        target: threadID,
        kind: "owns",
        label: "thread",
        status: "ok",
      });
      (thread.mcp_names || []).forEach((name) => {
        if (isHiddenSystemTool(name)) return;
        const connection = connectionForTool(name, connections);
        if (connection) {
        addEdge({
          id: `mcp:${threadID}:${connectionNodeID(connection.id)}`,
          source: threadID,
          target: connectionNodeID(connection.id),
          kind: "tool",
          label: `${connection.app_slug} MCP`,
          status: connection.status === "disabled" ? "warning" : "ok",
          detail: `${connection.name || connection.app_name || connection.app_slug}\n${integrationMode} connection MCP`,
        });
        return;
      }
        if (!appNames.includes(name)) return;
        addEdge({
          id: `mcp:${threadID}:${appNodeID(name)}`,
          source: threadID,
          target: appNodeID(name),
          kind: "tool",
          label: `${name} MCP`,
          status: "ok",
        });
      });
	    });
	  });

	  subscriptions.forEach((sub, index) => {
	    const sourceID = sub.app && appNames.includes(sub.app) ? appNodeID(sub.app) : "external:events";
	    const targetAgent = agents.find((agent) => (agent.alias || "main") === (sub.target_agent_alias || "main") || agent.agent_id === sub.target_agent_id);
	    const targetThread = targetAgent ? threadNodeID(targetAgent.agent_id, sub.thread_id || "main") : "";
	    const badge = `sub ${shortText(sub.topic || "event", 18)}`;
	    if (sub.app && appNames.includes(sub.app)) {
	      const appInfo = environment.apps[sub.app];
	      addNode({
	        id: sourceID,
	        kind: "app",
	        label: sub.app,
	        status: appInfo?.kind === "install" ? "running" : "unknown",
	        subtitle: appInfo?.kind === "install" ? `install #${appInfo.install_id}` : appInfo?.kind || "app",
	        badges: [badge],
	      });
	    } else {
	      addNode({ id: sourceID, kind: "event", label: "events", status: "running", subtitle: "incoming", badges: [badge], x: 18, y: 50 });
	    }
	    if (!targetAgent || !targetThread) return;
	    if (!nodes.has(targetThread)) {
	      const agentIndex = Math.max(0, agents.findIndex((agent) => agent.agent_id === targetAgent.agent_id));
	      addNode({
	        id: targetThread,
	        kind: "thread",
	        label: sub.thread_id || "main",
	        status: "idle",
	        subtitle: "subscribed",
	        ...threadSlot(agentIndex, Math.max(1, agents.length), index, Math.max(1, subscriptions.length)),
	      });
	      addEdge({
	        id: `owns:${agentNodeID(targetAgent.agent_id)}:${targetThread}`,
	        source: agentNodeID(targetAgent.agent_id),
	        target: targetThread,
	        kind: "owns",
	        label: "thread",
	        status: "ok",
	      });
	    }
	    addEdge({
	      id: subscriptionEdgeID(sourceID, targetThread, sub),
	      source: sourceID,
	      target: targetThread,
	      kind: "event",
	      status: sub.status === "active" ? "ok" : "warning",
	      label: sub.topic || "event",
	      detail: `${sub.name || sub.id}\n${sub.description || ""}\n${sub.subscription_id ? `row ${sub.subscription_id}` : sub.status}`,
	    });
	  });

	  Object.entries(contexts).forEach(([key, context]) => {
    const [agentID] = key.split(":");
    const source = threadNodeID(Number(agentID), context.id || "main");
    context.messages.forEach((message) => {
      (message.tool_calls || []).forEach((call) => {
        const tool = call.name || "";
        if (isHiddenSystemTool(tool)) return;
        const app = appForTool(tool, appNames);
        const connection = connectionForTool(tool, connections);
        const target = app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : "";
        if (!target) return;
        addEdge({
          id: `tool:${source}:${target}`,
          source,
          target,
          kind: "tool",
          label: tool,
          status: "ok",
          count: 1,
          detail: `${tool}\n${shortText(summarizeValue(call.arguments), 320)}`,
        });
      });
    });
  });

  const externalHosts = Array.from(new Set(topologyNetworkCalls.map((call) => call.host).filter(Boolean))).slice(0, 8);
  externalHosts.forEach((host, index) => {
    addNode({
      id: externalNodeID(host),
      kind: "external",
      label: host,
      status: "unknown",
      subtitle: "outside",
      detail: host,
      ...externalSlot(index, externalHosts.length, 32),
    });
  });
  connections.forEach((conn, index) => {
    const id = connectionNodeID(conn.id);
    addNode({
      id,
      kind: "external",
      label: conn.name || conn.app_name || conn.app_slug,
      status: connectionMapStatus(conn, integrationMode),
      subtitle: connectionSubtitle(integrationMode),
      detail: `${conn.app_slug} #${conn.id}\nIntegrations: ${integrationMode}`,
      iconUrl: connectionIconUrl(conn),
      ...externalSlot(index, connections.length, 50),
    });
  });

  calls.forEach((call, index) => {
    const mappedConnection = connectionForHost(call.host || "", connections);
    const time = Date.parse(call.ts) || Date.now();
    const target = externalNodeID(call.host || "outside");
    const status = statusForCall(call);
    if (mappedConnection) {
      const connectionID = connectionNodeID(mappedConnection.id);
      touchNodeActivity(connectionID, "boundary", time);
      activity.push({
        id: `call:${index}:${call.ts}`,
        time,
        source: connectionID,
        target: connectionID,
        label: `${call.method} ${mappedConnection.app_slug}`,
        detail: `${callDisposition(call)} ${call.path}`,
        status,
      });
      return;
    }
    if (!shouldShowNetworkCallOnMap(call, networkMode)) return;
    addEdge({
      id: `boundary:${boundaryPortID}:${target}`,
      source: boundaryPortID,
      target,
      kind: "boundary",
      status,
      label: call.method,
      count: (edges.get(`boundary:${boundaryPortID}:${target}`)?.count || 0) + 1,
      lastActiveAt: time || undefined,
      detail: `${call.method} ${call.host}${call.path}\n${callDisposition(call)} ${call.status || ""}`,
    });
    activity.push({
      id: `call:${index}:${call.ts}`,
      time,
      source: boundaryPortID,
      target,
      label: `${call.method} ${call.host}`,
      detail: `${callDisposition(call)} ${call.path}`,
      status,
    });
  });

  [...events]
    .sort((a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0))
    .forEach((event) => {
    const time = Date.parse(event.time) || Date.now();
    const threadID = threadNodeID(event.instance_id, event.thread_id || "main");
    const data = event.data || {};
    if (!nodes.has(threadID)) {
      addNode({
        id: threadID,
        kind: "thread",
        label: event.thread_id || "main",
        status: "running",
        subtitle: "live",
      });
    }
    touchNodeActivity(threadID, telemetryActivityKind(event.type), time);
    if (event.type === "thread.spawn") {
      const spawned = String(data.thread_id || data.id || data.name || data.to || "");
      if (spawned) {
        const target = threadNodeID(event.instance_id, spawned);
        addNode({
          id: target,
          kind: "thread",
          label: spawned,
          status: "running",
          subtitle: "spawned",
          detail: String(data.directive || ""),
        });
        touchNodeActivity(target, "message", time);
        setThreadLatest(threadID, "message", `spawned ${spawned}`, time);
        addEdge({
          id: `spawn:${threadID}:${target}`,
          source: threadID,
          target,
          kind: "message",
          status: "running",
          label: "spawn",
          lastActiveAt: time,
        });
      }
    }
	    if (event.type === "event.received") {
	      const snippet = eventSnippet(data);
	      setThreadLatest(threadID, "event", snippet || "incoming event", time);
	      const routed = subscriptionForDeliveredEvent(event, subscriptions, agents);
	      if (routed) {
	        const sourceID = routed.app && appNames.includes(routed.app) ? appNodeID(routed.app) : "external:events";
	        touchNodeActivity(sourceID, "event", time);
	        addEdge({
	          id: subscriptionEdgeID(sourceID, threadID, routed),
	          source: sourceID,
	          target: threadID,
	          kind: "event",
	          status: "running",
	          label: snippet || routed.topic || "event",
	          lastActiveAt: time,
	          detail: snippet ? `${routed.app}.${routed.topic}\n${snippet}` : `${routed.app}.${routed.topic}`,
	        });
	      } else {
	        addNode({ id: "external:events", kind: "event", label: "events", status: "running", subtitle: "incoming", x: 18, y: 50 });
	        addEdge({
	          id: `event:external:events:${threadID}`,
	          source: "external:events",
	          target: threadID,
	          kind: "event",
	          status: "running",
	          label: snippet || "event",
	          lastActiveAt: time,
	          detail: snippet ? `event\n${snippet}` : "event",
	        });
	      }
	    }
    if (event.type === "tool.call" || event.type === "tool.result") {
      const tool = String(data.name || data.tool || "");
      if (isHiddenSystemTool(tool)) {
        const activityItem = activityFromTelemetry(event, appNames, connections);
        if (activityItem) activity.push(activityItem);
        return;
      }
      const app = appForTool(tool, appNames);
      const connection = connectionForTool(tool, connections);
      const targetID = app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : "";
      const isResult = event.type === "tool.result";
      setThreadLatest(
        threadID,
        isResult ? (data.is_error ? "error" : "result") : "tool",
        isResult ? (data.is_error ? `${shortToolName(tool)} failed` : `${shortToolName(tool)} ok`) : shortToolName(tool),
        time,
      );
      if (targetID) {
        const edgeID = `tool:${threadID}:${targetID}`;
        addEdge({
          id: edgeID,
          source: threadID,
          target: targetID,
          kind: "tool",
          status: isResult && data.is_error ? "error" : "running",
          label: isResult ? `${tool} result` : tool,
          count: (edges.get(edgeID)?.count || 0) + 1,
          lastActiveAt: time,
          packetDirection: isResult ? "reverse" : "forward",
          detail: isResult ? `${tool} result` : tool,
        });
      }
    }
    if (event.type === "llm.tool_chunk") {
      const key = toolChunkKey(threadID, data);
      const detectedTool = toolNameFromTelemetry(data, appNames, connections);
      const tool = detectedTool || streamingToolByCall.get(key) || "";
      if (isHiddenSystemTool(tool)) {
        const activityItem = activityFromTelemetry(event, appNames, connections);
        if (activityItem) activity.push(activityItem);
        return;
      }
      if (detectedTool) streamingToolByCall.set(key, detectedTool);
      setThreadLatest(threadID, "tool", tool ? `preparing ${shortToolName(tool)}` : "preparing tool call", time);
      const app = appForTool(tool, appNames);
      const connection = connectionForTool(tool, connections);
      const targetID = app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : "";
      if (targetID) {
        addEdge({
          id: `tool:${threadID}:${targetID}`,
          source: threadID,
          target: targetID,
          kind: "tool",
          status: "running",
          label: tool,
          softActiveAt: time,
          detail: tool ? `preparing ${tool}` : "preparing tool call",
        });
      }
    }
    if (event.type === "llm.start") {
      setThreadLatest(threadID, "thinking", "thinking", time);
    }
    if (event.type === "llm.thinking" && data.text) {
      appendThreadStream(threadID, "thinking", data, time);
    }
    if (event.type === "llm.chunk" && data.text) {
      appendThreadStream(threadID, "message", data, time);
    }
    if (event.type === "llm.done") {
      const finalMessage = String(data.message || data.summary || "");
      if (finalMessage) setThreadLatest(threadID, "message", finalMessage, time);
    }
    if (event.type === "llm.error") {
      setThreadLatest(threadID, "error", String(data.error || data.message || "LLM error"), time);
    }
    if (event.type === "thread.message") {
      setThreadLatest(threadID, "message", String(data.message || data.text || "thread message"), time);
    }
    const activityItem = activityFromTelemetry(event, appNames, connections);
    if (activityItem) activity.push(activityItem);
  });

  [...appBusEvents]
    .sort((a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0))
    .forEach((event) => {
      const sourceName = event.app;
      if (!sourceName || !appNames.includes(sourceName)) return;
      const time = Date.parse(event.time) || Date.now();
      const sourceID = appNodeID(sourceName);
      const dependents = appNames.filter((name) =>
        Object.values(environment.apps[name]?.bindings || {}).some((installID) => Number(installID) === Number(event.install_id)),
      );
	      touchNodeActivity(sourceID, "event", time);
	      const detail = appBusEventDetail(event);
	      subscriptions
	        .filter((sub) => sub.app === sourceName && topicMatches(sub.topic || "", event.topic || ""))
	        .forEach((sub) => {
	          const targetAgent = agents.find((agent) => (agent.alias || "main") === (sub.target_agent_alias || "main") || agent.agent_id === sub.target_agent_id);
	          const targetThread = targetAgent ? threadNodeID(targetAgent.agent_id, sub.thread_id || "main") : "";
	          if (!targetThread) return;
	          const edgeID = subscriptionEdgeID(sourceID, targetThread, sub);
	          addEdge({
	            id: edgeID,
	            source: sourceID,
	            target: targetThread,
	            kind: "event",
	            status: "running",
	            label: event.topic || sub.topic || "app event",
	            count: (edges.get(edgeID)?.count || 0) + 1,
	            lastActiveAt: time,
	            detail,
	          });
	        });
	      if (dependents.length === 0) {
        activity.push({
          id: `appbus:${event.app}:${event.seq}`,
          time,
          source: sourceID,
          label: event.topic || "app event",
          detail,
          status: "ok",
        });
        return;
      }
      dependents.forEach((targetName) => {
        const targetID = appNodeID(targetName);
        touchNodeActivity(targetID, "event", time);
        const edgeID = `appdep:${targetID}:${sourceID}`;
        addEdge({
          id: edgeID,
          source: targetID,
          target: sourceID,
          kind: "event",
          status: "running",
          label: event.topic || "app event",
          count: (edges.get(edgeID)?.count || 0) + 1,
          lastActiveAt: time,
          packetDirection: "reverse",
          detail,
        });
        activity.push({
          id: `appbus:${event.app}:${event.seq}:${targetName}`,
          time,
          source: sourceID,
          target: targetID,
          label: event.topic || "app event",
          detail,
          status: "ok",
        });
      });
    });

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    activity: activity.sort((a, b) => a.time - b.time).slice(-80),
    stats: [
      { label: "agents", value: agents.length },
      { label: "apps", value: appNames.length },
	      { label: "threads", value: Object.values(threadsByAgent).reduce((n, list) => n + list.length, 0) },
	      { label: "subscriptions", value: subscriptions.length },
	      { label: "calls", value: calls.length },
      { label: "network", value: networkMode },
      { label: "integrations", value: integrationMode },
    ],
  };
}

function appSlot(index: number, total: number, hasAgents: boolean) {
  if (!hasAgents && total <= 1) return { x: 38, y: 43 };
  if (!hasAgents) return gridSlot(index, total, 16, 84, 36, 10, 7);
  if (total <= 1) return { x: 30, y: 76 };
  return gridSlot(index, total, 14, 86, 58, 9, 7);
}

function agentSlot(index: number, total: number) {
  if (total <= 1) return { x: 57, y: 34 };
  return gridSlot(index, total, 20, 80, 25, 18, 4);
}

function gridSlot(index: number, total: number, leftX: number, rightX: number, startY: number, rowStep: number, maxColumns: number) {
  if (total <= 1) return { x: (leftX + rightX) / 2, y: startY };
  const columns = layoutColumns(total, maxColumns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  const rowItems = Math.min(columns, total - row * columns);
  const rowLeft = rowItems === columns ? leftX : leftX + ((columns - rowItems) * (rightX - leftX)) / Math.max(1, columns - 1) / 2;
  const rowRight = rowItems === columns ? rightX : rightX - ((columns - rowItems) * (rightX - leftX)) / Math.max(1, columns - 1) / 2;
  const x = rowItems <= 1 ? (leftX + rightX) / 2 : rowLeft + (col * (rowRight - rowLeft)) / Math.max(1, rowItems - 1);
  const y = startY + row * rowStep;
  return { x, y };
}

function externalSlot(index: number, total: number, centerY: number) {
  if (total <= 1) return { x: 114, y: centerY };
  const span = Math.min(96, Math.max(34, (total - 1) * 8));
  const start = Math.max(10, centerY - span / 2);
  return { x: 114, y: start + (index * span) / Math.max(1, total - 1) };
}

function layoutColumns(total: number, maxColumns: number) {
  if (total <= 0) return 1;
  if (total <= 2) return total;
  if (total <= 4) return total;
  if (total <= 8) return Math.min(total, 4);
  if (total <= 14) return Math.min(total, 5);
  if (total <= 24) return Math.min(total, 6);
  return Math.min(total, maxColumns);
}

function threadSlot(agentIndex: number, agentCount: number, threadIndex: number, threadCount: number) {
  const baseX = agentCount <= 1 ? 68 : 38 + (agentIndex * 42) / Math.max(1, agentCount - 1);
  const offset = threadCount <= 1 ? 0 : (threadIndex - (threadCount - 1) / 2) * 9;
  return { x: Math.max(28, Math.min(82, baseX + offset)), y: 54 + (threadIndex % 3) * 10 };
}

function agentNodeID(id: number) {
  return `agent:${id}`;
}

function threadNodeID(agentID: number, threadID: string) {
  return `thread:${agentID}:${threadID || "main"}`;
}

function appNodeID(name: string) {
  return `app:${name}`;
}

function externalNodeID(name: string) {
  return `external:${name}`;
}

function connectionNodeID(id: number) {
  return `external:connection:${id}`;
}

function subscriptionEdgeID(sourceID: string, targetThreadID: string, sub: EnvironmentSubscriptionInfo): string {
  return `subscription:${sourceID}:${targetThreadID}:${sub.id || `${sub.app}:${sub.topic}`}`;
}

function mergeBadges(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...(a || []), ...(b || [])].filter(Boolean);
  if (merged.length === 0) return undefined;
  return Array.from(new Set(merged));
}

function subscriptionForDeliveredEvent(
  event: TelemetryEvent,
  subscriptions: EnvironmentSubscriptionInfo[],
  agents: EnvironmentAgentStatus[],
): EnvironmentSubscriptionInfo | null {
  const delivered = parseDeliveredAppEvent(event);
  if (!delivered) return null;
  const threadID = event.thread_id || "main";
  return subscriptions.find((sub) => {
    if (sub.app !== delivered.app || !topicMatches(sub.topic || "", delivered.topic)) return false;
    if ((sub.thread_id || "main") !== threadID) return false;
    const target = agents.find((agent) => agent.agent_id === event.instance_id);
    if (!target) return sub.target_agent_id === event.instance_id;
    return (sub.target_agent_alias || "main") === (target.alias || "main") || sub.target_agent_id === target.agent_id;
  }) || null;
}

function parseDeliveredAppEvent(event: TelemetryEvent): { app: string; topic: string } | null {
  const candidates = [
    String((event.data || {}).source || ""),
    String((event.data || {}).message || ""),
    String((event.data || {}).text || ""),
    String((event.data || {}).event || ""),
  ];
  for (const value of candidates) {
    const match = value.match(/\[app:([^:\]]+):([^\]]+)\]/);
    if (match) return { app: match[1], topic: match[2] };
  }
  return null;
}

function topicMatches(pattern: string, topic: string): boolean {
  if (!pattern || !topic) return false;
  if (pattern === topic || pattern === "*") return true;
  if (pattern.endsWith("*")) return topic.startsWith(pattern.slice(0, -1));
  return false;
}

function appForTool(tool: string, appNames: string[]): string | null {
  if (!tool) return null;
  return appNames.find((name) => tool === name || tool.startsWith(`${name}_`) || tool.startsWith(`${name}.`)) || null;
}

const hiddenSystemTools = new Set(["pace", "done", "channels_respond", "channels_send", "channels_status"]);

function isHiddenSystemTool(tool: string): boolean {
  const normalized = String(tool || "").trim().toLowerCase();
  return !!normalized && (hiddenSystemTools.has(normalized) || normalized.startsWith("channels_"));
}

function connectionForTool(tool: string, connections: EnvironmentConnectionInfo[]): EnvironmentConnectionInfo | null {
  if (!tool) return null;
  const normalizedTool = normalizeToolToken(tool);
  return connections.find((conn) => {
    const aliases = [conn.app_slug, conn.app_name, conn.name].map(normalizeToolToken).filter(Boolean);
    return aliases.some((alias) => normalizedTool === alias || normalizedTool.startsWith(`${alias}_`) || normalizedTool.startsWith(`${alias}.`));
  }) || null;
}

function connectionForHost(host: string, connections: EnvironmentConnectionInfo[]): EnvironmentConnectionInfo | null {
  if (!host) return null;
  const compactHost = compactToken(host);
  return connections.find((conn) => {
    const aliases = [conn.app_slug, conn.app_name, conn.name].map(compactToken).filter(Boolean);
    return aliases.some((alias) => alias.length >= 3 && compactHost.includes(alias));
  }) || null;
}

function environmentNetworkMode(environment: EnvironmentSummary): string {
  const explicit = String(environment.network_mode || "").trim();
  if (explicit) return explicit;
  const legacy = String(environment.mode || "").trim();
  return legacy === "mock" || !legacy ? "passthrough" : legacy;
}

function environmentIntegrationMode(environment: EnvironmentSummary): string {
  const explicit = String(environment.integration_mode || "").trim();
  if (explicit) return explicit;
  return "mock";
}

function connectionMapStatus(conn: EnvironmentConnectionInfo, mode: string): SystemMapStatus {
  if (conn.status === "disabled") return "warning";
  if (mode === "mock") return "mocked";
  return "ok";
}

function connectionSubtitle(mode: string): string {
  if (mode === "mock") return "mocked";
  if (mode === "real") return "real";
  return mode || "connection";
}

function connectionIconUrl(conn: EnvironmentConnectionInfo): string | undefined {
  if (conn.logo) return conn.logo;
  if (normalizeToolToken(conn.app_slug) === "pushover") return "https://www.google.com/s2/favicons?domain=pushover.net&sz=128";
  return undefined;
}

function normalizeToolToken(value: string | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function compactToken(value: string | undefined): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toolChunkKey(threadID: string, data: Record<string, unknown>): string {
  return `${threadID}:${String(data.id || data.call_id || data.tool_call_id || data.index || "latest")}`;
}

function toolNameFromTelemetry(data: Record<string, unknown>, appNames: string[], connections: EnvironmentConnectionInfo[]): string {
  const nestedFunction = data.function && typeof data.function === "object" ? (data.function as Record<string, unknown>) : undefined;
  const candidates = [
    data.tool,
    data.name,
    data.tool_name,
    data.function_name,
    nestedFunction?.name,
  ];
  for (const candidate of candidates) {
    const tool = String(candidate || "");
    if (isHiddenSystemTool(tool)) continue;
    if (appForTool(tool, appNames) || connectionForTool(tool, connections)) return tool;
  }
  const chunkTool = toolNameFromText(String(data.chunk || data.delta || data.text || ""), appNames, connections);
  return chunkTool || "";
}

function toolNameFromText(text: string, appNames: string[], connections: EnvironmentConnectionInfo[]): string {
  if (!text) return "";
  const aliases = [...appNames, ...connections.flatMap((conn) => [conn.app_slug, conn.app_name, conn.name])].filter(Boolean);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`["']?(${escaped}[_.][A-Za-z0-9_.:-]+)["']?`));
    if (match?.[1]) return match[1];
  }
  return "";
}

function statusForCall(call: InterceptedCall): SystemMapStatus {
  if (call.blocked) return "blocked";
  if (call.mocked) return "mocked";
  if (call.status >= 400) return "error";
  if (call.allowed || call.recorded) return "ok";
  return "unknown";
}

function callDisposition(call: InterceptedCall): string {
  if (call.mocked) return "mocked";
  if (call.blocked) return "blocked";
  if (call.recorded) return "recorded";
  if (call.allowed) return "allowed";
  return "seen";
}

function shouldShowNetworkCallOnMap(call: InterceptedCall, networkMode: string): boolean {
  if (call.blocked || call.mocked || call.recorded) return true;
  if ((call.status || 0) >= 400) return true;
  return networkMode !== "passthrough" && !call.allowed;
}

function latestNodeActivity(
  current: SystemMapNode["latest"] | undefined,
  next: SystemMapNode["latest"] | undefined,
): SystemMapNode["latest"] | undefined {
  if (!next?.text) return current;
  if (!current?.text) return next;
  return (next.time || 0) >= (current.time || 0) ? next : current;
}

function shortToolName(tool: string): string {
  const compact = String(tool || "tool").trim();
  if (!compact) return "tool";
  const parts = compact.split(/[_.]/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join("_");
  return compact;
}

function eventSnippet(data: Record<string, unknown>): string {
  const candidate =
    data.message ||
    data.text ||
    data.event ||
    data.payload ||
    data.input ||
    data.body ||
    data;
  return shortText(summarizeValue(candidate), 42);
}

function appBusEventKey(event: EnvironmentAppBusEvent): string {
  return `${event.app}:${event.project_id}:${event.seq}:${event.topic}`;
}

function appBusEventDetail(event: EnvironmentAppBusEvent): string {
  const snippet = shortText(summarizeValue(event.data), 140);
  return snippet ? `${event.app}.${event.topic}\n${snippet}` : `${event.app}.${event.topic}`;
}

function telemetryActivityKind(type: string): SystemMapEdgeKind {
  if (type === "event.received") return "event";
  if (type === "tool.call" || type === "tool.result") return "tool";
  if (type === "thread.spawn" || type === "thread.message") return "message";
  if (type.startsWith("llm.") || type.includes("chunk") || type.includes("delta")) return "message";
  return "message";
}

function activityFromTelemetry(event: TelemetryEvent, appNames: string[], connections: EnvironmentConnectionInfo[]): SystemMapActivity | null {
  const data = event.data || {};
  const time = Date.parse(event.time) || Date.now();
  const thread = event.thread_id || "main";
  const targetThread = threadNodeID(event.instance_id, thread);
  switch (event.type) {
    case "tool.call": {
      const tool = String(data.name || data.tool || "tool");
      if (isHiddenSystemTool(tool)) return null;
      const app = appForTool(tool, appNames);
      const connection = connectionForTool(tool, connections);
      return {
        id: event.id || `${time}:tool.call:${tool}`,
        time,
        source: targetThread,
        target: app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : undefined,
        label: tool,
        detail: shortText(summarizeValue(data.args || data.arguments || data.reason), 180),
        status: "running",
      };
    }
    case "tool.result": {
      const tool = String(data.name || data.tool || "tool");
      if (isHiddenSystemTool(tool)) return null;
      const app = appForTool(tool, appNames);
      const connection = connectionForTool(tool, connections);
      return {
        id: event.id || `${time}:tool.result:${tool}`,
        time,
        source: app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : undefined,
        target: targetThread,
        label: `${tool} result`,
        detail: data.is_error ? shortText(String(data.error || data.message || ""), 180) : "completed",
        status: data.is_error ? "error" : "ok",
      };
    }
    case "thread.spawn":
      return {
        id: event.id || `${time}:thread.spawn`,
        time,
        source: targetThread,
        target: threadNodeID(event.instance_id, String(data.thread_id || data.id || data.name || "")),
        label: "spawned thread",
        detail: String(data.thread_id || data.id || data.name || ""),
        status: "running",
      };
    case "thread.message":
      return {
        id: event.id || `${time}:thread.message`,
        time,
        source: targetThread,
        label: "thread message",
        detail: shortText(String(data.message || data.text || ""), 180),
        status: "ok",
      };
    case "event.received":
      return {
        id: event.id || `${time}:event.received`,
        time,
        source: "external:events",
        target: targetThread,
        label: "incoming event",
        detail: eventSnippet(data),
        status: "running",
      };
    case "llm.done":
      return {
        id: event.id || `${time}:llm.done`,
        time,
        source: targetThread,
        label: "reasoning step",
        detail: String(data.model || ""),
        status: "ok",
      };
    case "error":
    case "llm.error":
      return {
        id: event.id || `${time}:error`,
        time,
        source: targetThread,
        label: "error",
        detail: shortText(String(data.error || data.message || ""), 180),
        status: "error",
      };
    default:
      return null;
  }
}

function telemetrySummary(event: TelemetryEvent): string {
  const data = event.data || {};
  const candidates = [
    data.message,
    data.error,
    data.final_response,
    data.response,
    data.content,
    data.text,
    data.name,
    data.tool_name,
    data.tool,
  ];
  const first = candidates.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
  if (first !== undefined) return shortText(summarizeValue(first), 240);
  const compact = { ...data };
  for (const key of ["prompt", "messages", "context"]) {
    if (compact[key] !== undefined) compact[key] = shortText(summarizeValue(compact[key]), 80);
  }
  return shortText(summarizeValue(compact), 240);
}

function contextMessageBody(message: ThreadContextMessage): string {
  if (message.content) return shortText(String(message.content), 1200);
  const parts = message.parts || [];
  if (parts.length === 0) return "";
  return parts
    .map((part) => {
      if (part.text) return part.text;
      if (part.image_url?.url) return `[image] ${part.image_url.url}`;
      if (part.audio_url?.url) return `[audio] ${part.audio_url.url}`;
      if (part.input_audio) return `[input_audio] ${part.input_audio.format}`;
      return `[${part.type || "part"}]`;
    })
    .join("\n");
}

function summarizeValue(value: any): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shortText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1))}...`;
}

function formatTime(value: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleTimeString();
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
