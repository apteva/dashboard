import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  agentTemplates,
  apps,
  instances,
  type Agent,
  type AgentTemplate,
  type AppRow,
} from "../api";
import {
  ContributionMount,
  contributionsFor,
  fetchEligibleContributionKeys,
  type Contribution,
  type ResolvedWidgetInstance,
} from "../components/apps/contributions";
import { AgentMark } from "../components/AgentMark";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";
import { useAudience } from "../hooks/useAudience";

const CONVERSATIONS_SLOT = "dashboard.build";
const CONVERSATIONS_COMPONENT = "agent-conversations";

export function selectPersonalConversationsContribution(
  rows: AppRow[],
  projectId: string,
): Contribution | null {
  const matches = contributionsFor(rows, CONVERSATIONS_SLOT).filter(
    (item) =>
      item.app.name === "conversations" &&
      item.spec.name === CONVERSATIONS_COMPONENT,
  );
  return (
    matches.find((item) => (item.app as AppRow).project_id === projectId) ||
    matches.find((item) => !(item.app as AppRow).project_id) ||
    null
  );
}

export function Personal() {
  usePageTitle("Home");
  const { currentProject } = useProjects();
  const { audience } = useAudience();
  const projectId = currentProject?.id || "";
  const [searchParams, setSearchParams] = useSearchParams();
  const initialConversationId = searchParams.get("chat") || "";
  const [agents, setAgents] = useState<Agent[]>([]);
  const [appRows, setAppRows] = useState<AppRow[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedProjectId, setLoadedProjectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [surface, setSurface] = useState<ResolvedWidgetInstance | null>(null);
  const [surfaceState, setSurfaceState] = useState<"loading" | "ready" | "missing" | "unavailable">("loading");

  const selectedId = Number(searchParams.get("agent") || 0);
  const selectedAgent = agents.find((agent) => agent.id === selectedId) || null;
  const createRequested = searchParams.get("new") === "1";
  const projectLoaded = Boolean(projectId) && loadedProjectId === projectId && !loading;
  const createOpen = createRequested || (projectLoaded && agents.length === 0);
  const contribution = useMemo(
    () => selectPersonalConversationsContribution(appRows, projectId),
    [appRows, projectId],
  );

  const refresh = useCallback(async () => {
    if (!projectId) {
      setAgents([]);
      setAppRows([]);
      setLoadedProjectId("");
      setLoading(false);
      return;
    }
    try {
      const [agentRows, installed] = await Promise.all([
        instances.list(projectId),
        apps.list(projectId),
      ]);
      setAgents(agentRows || []);
      setAppRows(installed || []);
    } finally {
      setLoadedProjectId(projectId);
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    setLoadedProjectId("");
    setSurface(null);
    void refresh();
    agentTemplates.list().then(setTemplates).catch(() => setTemplates([]));
    const onAppsChanged = () => void refresh();
    window.addEventListener("apteva:apps-changed", onAppsChanged);
    return () => window.removeEventListener("apteva:apps-changed", onAppsChanged);
  }, [refresh]);

  useEffect(() => {
    if (loading || !projectId || loadedProjectId !== projectId) return;
    if (agents.length === 0) {
      if (!createRequested) setSearchParams({ new: "1" }, { replace: true });
      return;
    }
    if (createOpen) return;
    if (!selectedAgent) {
      setSearchParams({ agent: String(agents[0]!.id) }, { replace: true });
    }
  }, [agents, createOpen, createRequested, loadedProjectId, loading, projectId, selectedAgent, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setSurface(null);
    if (!selectedAgent || !projectId || createOpen) return;
    if (!contribution) {
      setSurfaceState("missing");
      return;
    }
    setSurfaceState("loading");
    void fetchEligibleContributionKeys(projectId, CONVERSATIONS_SLOT, selectedAgent.id)
      .then((eligible) => {
        if (cancelled) return;
        if (!eligible.has(contribution.key)) {
          setSurfaceState("unavailable");
          return;
        }
        setSurface({
          id: `personal:${contribution.key}:${selectedAgent.id}`,
          component: contribution.key,
          contribution,
          size: "full",
          settings: {
            experience: "personal",
            welcome_audience: audience,
            initial_conversation_id: initialConversationId,
            display_mode: "single",
            show_new_conversation: true,
          },
        });
        setSurfaceState("ready");
      })
      .catch(() => {
        if (!cancelled) setSurfaceState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [contribution, createOpen, projectId, selectedAgent, audience, initialConversationId]);

  const openAgent = (agent: Agent) => {
    setError("");
    setSearchParams({ agent: String(agent.id) });
  };

  const openCreate = () => {
    setName("");
    setTemplateId(null);
    setError("");
    setSearchParams({ new: "1" });
  };

  const createAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !projectId || creating) return;
    if (!contribution) {
      setError("Install Conversations before creating a Personal agent.");
      return;
    }
    const template = templates.find((item) => item.id === templateId);
    const wantedApps = new Set(template?.recommended_apps || []);
    for (const requirement of template?.requirements || []) {
      if (requirement.kind === "app" && requirement.slug) wantedApps.add(requirement.slug);
    }
    const boundAppInstallIDs = appRows
      .filter(
        (row) =>
          row.status === "running" &&
          (row.default_for_new_agents || row.install_id === contribution.app.install_id || wantedApps.has(row.name)),
      )
      .map((row) => row.install_id);

    setCreating(true);
    setError("");
    try {
      const created = await instances.create(
        trimmedName,
        template?.directive || "",
        template?.mode || "learn",
        projectId,
        true,
        {
          includeChannels: false,
          unconscious: template?.unconscious ?? true,
          boundAppInstallIDs,
        },
      );
      await refresh();
      window.dispatchEvent(new CustomEvent("apteva:agents-changed"));
      setSearchParams({ agent: String(created.id) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Agent creation failed.");
    } finally {
      setCreating(false);
    }
  };

  const suggestions = templates.slice(0, 4);
  const creationTitle = agents.length === 0 ? "Create your first agent" : "Create a new agent";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg text-text">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 md:px-5">
          <button type="button" onClick={openCreate} className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-bg" aria-label="New agent">+</button>
          <select
            value={createOpen ? "" : String(selectedAgent?.id || "")}
            onChange={(event) => {
              const agent = agents.find((item) => item.id === Number(event.target.value));
              if (agent) openAgent(agent);
              else openCreate();
            }}
            className="min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent md:hidden"
            aria-label="Current agent"
          >
            <option value="">New agent</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          {createOpen ? (
            <span className="hidden text-sm font-semibold md:inline">New agent</span>
          ) : selectedAgent ? (
            <>
              <span className="hidden md:inline-flex"><AgentMark size="sm" /></span>
              <span className="hidden min-w-0 flex-1 truncate text-sm font-semibold md:block">{selectedAgent.name}</span>
              <Link to={`/agents/${selectedAgent.id}`} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text">Manage</Link>
            </>
          ) : (
            <span className="hidden text-sm font-semibold md:inline">Apteva</span>
          )}
        </header>

        <section className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <PersonalState title="Opening your workspace…" />
          ) : createOpen ? (
            <form onSubmit={createAgent} className="flex h-full min-h-0 flex-col overflow-y-auto">
              <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                <AgentMark size="lg" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight">{creationTitle}</h1>
                <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">Give it a name. You can teach it what to do in your first conversation.</p>
                <label className="mt-7 w-full max-w-md text-left">
                  <span className="mb-1.5 block text-xs font-medium text-text-muted">Name</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="My assistant"
                    className="w-full rounded-xl border border-border bg-bg-input px-4 py-3 text-sm text-text outline-none transition-colors placeholder:text-text-dim focus:border-accent"
                  />
                </label>
                {error && <p className="mt-3 max-w-md text-xs text-red">{error}</p>}
                <button
                  type="submit"
                  disabled={!name.trim() || creating || !contribution}
                  className="mt-5 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {creating ? "Creating…" : "Get started"}
                </button>
                {!contribution && (
                  <p className="mt-3 text-xs text-text-muted">Personal conversations require the Conversations app. <Link to="/apps" className="text-accent hover:underline">Open Apps</Link></p>
                )}
              </div>
              {suggestions.length > 0 && (
                <div className="shrink-0 border-t border-border px-5 py-5">
                  <div className="mx-auto max-w-5xl">
                    <div className="mb-3 text-xs font-medium text-text-muted">Suggestions</div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {suggestions.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => {
                            setTemplateId(template.id);
                            if (!name.trim()) setName(template.name);
                          }}
                          className={`rounded-xl border p-4 text-left transition-colors ${templateId === template.id ? "border-accent bg-accent/5" : "border-border bg-bg-card hover:border-accent/40 hover:bg-bg-hover"}`}
                        >
                          <span className="flex items-center gap-3">
                            <AgentMark size="sm" />
                            <span className="truncate text-sm font-semibold">{template.name}</span>
                          </span>
                          <span className="mt-3 block line-clamp-2 text-xs leading-5 text-text-muted">{template.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </form>
          ) : surfaceState === "loading" ? (
            <PersonalState title="Opening Conversations…" />
          ) : surfaceState === "missing" ? (
            <PersonalState title="Conversations is not installed" detail="Personal uses the Conversations app for every chat." action={{ to: "/apps", label: "Open Apps" }} />
          ) : surfaceState === "unavailable" ? (
            <PersonalState title="Conversations is not attached" detail="Attach the Conversations app to this agent, then return here." action={{ to: `/agents/${selectedAgent?.id || ""}`, label: "Manage agent" }} />
          ) : surface && selectedAgent ? (
            <ContributionMount
              instance={surface}
              apps={appRows}
              slot={CONVERSATIONS_SLOT}
              projectId={projectId}
              agentId={selectedAgent.id}
            />
          ) : (
            <PersonalState title="Choose an agent" />
          )}
        </section>
    </div>
  );
}

function PersonalState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-text">{title}</p>
        {detail && <p className="mt-2 text-xs text-text-muted">{detail}</p>}
        {action && <Link to={action.to} className="mt-4 inline-flex rounded-lg border border-border px-3 py-2 text-xs text-accent hover:bg-bg-hover">{action.label}</Link>}
      </div>
    </div>
  );
}
