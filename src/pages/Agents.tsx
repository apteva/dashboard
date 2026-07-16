import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { instances, core, instanceSkills, agentCoreRollouts, type Agent, type AgentCoreRollout, type InstanceSkill, type MCPServerConfig, type RunMode } from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { Modal } from "../components/Modal";
import { sleepClassName, sleepLabel, sleepTitle, type SleepLike } from "../utils/sleepStatus";
import { structureDirectiveDraft } from "../utils/directiveMarkdown";
import { AgentCurrentStatus, useCurrentStatuses } from "../components/dashboard/CurrentStatuses";

type AgentLiveStatus = { threads: number; iter: number; rate: string } & SleepLike;
type AgentsViewMode = "cards" | "list";

function mcpNamesFromConfig(servers?: MCPServerConfig[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const server of servers || []) {
    const name = (server?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function mcpNamesFromAgentConfig(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { mcp_servers?: MCPServerConfig[] };
    return mcpNamesFromConfig(parsed.mcp_servers);
  } catch {
    return [];
  }
}

// Agents is the fleet-list view: all instances in the current project,
// with status + quick lifecycle actions + a create form. Clicking a row
// navigates to /instances/:id which renders the full AgentView.
export function Agents() {
  usePageTitle("Agents");

  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const navigate = useNavigate();

  const [list, setList] = useState<Agent[]>([]);
  const [agentSkills, setAgentSkills] = useState<Record<number, InstanceSkill[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [name, setName] = useState("");
  const [directive, setDirective] = useState("");
  // Default new instances to "learn" — safest default for a fresh agent:
  // it asks before every new kind of action and remembers answers, so
  // users building their first agent can watch it ask rather than act.
  // Can be changed to cautious/autonomous before create, or later in
  // AgentView / the ActivityPanel header toggle.
  const [createMode, setCreateMode] = useState<RunMode>("learn");
  const [createUnconscious, setCreateUnconscious] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [rollout, setRollout] = useState<AgentCoreRollout | null>(null);
  const [rolloutError, setRolloutError] = useState("");

  // Per-instance live thread count, keyed by instance id. Updated every
  // poll from core.status so the list reflects how active each instance is
  // without needing full thread data.
  const [liveStatus, setLiveStatus] = useState<Record<number, AgentLiveStatus | null>>({});
  // Per-instance saved MCP attachments. Sourced from /config so the
  // fleet row renders the same list while the agent is running or
  // stopped.
  const [mainMCPs, setMainMCPs] = useState<Record<number, string[]>>({});
  const [viewMode, setViewMode] = useState<AgentsViewMode>(() => {
    try {
      return localStorage.getItem("apteva.agents.view") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const [now, setNow] = useState(Date.now());
  const currentStatuses = useCurrentStatuses(projectId);
  const currentStatusByAgent = useMemo(
    () => Object.fromEntries(currentStatuses.map((status) => [status.instance_id, status])),
    [currentStatuses],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => agentCoreRollouts.get().then((value) => {
      if (!cancelled) setRollout(value);
    }).catch(() => {});
    void refresh();
    const timer = window.setInterval(refresh, rollout?.state === "running" ? 1500 : 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rollout?.state]);

  const setAgentsViewMode = (mode: AgentsViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("apteva.agents.view", mode);
    } catch {
      // localStorage may be unavailable; the in-memory state is enough.
    }
  };

  // Quick-edit modal state. editTarget = the agent being edited; null
  // = modal closed.
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [editName, setEditName] = useState("");
  const [editDirective, setEditDirective] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const openEditModal = (inst: Agent) => {
    setEditTarget(inst);
    setEditName(inst.name);
    setEditDirective(inst.directive || "");
    setEditError("");
  };
  const closeEditModal = () => {
    setEditTarget(null);
    setEditName("");
    setEditDirective("");
    setEditError("");
    setEditSaving(false);
  };
  const saveEdit = async () => {
    if (!editTarget) return;
    const trimmedName = editName.trim();
    const trimmedDirective = editDirective.trim();
    if (!trimmedName) { setEditError("Name cannot be empty"); return; }
    setEditSaving(true);
    setEditError("");
    try {
      // Two independent endpoints — name via /agents/:id, directive
      // via /agents/:id/config — fire only the ones that actually
      // changed to avoid spurious history rows on the directive
      // audit trail.
      const nameChanged = trimmedName !== editTarget.name;
      const directiveChanged = trimmedDirective !== (editTarget.directive || "").trim();
      if (nameChanged) await instances.rename(editTarget.id, trimmedName);
      if (directiveChanged) await instances.updateConfig(editTarget.id, { directive: trimmedDirective });
      closeEditModal();
      load();
    } catch (err: any) {
      setEditError(err?.message || "Save failed");
      setEditSaving(false);
    }
  };
  // load() is also called by imperative callsites below (start/stop)
  // where the response is the user's
  // intent and no cancellation is needed. The polling effect uses a
  // ref-tracked generation so its async responses don't write into a
  // newer project's state — see the effect below.
  const loadGen = useRef(0);
  const load = () => {
    const myGen = loadGen.current;
    instances.list(projectId)
      .then((items) => {
        // Drop the response if a new project was selected (or the
        // component unmounted) since this fetch fired.
        if (myGen !== loadGen.current) return;
        setList(items || []);
        loadAgentSkills(items || [], myGen);
        setLoaded(true);
      })
      .catch(() => {
        if (myGen !== loadGen.current) return;
        setLoaded(true);
      });
  };

  useEffect(() => {
    if (!projectId) return;
    // Bump the generation so any in-flight load() from the previous
    // projectId stops writing state.
    loadGen.current += 1;
    setList([]);
    setAgentSkills({});
    setLoaded(false);
    setLiveStatus({});
    setMainMCPs({});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadAgentSkills = (agents: Agent[], gen: number) => {
    if (agents.length === 0) {
      setAgentSkills({});
      return;
    }
    Promise.all(
      agents.map((inst) =>
        instanceSkills
          .list(inst.id)
          .then((rows) => [inst.id, rows.filter((row) => row.status !== "missing")] as const)
          .catch(() => [inst.id, [] as InstanceSkill[]] as const),
      ),
    ).then((pairs) => {
      if (gen !== loadGen.current) return;
      const next: Record<number, InstanceSkill[]> = {};
      for (const [id, rows] of pairs) {
        next[id] = rows;
      }
      setAgentSkills(next);
    });
  };

  const runtimeAgentsKey = list.map((inst) => `${inst.id}:${inst.status}`).join("|");
  const mcpConfigKey = list.map((inst) => `${inst.id}:${inst.config}`).join("|");

  // The fleet payload's config blob is only a fast fallback: for some older
  // agents it does not contain the full persisted/live mcp_servers list.
  // Resolve /config once when fleet membership or stored config changes, not
  // on the five-second list poll, so MCP chips stay correct without restoring
  // the old per-agent request storm.
  useEffect(() => {
    if (list.length === 0) return;
    let cancelled = false;
    const gen = loadGen.current;
    const agents = list;
    const fallback = Object.fromEntries(
      agents.map((inst) => [inst.id, mcpNamesFromAgentConfig(inst.config)]),
    );
    setMainMCPs(fallback);
    void mapWithConcurrency(agents, 6, async (inst) => {
      const names = await core
        .config(inst.id)
        .then((config) => mcpNamesFromConfig(config.mcp_servers))
        .catch(() => fallback[inst.id] || []);
      return [inst.id, names] as const;
    }).then((pairs) => {
      if (cancelled || gen !== loadGen.current) return;
      setMainMCPs(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // The key changes only when agent membership or stored config changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpConfigKey]);

  // Poll core status as a slow backstop. Requests are bounded
  // to six in flight and state commits are batched once per refresh; the old
  // implementation fired 2–3 requests and 2–3 React updates per agent every
  // five seconds (about 60 requests/sec for a 100-agent fleet).
  useEffect(() => {
    if (list.length === 0) return;
    let cancelled = false;
    const agents = list;
    const refresh = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const rows = await mapWithConcurrency(agents, 6, async (inst) => {
        const statusResult = inst.status === "running"
          ? await core.status(inst.id).catch(() => undefined)
          : null;
        const live: AgentLiveStatus | null | undefined = statusResult === null
          ? null
          : statusResult
            ? {
                threads: statusResult.threads,
                iter: statusResult.iteration,
                rate: statusResult.rate,
                sleep_state: statusResult.sleep_state,
                sleep_thread_id: statusResult.sleep_thread_id,
                sleep_started_at: statusResult.sleep_started_at,
                next_wake_at: statusResult.next_wake_at,
                sleep_total_ms: statusResult.sleep_total_ms,
                sleep_remaining_ms: statusResult.sleep_remaining_ms,
                sleep_iteration: statusResult.sleep_iteration,
              }
            : undefined;
        return { id: inst.id, live };
      });
      if (cancelled) return;
      setLiveStatus((previous) => Object.fromEntries(rows.map((row) => [
        row.id,
        row.live === undefined ? previous[row.id] ?? null : row.live,
      ])));
    };
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // The key changes only when fleet membership/runtime state changes; the
    // 5s list refresh no longer tears down and immediately restarts this poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeAgentsKey]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    try {
      // Create without auto-starting. The user can click Start on the row
      // (or on the instance page) when they want it running. Avoids having
      // a fresh instance consume tokens before the user has had a chance
      // to configure directive / MCPs / channels.
      await instances.create(name.trim(), directive.trim(), createMode, projectId, false, {
        includeChannels: true,
        unconscious: createUnconscious,
      });
      setName("");
      setDirective("");
      setCreateMode("learn");
      setCreateUnconscious(true);
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (id: number) => {
    try {
      await instances.start(id);
      load();
    } catch {}
  };

  const handleStop = async (id: number) => {
    try {
      await instances.stop(id);
      load();
    } catch {}
  };

  const handleAgentCoreUpdate = async (id: number) => {
    setRolloutError("");
    try {
      setRollout(await agentCoreRollouts.startAgent(id));
    } catch (err: any) {
      setRolloutError(err?.message || "Failed to start core update");
    }
  };

  const handleProjectCoreUpdate = async () => {
    if (!projectId) return;
    setRolloutError("");
    try {
      setRollout(await agentCoreRollouts.startProject(projectId));
    } catch (err: any) {
      setRolloutError(err?.message || "Failed to start rolling update");
    }
  };

  if (!loaded) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-text text-lg font-bold">Agents</h1>
          <p className="truncate text-text-muted text-xs mt-0.5 sm:text-sm sm:mt-1">
            {list.length === 0
              ? "No agents yet. Create one to get started."
              : `${list.length} agent${list.length === 1 ? "" : "s"} in this project.`}
          </p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {list.some((agent) => agent.core_update_available) && (
            <button
              type="button"
              onClick={handleProjectCoreUpdate}
              disabled={rollout?.state === "running"}
              className="px-3 py-2 border border-accent rounded-lg text-accent text-xs hover:bg-accent/10 disabled:opacity-50"
            >
              Update all gradually
            </button>
          )}
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            {(["cards", "list"] as AgentsViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAgentsViewMode(mode)}
                className={`px-3 py-2 text-xs capitalize transition-colors ${
                  viewMode === mode
                    ? "bg-accent/15 text-accent"
                    : "text-text-muted hover:text-text hover:bg-bg-hover"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-2 border border-border rounded-lg text-text-muted text-xs hover:text-text hover:border-text-dim transition-colors"
            title="Open the classic create form — single dialog with all fields"
          >
            Quick create
          </button>
          <button
            onClick={() => navigate("/agents/new")}
            className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
          >
            + New Agent
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:hidden">
          <button type="button" onClick={() => navigate("/agents/new")} className="touch-target rounded-lg bg-accent px-3 text-sm font-bold text-bg" aria-label="Create agent">+ New</button>
          <button type="button" onClick={() => setShowMobileActions(true)} className="touch-target inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border text-lg text-text-muted" aria-label="Agent page actions">⋮</button>
        </div>
      </div>

      <div className="page-safe-bottom flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {rollout?.state === "running" && (
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-xs">
            <span className="text-accent">Updating cores</span>
            <span className="min-w-0 flex-1 truncate text-text-muted">
              {rollout.current_agent_name || (rollout.current_agent_id ? `Agent #${rollout.current_agent_id}` : "Preparing")}
            </span>
            <span className="font-mono text-text-dim">{rollout.completed + rollout.failed}/{rollout.total}</span>
            <button
              type="button"
              onClick={() => void agentCoreRollouts.cancel().then(() => agentCoreRollouts.get().then(setRollout))}
              className="text-text-muted hover:text-red"
            >
              Cancel
            </button>
          </div>
        )}
        {rolloutError && <div className="text-sm text-red">{rolloutError}</div>}
        {list.length === 0 && (
          <div className="text-text-muted text-sm">
            No agents yet.{" "}
            <button
              onClick={() => navigate("/agents/new")}
              className="text-accent underline-offset-2 hover:underline"
            >
              Build your first agent →
            </button>
          </div>
        )}

        {viewMode === "cards" ? (
          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((inst) => {
              const live = liveStatus[inst.id];
              const isRunning = inst.status === "running";
              const assignedSkills = agentSkills[inst.id] || [];
              const mcpNames = mainMCPs[inst.id] || [];
              return (
                <article
                  key={inst.id}
                  className="relative min-h-[220px] rounded-lg border border-border bg-bg-card transition-colors hover:border-accent sm:h-[220px]"
                >
                  <Link to={`/agents/${inst.id}`} className="block h-full min-w-0 p-4">
                    <div className="min-w-0 pr-28">
                      <div className="truncate text-sm font-bold text-text">{inst.name}</div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-dim">
                        <span>#{inst.id}</span>
                        <ModeBadge mode={inst.mode} />
                        {inst.core_update_available && (
                          <span
                            className="rounded bg-yellow/10 px-1.5 py-0.5 text-yellow"
                            title={`Running ${inst.core_version || "unknown"}; target ${inst.target_core_version || "current"}`}
                          >
                            core update
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 min-h-[66px]">
                      <AgentCurrentStatus status={currentStatusByAgent[inst.id]} compact showFallback showAge showNextFallback />
                    </div>

                    <RuntimeSummary live={live} running={isRunning} now={now} />
                    <AgentCapabilityChips skills={assignedSkills} mcpNames={mcpNames} />
                  </Link>
                  <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
                    <LifecycleBadge running={isRunning} />
                    <AgentActionsMenu
                      agent={inst}
                      rolloutRunning={rollout?.state === "running"}
                      onOpen={() => navigate(`/agents/${inst.id}`)}
                      onEdit={() => openEditModal(inst)}
                      onStart={() => handleStart(inst.id)}
                      onStop={() => handleStop(inst.id)}
                      onUpdateCore={() => void handleAgentCoreUpdate(inst.id)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-bg-card">
            <div className="hidden grid-cols-[minmax(12rem,1.2fr)_minmax(14rem,1.4fr)_minmax(8rem,.7fr)_minmax(10rem,1fr)_auto] gap-4 border-b border-border bg-bg-hover/40 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-text-dim lg:grid">
              <span>Agent</span>
              <span>Current status</span>
              <span>Runtime</span>
              <span>Capabilities</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-border">
              {list.map((inst) => {
                const live = liveStatus[inst.id];
                const isRunning = inst.status === "running";
                const assignedSkills = agentSkills[inst.id] || [];
                const mcpNames = mainMCPs[inst.id] || [];
                return (
                  <article
                    key={inst.id}
                    className="relative grid gap-3 px-4 py-3 pr-16 transition-colors hover:bg-bg-hover/30 lg:grid-cols-[minmax(12rem,1.2fr)_minmax(14rem,1.4fr)_minmax(8rem,.7fr)_minmax(10rem,1fr)_auto] lg:items-center lg:gap-4 lg:pr-4"
                  >
                    <Link to={`/agents/${inst.id}`} className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-bold text-text">{inst.name}</span>
                        <LifecycleBadge running={isRunning} compact />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-text-dim">
                        <span>#{inst.id}</span>
                        <ModeBadge mode={inst.mode} />
                        {inst.core_update_available && <span className="text-yellow">core update</span>}
                      </div>
                    </Link>

                    <div className="min-w-0">
                      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-text-dim lg:hidden">Status</div>
                      <AgentCurrentStatus status={currentStatusByAgent[inst.id]} compact showFallback showNextFallback />
                    </div>

                    <div>
                      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-text-dim lg:hidden">Runtime</div>
                      <RuntimeSummary live={live} running={isRunning} now={now} compact />
                    </div>

                    <div className="min-w-0">
                      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-text-dim lg:hidden">Capabilities</div>
                      <AgentCapabilityChips skills={assignedSkills} mcpNames={mcpNames} compact />
                    </div>

                    <div className="absolute right-3 top-3 z-20 flex items-center justify-end lg:static">
                      <AgentActionsMenu
                        agent={inst}
                        rolloutRunning={rollout?.state === "running"}
                        onOpen={() => navigate(`/agents/${inst.id}`)}
                        onEdit={() => openEditModal(inst)}
                        onStart={() => handleStart(inst.id)}
                        onStop={() => handleStop(inst.id)}
                        onUpdateCore={() => void handleAgentCoreUpdate(inst.id)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Modal open={showMobileActions} onClose={() => setShowMobileActions(false)} width="max-w-md" ariaLabel="Agent page actions">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-accent">Agents</div>
          <div className="mt-1 text-base font-semibold text-text">Display and creation</div>
        </div>
        <div className="page-safe-bottom grid gap-2 p-3">
          <button type="button" onClick={() => { setAgentsViewMode("cards"); setShowMobileActions(false); }} className={`touch-target rounded-lg border px-4 text-left text-sm ${viewMode === "cards" ? "border-accent text-accent" : "border-border text-text"}`}>Card view</button>
          <button type="button" onClick={() => { setAgentsViewMode("list"); setShowMobileActions(false); }} className={`touch-target rounded-lg border px-4 text-left text-sm ${viewMode === "list" ? "border-accent text-accent" : "border-border text-text"}`}>List view</button>
          <button type="button" onClick={() => { setShowMobileActions(false); setShowCreate(true); }} className="touch-target rounded-lg border border-border px-4 text-left text-sm text-text">Quick create</button>
          <button type="button" onClick={() => navigate("/agents/new")} className="touch-target rounded-lg border border-accent bg-accent/10 px-4 text-left text-sm font-semibold text-accent">Build a new agent</button>
          {list.some((agent) => agent.core_update_available) && (
            <button
              type="button"
              onClick={() => { setShowMobileActions(false); void handleProjectCoreUpdate(); }}
              disabled={rollout?.state === "running"}
              className="touch-target rounded-lg border border-yellow/60 px-4 text-left text-sm text-yellow disabled:opacity-50"
            >
              Update all cores gradually
            </button>
          )}
        </div>
      </Modal>

      {/* Quick-edit modal — name + directive only. Lives at page root
          so it overlays cleanly regardless of which row triggered it.
          For deeper config (mode, providers, and MCP wiring)
          operators still go through the agent detail page. */}
      <Modal open={!!editTarget} onClose={closeEditModal}>
        {editTarget && (
          <form
            onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
            className="p-4 sm:p-6 w-full max-w-[560px] space-y-4"
          >
            <div>
              <h2 className="text-text text-base font-bold">Edit agent</h2>
              <p className="text-text-muted text-xs mt-1">
                Quick edits — name + directive. For mode, providers,
                MCPs, open the agent's detail page.
              </p>
            </div>
            <div>
              <label className="block text-text-muted text-sm mb-2">Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                required
                autoFocus
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-text-muted text-sm">
                  Directive
                  <span className="text-text-dim text-xs ml-2 font-normal">
                    (the system prompt the agent reads at every think)
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setEditDirective((cur) => structureDirectiveDraft(cur, editName))}
                  className="text-accent text-xs hover:underline"
                >
                  Structure
                </button>
              </div>
              <textarea
                value={editDirective}
                onChange={(e) => setEditDirective(e.target.value)}
                rows={10}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono resize-y focus:outline-none focus:border-accent"
                placeholder={"# Role\nYou are...\n\n# Goals\n- ..."}
              />
              <p className="text-text-dim text-xs mt-1">
                Saving updates the running core in place. Markdown sections
                make future edits safer.
              </p>
            </div>
            {editError && (
              <div className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
                {editError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={editSaving}
                className="px-4 py-2 border border-border rounded-lg text-text-muted hover:text-text transition-colors text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving || !editName.trim()}
                className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Create-agent modal. Lives at the page root so the backdrop
          covers the full viewport regardless of which list row the
          user was viewing when they clicked + New Agent. */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setError(""); }}>
        <form onSubmit={handleCreate} className="page-safe-bottom max-h-[90dvh] w-full max-w-[520px] space-y-4 overflow-y-auto p-4 sm:p-6">
          <h2 className="text-text text-base font-bold">Create agent</h2>
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="supervisor"
              required
              autoFocus
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-text-muted text-sm">Directive (optional)</label>
              <button
                type="button"
                onClick={() => setDirective((cur) => structureDirectiveDraft(cur, name))}
                className="text-accent text-xs hover:underline"
              >
                Structure
              </button>
            </div>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent resize-y h-32"
              placeholder={"# Role\nYou are...\n\n# Goals\n- ..."}
            />
            <p className="text-text-dim text-xs mt-1">
              Stable markdown sections make future updates safer.
            </p>
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Safety mode</label>
            <div className="flex gap-2">
              {(["learn", "cautious", "autonomous"] as RunMode[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setCreateMode(m)}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border capitalize transition-colors ${
                    createMode === m
                      ? "border-accent text-accent bg-accent/10"
                      : "border-border text-text-muted hover:border-accent"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="text-text-dim text-xs leading-snug mt-2">
              {createMode === "learn" &&
                "Asks before every new kind of action and remembers your answers. Best for first-time setup."}
              {createMode === "cautious" &&
                "Asks before any state-changing action (exec, write, delete, external send). Read-only tools are free."}
              {createMode === "autonomous" &&
                "Acts independently. Only informs you before irreversible or high-blast-radius actions."}
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-hover/30 p-3">
            <div>
              <div className="text-sm font-medium text-text">Background memory</div>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                Consolidates activity into persistent memories in a background thread.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={createUnconscious}
              onClick={() => setCreateUnconscious((value) => !value)}
              className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                createUnconscious ? "border-green/40 bg-green/10 text-green" : "border-border text-text-muted"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${createUnconscious ? "bg-green" : "bg-text-dim"}`} />
              {createUnconscious ? "On" : "Off"}
            </button>
          </div>
          {error && <div className="text-red text-sm">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setError(""); }}
              className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ModeBadge({ mode }: { mode: RunMode }) {
  const color =
    mode === "learn"
      ? "bg-green/20 text-green"
      : mode === "cautious"
        ? "bg-blue/20 text-blue"
        : "bg-accent/20 text-accent";
  const title =
    mode === "learn"
      ? "Learn mode — asks before each new kind of action"
      : mode === "cautious"
        ? "Cautious mode — asks before state-changing actions"
        : "Autonomous mode — acts independently";
  return (
    <span title={title} className={`rounded px-1.5 py-0.5 uppercase tracking-wide ${color}`}>
      {mode}
    </span>
  );
}

function LifecycleBadge({ running, compact = false }: { running: boolean; compact?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded font-bold uppercase tracking-wide ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-1.5 py-0.5 text-[9px]"} ${
        running ? "bg-green/15 text-green" : "bg-red/15 text-red"
      }`}
    >
      {running ? "running" : "stopped"}
    </span>
  );
}

function RuntimeSummary({
  live,
  running,
  now,
  compact = false,
}: {
  live?: AgentLiveStatus | null;
  running: boolean;
  now: number;
  compact?: boolean;
}) {
  if (!live) {
    return (
      <div className={`${compact ? "" : "mt-3 min-h-[18px]"} text-[10px] text-text-dim`}>
        {running ? "Runtime connecting…" : "Stopped"}
      </div>
    );
  }
  return (
    <div className={`flex min-w-0 items-center gap-2 text-[10px] text-text-dim ${compact ? "" : "mt-3 min-h-[18px]"}`}>
      <span>{live.threads} {live.threads === 1 ? "thread" : "threads"}</span>
      <span>· #{live.iter}</span>
      <span className={`rounded px-1.5 py-0.5 ${sleepClassName(live)}`} title={sleepTitle(live, now)}>
        {sleepLabel(live, { compact: true, now })}
      </span>
    </div>
  );
}

function AgentCapabilityChips({
  skills,
  mcpNames,
  compact = false,
}: {
  skills: InstanceSkill[];
  mcpNames: string[];
  compact?: boolean;
}) {
  const capabilities = [
    ...skills.map((skill) => ({
      key: `skill-${skill.skill_id}-${skill.slug}`,
      label: skill.name || skill.slug,
      prefix: "",
      title: skillTitle(skill),
      color:
        skill.status === "stale"
          ? "bg-yellow/10 text-yellow"
          : skill.status === "orphaned"
            ? "bg-red/10 text-red"
            : "bg-blue/10 text-blue",
    })),
    ...mcpNames.map((name) => ({
      key: `mcp-${name}`,
      label: name,
      prefix: "mcp:",
      title: `MCP: ${name}`,
      color: "bg-accent/10 text-accent",
    })),
  ];
  if (capabilities.length === 0) {
    return (
      <div className={`${compact ? "" : "mt-3 min-h-5"} truncate text-[10px] text-text-dim`}>
        No capabilities attached
      </div>
    );
  }
  const shown = capabilities.slice(0, 2);
  const hidden = capabilities.slice(2);
  return (
    <div className={`flex min-h-5 min-w-0 items-center gap-1 overflow-hidden ${compact ? "" : "mt-3"}`}>
      {shown.map((capability) => (
        <span
          key={capability.key}
          title={capability.title}
          className={`inline-flex h-5 max-w-[7.5rem] shrink items-center rounded px-1.5 text-[10px] leading-none ${capability.color}`}
        >
          {capability.prefix && <span className="mr-0.5 shrink-0 opacity-60">{capability.prefix}</span>}
          <span className="truncate">{capability.label}</span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map((capability) => capability.label).join(", ")}
          className="inline-flex h-5 shrink-0 items-center rounded bg-border px-1.5 text-[10px] leading-none text-text-muted"
        >
          +{hidden.length}
        </span>
      )}
    </div>
  );
}

function AgentActionsMenu({
  agent,
  rolloutRunning,
  onOpen,
  onEdit,
  onStart,
  onStop,
  onUpdateCore,
}: {
  agent: Agent;
  rolloutRunning: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  onUpdateCore: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const running = agent.status === "running";

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none transition-colors ${
          open ? "bg-bg-hover text-text" : "text-text-muted hover:bg-bg-hover hover:text-text"
        }`}
        aria-label={`Actions for ${agent.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${agent.name}`}
          className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-bg-card py-1 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onOpen)}
            className="flex min-h-10 w-full items-center px-3 text-left text-xs text-text transition-colors hover:bg-bg-hover"
          >
            Open details
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onEdit)}
            className="flex min-h-10 w-full items-center px-3 text-left text-xs text-text transition-colors hover:bg-bg-hover"
          >
            Edit agent
          </button>
          {running && agent.core_update_available && (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onUpdateCore)}
              disabled={rolloutRunning}
              className="flex min-h-10 w-full items-center px-3 text-left text-xs text-yellow transition-colors hover:bg-bg-hover disabled:opacity-50"
            >
              Update core
            </button>
          )}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(running ? onStop : onStart)}
            className={`flex min-h-10 w-full items-center px-3 text-left text-xs font-semibold transition-colors hover:bg-bg-hover ${
              running ? "text-red" : "text-accent"
            }`}
          >
            {running ? "Stop agent" : "Start agent"}
          </button>
        </div>
      )}
    </div>
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function skillTitle(skill: InstanceSkill): string {
  const parts = [
    skill.name || skill.slug,
    `status: ${skill.status}`,
    skill.source ? `source: ${skill.source}` : "",
    skill.app_name ? `app: ${skill.app_name}` : "",
    skill.memory_id ? `memory: ${skill.memory_id}` : "",
    skill.pushed_at ? `pushed: ${new Date(skill.pushed_at).toLocaleString()}` : "",
    skill.description || "",
    skill.slug ? `slug: ${skill.slug}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}
