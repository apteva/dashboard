import { useEffect, useRef, useState } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { Link, useNavigate } from "react-router-dom";
import { apps, auth, instances, integrations, projectPresets, skills as skillsAPI, workspaceSetup, type Agent, type AppRow, type ConnectionInfo, type InterfaceLevel, type MarketplaceEntry, type ProjectPreset, type ProjectPresetPreview, type Skill, type WorkspaceSetupDraft, type WorkspaceSetupProposal } from "../api";
import { ContributionMount } from "../components/apps/contributions";
import { describeSetupPage } from "../components/chat/pageContext";
import { PresetContentsSummary, presetCountSummary } from "../components/projects/ProjectPresetSetup";
import { useAuth } from "../hooks/useAuth";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { AgentNew } from "./AgentNew";
import { openWorkspaceHelper } from "../utils/workspaceSetup";
import { useTheme, type ThemeMode, type ThemeName } from "../hooks/useTheme";

type HelperSurface = Awaited<ReturnType<typeof openWorkspaceHelper>>;
type ApplyResult = Awaited<ReturnType<typeof projectPresets.apply>>;
type WorkspaceResources = { apps: AppRow[]; connections: ConnectionInfo[]; skills: Skill[]; marketplace?: MarketplaceEntry[] };
type ReviewSnapshot = { agents: Agent[]; apps: string[]; resources: WorkspaceResources };
const categories = ["", "personal", "business", "work", "development"] as const;
const inputClass = "w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:outline-none focus:border-accent";
const secondaryClass = "rounded-lg border border-border px-4 py-2.5 text-sm text-text hover:bg-bg-hover disabled:opacity-50";
export const workspaceSetupConversationSettings = {
  display_mode: "single",
  show_new_conversation: false,
  show_page_context: false,
  composer_layout: "compact",
} as const;

export function WorkspaceSetup() {
  usePageTitle("Welcome");
  const { currentProject } = useProjects();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const finish = async (destination: string, interfaceLevel?: InterfaceLevel) => {
    await auth.completeOnboarding(interfaceLevel);
    await refresh();
    navigate(destination, { replace: true });
  };
  return <main className="h-dvh overflow-y-auto bg-bg text-text">
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col px-4 py-5 sm:px-6 sm:py-8 xl:px-8">
      <div className="mb-4 flex shrink-0 items-center justify-between"><span className="text-lg font-semibold text-accent">Apteva</span><div className="flex items-center gap-3"><span className="hidden text-xs text-text-muted sm:inline">Welcome · Set up your workspace</span><OnboardingAppearanceControl /></div></div>
      {!currentProject || !user ? <p className="p-6 text-sm text-text-muted">Loading your workspace…</p> :
        <SetupFlow key={`${user.id}:${currentProject.id}`} projectId={currentProject.id} userId={user.id} initialInterfaceLevel={user.interfaceLevel || "business"} onboarding={!user.onboarded} onFinish={finish} />}
    </div>
  </main>;
}

function OnboardingAppearanceControl() {
  const { theme, mode, resolvedMode, setTheme, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);
  const chooseTheme = (value: ThemeName) => setTheme(value);
  const chooseMode = (value: ThemeMode) => setMode(value);
  return <div ref={root} className="relative">
    <button type="button" aria-expanded={open} aria-haspopup="dialog" aria-label="Appearance settings" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs text-text-muted transition-colors hover:border-accent/50 hover:bg-bg-hover hover:text-text focus:outline-none focus:ring-1 focus:ring-accent/50">
      <AppearanceModeIcon mode={resolvedMode} />
      <span className="hidden sm:inline">Appearance</span>
      <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
    </button>
    {open && <div role="dialog" aria-label="Appearance settings" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-xl border border-border bg-bg-card p-3 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-text">Appearance</p><p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">Personalize this workspace before you start.</p></div><span className="rounded-md border border-border bg-bg-input px-1.5 py-1 text-[10px] text-text-dim">{resolvedMode}</span></div>
      <div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-dim">Style</p><div className="grid grid-cols-2 gap-1.5">{(["terminal", "clean"] as ThemeName[]).map((value) => <button key={value} type="button" aria-pressed={theme === value} onClick={() => chooseTheme(value)} className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${theme === value ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted hover:border-accent/40 hover:text-text"}`}><span className="block font-medium">{value === "terminal" ? "Terminal" : "Professional"}</span><span className="mt-0.5 block text-[10px] text-text-dim">{value === "terminal" ? "Focused, compact" : "Calm, polished"}</span></button>)}</div></div>
      <div className="mt-3"><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-dim">Light or dark</p><div className="grid grid-cols-3 gap-1.5">{(["auto", "dark", "light"] as ThemeMode[]).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => chooseMode(value)} className={`rounded-lg border px-2 py-2 text-center text-[11px] transition-colors ${mode === value ? "border-accent bg-accent/10 text-text" : "border-border text-text-muted hover:border-accent/40 hover:text-text"}`}><span className="mx-auto mb-1 grid h-5 w-5 place-items-center">{value === "auto" ? <SystemIcon /> : <AppearanceModeIcon mode={value} />}</span>{value === "auto" ? "System" : value === "dark" ? "Dark" : "Light"}</button>)}</div></div>
      <p className="mt-3 text-[10px] leading-relaxed text-text-dim">This preference is saved on this device and applies across Apteva.</p>
    </div>}
  </div>;
}

function AppearanceModeIcon({ mode }: { mode: "dark" | "light" }) {
  return mode === "dark" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z" /></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
}

function SystemIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

export function SetupFlow({ projectId, userId, onFinish, initialInterfaceLevel = "business", onboarding = true }: { projectId: string; userId: number; initialInterfaceLevel?: InterfaceLevel; onboarding?: boolean; onFinish?: (destination: string, interfaceLevel?: InterfaceLevel) => Promise<void> }) {
  const navigate = useNavigate();
  const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const [aiAvailable, setAIAvailable] = useState(false);
  const scratchKey = `apteva:setup-agent:${userId}:${projectId}`;
  const [scratchAgent, setScratchAgent] = useState<{ id: number; name: string; status: string; warning?: string } | null>(null);
  const [draft, setDraft] = useState<WorkspaceSetupDraft | null>(null);
  const [catalog, setCatalog] = useState<ProjectPreset[]>([]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ProjectPresetPreview | null>(null);
  const [helperProgress, setHelperProgress] = useState("Opening your conversation with Apteva Helper…");
  const [surface, setSurface] = useState<HelperSurface | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [aiConfirmed, setAIConfirmed] = useState(false);
  const [resources, setResources] = useState<WorkspaceResources>({ apps: [], connections: [], skills: [] });
  const [mobilePane, setMobilePane] = useState<"chat" | "plan">("chat");
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saves = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => { document.querySelector("main")?.scrollTo?.({ top: 0 }); }, [draft?.mode, !!review]);

  const save = (next: WorkspaceSetupDraft) => {
    clearTimeout(timer.current);
    const operation = saves.current.catch(() => {}).then(() => workspaceSetup.save(projectId, next));
    saves.current = operation;
    return operation;
  };

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setError("");
    setBusy(true);
    void Promise.all([workspaceSetup.get(projectId), projectPresets.list(), auth.onboardingStatus()]).then(async ([saved, presets, status]) => {
      if (cancelled) return;
      setAIAvailable(status.provider_configured);
      setCatalog(presets.presets);
      setDraft(saved);
      if (saved.mode === "scratch") {
        const createdID = Number(sessionStorage.getItem(scratchKey));
        if (createdID) {
          try {
            const agent = await instances.get(createdID);
            if (!cancelled) setScratchAgent(agent);
          } catch { sessionStorage.removeItem(scratchKey); }
        }
      }
      if (saved.mode === "manual" && saved.preset_id) {
        const next = await projectPresets.preview(projectId, saved);
        if (!cancelled) setPreview(next);
      } else if (saved.mode === "ai") {
        if (!status.provider_configured) throw new Error("Connect AI before continuing with Helper.");
        const next = await openWorkspaceHelper(userId, projectId, saved, (message) => { if (!cancelled) setHelperProgress(message); });
        if (!cancelled) setSurface(next);
      }
    }).catch((caught) => { if (!cancelled) setError(caught.message || "Could not load setup."); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer.current); };
  }, [projectId, userId, attempt]);

  useEffect(() => {
    if (draft?.mode !== "ai" || !surface) return;
    let cancelled = false;
    const refreshResources = async () => {
      const [agentResult, appResult, connectionResult, skillResult, marketplaceResult] = await Promise.allSettled([
        instances.list(projectId), apps.list(projectId), integrations.connections(projectId), skillsAPI.list(projectId), apps.marketplace(projectId, undefined, { pageSize: 100 }),
      ]);
      if (cancelled) return;
      if (agentResult.status === "fulfilled") setAgents(agentResult.value);
      setResources((current) => ({
        apps: appResult.status === "fulfilled" ? appResult.value : current.apps.length ? current.apps : surface.rows,
        connections: connectionResult.status === "fulfilled" ? connectionResult.value : current.connections,
        skills: skillResult.status === "fulfilled" ? skillResult.value : current.skills,
        marketplace: marketplaceResult.status === "fulfilled" ? marketplaceResult.value.apps : current.marketplace,
      }));
    };
    void refreshResources();
    const resourceTimer = window.setInterval(refreshResources, 2000);
    const refresh = () => { void refreshResources(); };
    window.addEventListener("apteva:agents-changed", refresh);
    window.addEventListener("apteva:apps-changed", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(resourceTimer);
      window.removeEventListener("apteva:agents-changed", refresh);
      window.removeEventListener("apteva:apps-changed", refresh);
    };
  }, [projectId, draft?.mode, surface?.conversationId]);

  const update = (next: WorkspaceSetupDraft, clearResult = true) => {
    setDraft(next);
    if (clearResult) setResult(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save(next).catch(() => { if (mounted.current) setError("Could not save setup progress. Please retry before leaving."); });
    }, 350);
  };

  const run = async (action: () => Promise<void>) => {
    if (pending.current || busy) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "Setup could not finish. Please try again."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };

  const chooseMode = (mode: "manual" | "ai") => void run(async () => {
    if (!draft) return;
    if (mode === "manual" && !draft.preset_id) {
      const next = { ...draft, mode: "scratch" as const };
      await save(next);
      setDraft(next);
      return;
    }
    if (mode === "manual" && !draft.description.trim()) throw new Error("Describe what you want this setup to help with.");
    const next = { ...draft, mode, interface_level: draft.interface_level || (mode === "manual" ? catalog.find((p) => p.id === draft.preset_id)?.interface_level : undefined) };
    await save(next);
    setDraft(next);
    if (mode === "ai") setSurface(await openWorkspaceHelper(userId, projectId, next, (message) => { if (mounted.current) setHelperProgress(message); }));
    else setPreview(await projectPresets.preview(projectId, next));
  });

  const back = () => void run(async () => {
    if (!draft) return;
    const latest = draft.mode === "ai" ? await workspaceSetup.get(projectId) : draft;
    const next = { ...latest, mode: draft.mode === "ai" || draft.mode === "browse" ? "choice" as const : "browse" as const };
    await save(next);
    setDraft(next);
    setPreview(null);
    setSurface(null);
    setResult(null);
    setAIConfirmed(false);
  });

  const finish = (destination: string) => void run(async () => {
    await save(draft!);
    if (onFinish) await onFinish(destination, onboarding ? draft?.interface_level || initialInterfaceLevel : undefined);
    else navigate(destination);
  });

  const reviewAI = () => void run(async () => {
    await saves.current;
    const [saved, currentAgents, installed, connections, projectSkills, marketplace] = await Promise.all([
      workspaceSetup.get(projectId), instances.list(projectId), apps.list(projectId), integrations.connections(projectId), skillsAPI.list(projectId), apps.marketplace(projectId, undefined, { pageSize: 100 }),
    ]);
    setDraft(saved);
    setAgents(currentAgents);
    setAIConfirmed(currentAgents.length > 0 && currentAgents.every((agent) => !isStagedAgent(agent)));
    const nextResources = { apps: installed, connections, skills: projectSkills, marketplace: marketplace.apps };
    setResources(nextResources);
    setReview({ agents: currentAgents, apps: [...new Set(installed.map((app) => app.name))], resources: nextResources });
  });

  const confirmAIWorkspace = () => void run(async () => {
    if (!draft || !review?.agents.length) return;
    await save(draft);
    const confirmed = await workspaceSetup.confirm(projectId);
    if (confirmed.warnings?.length) setError(confirmed.warnings.join(" "));
    if (!confirmed.warnings?.length) setAIConfirmed(true);
    window.dispatchEvent(new Event("apteva:agents-changed"));
    const [currentAgents, installed, connections, projectSkills, marketplace] = await Promise.all([
      instances.list(projectId), apps.list(projectId), integrations.connections(projectId), skillsAPI.list(projectId), apps.marketplace(projectId, undefined, { pageSize: 100 }),
    ]);
    const nextResources = { apps: installed, connections, skills: projectSkills, marketplace: marketplace.apps };
    setAgents(currentAgents);
    setResources(nextResources);
    setReview({ agents: currentAgents, apps: [...new Set(installed.map((app) => app.name))], resources: nextResources });
  });

  const browse = () => void run(async () => {
    if (!draft) return;
    const next = { ...draft, mode: "browse" as const };
    await save(next);
    setDraft(next);
  });

  const apply = () => void run(async () => {
    if (!draft || !preview) return;
    await save(draft);
    const applied = await projectPresets.apply(projectId, { preset_id: draft.preset_id, description: draft.description, agent_overrides: draft.agent_overrides, interface_level: draft.interface_level });
    setResult(applied);
    window.dispatchEvent(new Event("apteva:agents-changed"));
    window.dispatchEvent(new Event("apteva:apps-changed"));
  });

  if (!draft) return <div className="p-6 text-sm text-text-muted">{error ? <><p role="alert">{error}</p><button className={secondaryClass} onClick={() => setAttempt((n) => n + 1)}>Retry</button></> : "Loading setup options…"}</div>;
  const selected = catalog.find((preset) => preset.id === draft.preset_id);
  const search = query.trim().toLowerCase();
  const visible = catalog.filter((preset) => search
    ? `${preset.name} ${preset.description} ${(preset.highlights || []).join(" ")} ${preset.agents.flatMap((agent) => agent.apps || []).join(" ")}`.toLowerCase().includes(search)
    : !draft.category || preset.category === draft.category);

  const interfacePicker = onboarding ? <InterfacePicker value={draft.interface_level || initialInterfaceLevel} onChange={(interface_level) => update({ ...draft, interface_level }, false)} /> : null;

  if (review) return <section className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col py-5 sm:py-8">
    <header className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Final check</p>
      <h1 className="mt-2 text-2xl font-semibold">Review your workspace</h1>
      <p className="mt-2 max-w-2xl text-sm text-text-muted">These are the real agents and workspace resources Helper has prepared. They are staged until you confirm activation.</p>
    </header>
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <div className="min-h-0 overflow-y-auto rounded-2xl border border-border bg-bg-card/60 p-4 sm:p-5">
        <WorkspaceActualDetails agents={review.agents} resources={review.resources} />
      </div>
      <div className="space-y-4"><fieldset disabled={busy}>{interfacePicker}</fieldset><div className="rounded-xl border border-border bg-bg-card/50 p-4 text-xs leading-relaxed text-text-muted">Helper has already created the staged agents and attached the resources it could prepare. Confirmation starts the staged agents; simulations can then run against those exact agents.</div></div>
    </div>
    <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-5"><button disabled={busy} onClick={() => void run(async () => { await save(draft); setReview(null); })} className={secondaryClass}>← Conversation</button>{aiConfirmed ? <button disabled={busy} onClick={() => finish("/")} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Finish setup</button> : <button disabled={busy || !review.agents.length} onClick={confirmAIWorkspace} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg disabled:opacity-50">Confirm and activate</button>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-red">{error}</p>}
  </section>;

  if (draft.mode === "choice") return <section className="m-auto w-full max-w-xl py-8">
    <h1 className="text-3xl font-semibold">How would you like to configure your workspace?</h1>
    <p className="mt-3 text-sm text-text-muted">Choose how to get started. You can change your choice as you go.</p>
    <div className="mt-7 grid gap-3">
      {aiAvailable && <button disabled={busy} onClick={() => chooseMode("ai")} className="rounded-xl border border-accent bg-accent/5 p-5 text-left disabled:opacity-50"><span className="block font-semibold text-accent">Configure with AI</span><span className="mt-2 block text-sm text-text-muted">Talk with Apteva Helper. It will configure real staged agents and resources as you go, then let you activate them.</span></button>}
      <button disabled={busy} onClick={browse} className="rounded-xl border border-border bg-bg-card p-5 text-left disabled:opacity-50"><span className="block font-semibold">Explore presets</span><span className="mt-2 block text-sm text-text-muted">Explore presets and choose the agents and capabilities to start with.</span></button>
    </div>
    {!aiAvailable && <p className="mt-4 text-sm text-text-muted"><Link className="text-accent" to="/onboarding?provider=1">Connect AI</Link> to configure your workspace with Helper.</p>}
    {busy && <p role="status" className="mt-4 text-sm text-text-muted">Preparing setup…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red">{error}</p>}
  </section>;

  if (draft.mode === "scratch") return <div className="min-h-0 flex-1 overflow-y-auto">
    <button disabled={busy} onClick={back} className={secondaryClass}>← Presets</button>
    {scratchAgent ? <section className="space-y-4 p-6"><h1 className="text-xl font-semibold">{scratchAgent.name} created</h1><p>{scratchAgent.warning || `Status: ${scratchAgent.status}`}</p>{interfacePicker}<button disabled={busy} onClick={() => finish(`/agents/${scratchAgent.id}`)} className={secondaryClass}>Finish setup</button></section> : <AgentNew reviewContent={interfacePicker} onCreated={(agent) => { sessionStorage.setItem(scratchKey, String(agent.id)); setScratchAgent(agent); }} onBack={back} />}
    {error && <p role="alert" className="mt-4 text-sm text-red">{error}</p>}
  </div>;

  if (draft.mode === "ai" && surface) return <>
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-end gap-2 px-1 py-2">
      <div className="mr-auto"><span className="block text-xs font-semibold text-text">Setup with Helper</span><span className="hidden text-[11px] text-text-dim sm:block">Configure the workspace in chat and watch it update live.</span></div>
      <div className="order-last flex w-full rounded-lg border border-border bg-bg-card p-1 sm:hidden">
        <button type="button" aria-pressed={mobilePane === "chat"} onClick={() => setMobilePane("chat")} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${mobilePane === "chat" ? "bg-bg-input text-text" : "text-text-muted"}`}>Chat</button>
        <button type="button" aria-pressed={mobilePane === "plan"} onClick={() => setMobilePane("plan")} className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${mobilePane === "plan" ? "bg-bg-input text-text" : "text-text-muted"}`}>Workspace{agents.length ? ` · ${agents.length}` : ""}</button>
      </div>
      <button disabled={busy} onClick={back} className={secondaryClass}>← Setup options</button>
      <button disabled={busy || !agents.length} onClick={reviewAI} className={`${secondaryClass} sm:hidden`}>Review setup</button>
    </header>
    <div className="mt-3 grid min-h-0 flex-1 gap-3 sm:grid-cols-2">
      <div className={`${mobilePane === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 w-full overflow-hidden rounded-2xl border border-border bg-bg sm:flex`}><ContributionMount
        apps={surface.rows} projectId={projectId} agentId={surface.helper.id} slot="dashboard.build"
        pageContext={draft ? describeSetupPage(projectId, draft) : undefined}
        instance={{ id: `setup:${surface.helper.id}:${surface.conversationId}`, component: surface.contribution.key, contribution: surface.contribution, size: "full", settings: {
          ...workspaceSetupConversationSettings,
          initial_conversation_id: surface.conversationId,
          empty_message: "Welcome. Tell me what you’d like to accomplish, and I’ll help you choose a starting point.",
        } }}
      /></div>
      <aside className={`${mobilePane === "plan" ? "flex" : "hidden"} min-h-0 min-w-0 w-full overflow-hidden sm:flex`}><WorkspacePlanPanel agents={agents} resources={resources} busy={busy} onReview={reviewAI} /></aside>
    </div>
    {error && <p role="alert" className="p-3 text-sm text-red">{error}</p>}
  </>;

  if (draft.mode === "ai") return <section className="m-auto w-full max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-semibold">Set up with Apteva Helper</h1>
    {busy && <p role="status">{helperProgress}</p>}
    {error && <><p role="alert" className="text-sm text-red">{error}</p><button disabled={busy} onClick={() => setAttempt((n) => n + 1)} className={secondaryClass}>Retry</button></>}
    <button disabled={busy} onClick={back} className={secondaryClass}>← Setup options</button>
  </section>;

  return <div className="mx-auto w-full max-w-4xl p-5 sm:p-8">
    <header className="mb-6"><h1 className="text-2xl font-semibold text-text">{draft.mode === "manual" ? "Configure your setup" : "What would you like to start with?"}</h1><p className="mt-2 text-sm text-text-muted">Choose a preset, review its agents and apps, then create your setup.</p></header>
    <button disabled={busy} onClick={back} className="mb-4 text-sm text-text-muted">{draft.mode === "manual" ? "← Presets" : "← Setup options"}</button>
    <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-70">
      {draft.mode === "manual" && preview ? <>
        <h2 className="text-lg font-semibold text-text">{preview.preset.name}</h2>
        <p className="text-sm text-text-muted">{draft.description}</p>
        <p className="text-sm text-text-muted">Review the agents and adjust their names, instructions, or behavior before creating this setup.</p>
        {interfacePicker}
        <PresetContentsSummary preset={preview.preset} />
        {preview.agents.map((agent) => {
          const current = draft.agent_overrides?.find((item) => item.key === agent.key) || agent;
          const change = (patch: Partial<typeof current>) => update({ ...draft, agent_overrides: [
            ...(draft.agent_overrides || []).filter((item) => item.key !== agent.key),
            { key: current.key, name: current.name, directive: current.directive, mode: current.mode, ...patch },
          ] });
          return <section key={agent.key} className="space-y-3 rounded-xl border border-border bg-bg-card p-4">
            <label className="block text-sm text-text">Agent name<input className={`${inputClass} mt-1`} value={current.name} maxLength={200} onChange={(e) => change({ name: e.target.value })} /></label>
            <label className="block text-sm text-text">Instructions<textarea className={`${inputClass} mt-1`} rows={5} value={current.directive} maxLength={16000} onChange={(e) => change({ directive: e.target.value })} /></label>
            <label className="block text-sm text-text">Behavior<select className={`${inputClass} mt-1`} value={current.mode} onChange={(e) => change({ mode: e.target.value as "learn" | "cautious" | "autonomous" })}><option value="learn">Learn</option><option value="cautious">Cautious</option><option value="autonomous">Autonomous</option></select></label>
            <p className="text-xs text-text-muted">Apps: {preview.preset.agents.find((item) => item.key === agent.key)?.apps?.join(", ") || "None"}</p>
          </section>;
        })}
        {!!preview.warnings?.length && !result && <div className="rounded-lg border border-border p-4 text-sm text-text-muted"><p className="mb-2 font-medium text-text">Setup requirements</p>{preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}<p className="mt-2">Available apps are attached during setup. Missing apps may require installation by your administrator.</p></div>}
        {!result && <button onClick={apply} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg">Create setup</button>}
        {result && <SetupResult result={result} retry={apply} finish={finish} />}
      </> : <>
        <label className="block text-sm text-text">What would you like help with?<textarea className={`${inputClass} mt-2`} rows={3} maxLength={4000} value={draft.description} onChange={(e) => update({ ...draft, description: e.target.value })} placeholder="Describe your goals, your work, or what you would like to automate." /></label>
        <input type="search" aria-label="Search presets" placeholder="Search presets…" className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-2">{categories.map((category) => <button key={category} aria-pressed={draft.category === category && !search} onClick={() => { setQuery(""); update({ ...draft, category }); }} className={`rounded-full border px-3 py-1.5 text-sm capitalize ${draft.category === category && !search ? "border-accent text-accent" : "border-border text-text-muted"}`}>{category || "All"}</button>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button aria-pressed={!draft.preset_id} onClick={() => update({ ...draft, preset_id: "", interface_level: undefined, agent_overrides: [], mode: "browse" })} className={`rounded-xl border p-4 text-left ${!draft.preset_id ? "border-accent bg-accent/5" : "border-border bg-bg-card"}`}><span className="font-semibold text-text">Start from scratch</span><p className="mt-2 text-sm text-text-muted">Create and configure your own agent.</p></button>
          {visible.map((preset) => <button key={preset.id} aria-pressed={draft.preset_id === preset.id} onClick={() => update({ ...draft, preset_id: preset.id, interface_level: preset.interface_level, agent_overrides: [], mode: "browse" })} className={`rounded-xl border p-4 text-left ${draft.preset_id === preset.id ? "border-accent bg-accent/5" : "border-border bg-bg-card hover:border-text-dim"}`}><span className="font-semibold text-text">{preset.name}</span><p className="mt-2 text-sm text-text-muted">{preset.description}</p><p className="mt-3 text-xs text-text-dim">{presetCountSummary(preset)}</p></button>)}
        </div>
        {visible.length === 0 && <p className="text-sm text-text-muted">No presets match. Try another search or start from scratch.</p>}
        {selected && <PresetContentsSummary preset={selected} />}
        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
          <button onClick={() => chooseMode("manual")} className={secondaryClass}>Continue</button>
        </div>
      </>}
    </fieldset>
    {busy && <p role="status" className="mt-4 text-sm text-text-muted">Preparing your setup…</p>}
    {error && <div className="mt-4"><p role="alert" className="text-sm text-red">{error}</p>{draft.mode !== "browse" && !preview && <button disabled={busy} onClick={() => setAttempt((n) => n + 1)} className={`${secondaryClass} mt-2`}>Retry</button>}</div>}
  </div>;
}

function workspacePlanItemCount(proposal: WorkspaceSetupProposal | null, resources: WorkspaceResources) {
  const preview = proposal?.preview;
  if (!preview) return resources.connections.length + resources.skills.filter((skill) => skill.enabled).length;
  return preview.agents.length + preview.apps.length + resources.connections.filter((connection) => connection.status === "active").length + resources.skills.filter((skill) => skill.enabled).length;
}

function planStatus(status?: WorkspaceSetupProposal["status"]) {
  if (status === "ready") return { label: "Ready", dot: "bg-green", tone: "text-green bg-green/10 border-green/20" };
  if (status === "needs_attention") return { label: "Needs attention", dot: "bg-yellow", tone: "text-yellow bg-yellow/10 border-yellow/20" };
  if (status === "proposed") return { label: "Draft plan", dot: "bg-accent", tone: "text-accent bg-accent/10 border-accent/20" };
  return { label: "Listening", dot: "bg-text-dim", tone: "text-text-muted bg-bg-input border-border" };
}

function WorkspacePlanPanel({ agents, resources, busy, onReview }: { agents: Agent[]; resources: WorkspaceResources; busy: boolean; onReview: () => void }) {
  const staged = agents.filter((agent) => isStagedAgent(agent)).length;
  const running = agents.filter((agent) => agent.status === "running").length;
  const status = agents.length === 0 ? { label: "Listening", dot: "bg-text-dim", tone: "text-text-muted bg-bg-input border-border" } : staged > 0 ? { label: "Ready to review", dot: "bg-accent", tone: "text-accent bg-accent/10 border-accent/20" } : { label: "Active", dot: "bg-green", tone: "text-green bg-green/10 border-green/20" };
  return <section className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-card/75" aria-label="Workspace">
    <header className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">Live workspace</p><h2 className="mt-1 text-base font-semibold text-text">Your workspace</h2></div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold ${status.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">{agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"} · ${running} active${staged ? ` · ${staged} staged` : ""}` : "As you talk, Helper’s configured workspace will appear here."}</p>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5"><WorkspaceActualDetails agents={agents} resources={resources} /></div>
    <footer className="shrink-0 border-t border-border bg-bg/35 p-3 sm:p-4">
      <button type="button" disabled={busy || !agents.length} onClick={onReview} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity disabled:cursor-not-allowed disabled:opacity-35">Review workspace</button>
      <p className="mt-2 text-center text-[10px] text-text-dim">Helper creates staged resources as you configure. Confirmation activates them.</p>
    </footer>
  </section>;
}

function isStagedAgent(agent: Agent) {
  try {
    const config = JSON.parse(agent.config || "{}");
    return config?.onboarding_staged === true;
  } catch {
    return false;
  }
}

function WorkspaceActualDetails({ agents, resources }: { agents: Agent[]; resources: WorkspaceResources }) {
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const activeConnections = resources.connections.filter((connection) => connection.status === "active");
  const enabledSkills = resources.skills.filter((skill) => skill.enabled);
  const warnings = resources.apps.filter((app) => app.status === "error");
  if (!agents.length && !resources.apps.length && !activeConnections.length && !enabledSkills.length) return <div className="grid min-h-52 place-items-center px-3 text-center"><div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-lg text-accent">✦</div><p className="mt-4 text-sm font-medium text-text">Start with the outcome</p><p className="mx-auto mt-1 max-w-64 text-xs leading-relaxed text-text-muted">Tell Helper what this workspace should accomplish. Real agents and resources will appear here as they are created.</p></div></div>;
  return <><div className="space-y-5">
    <PlanSection title="Agents" count={agents.length} empty="No agents created yet">
      {agents.map((agent) => {
        const staged = isStagedAgent(agent);
        let config: Record<string, any> = {};
        try { config = JSON.parse(agent.config || "{}"); } catch { /* show safe defaults */ }
        const mode = agent.mode || "cautious";
        const agentStatus = agent.status || "stopped";
        const status = staged ? "Staged" : agentStatus === "running" ? "Active" : humanizeSetupName(agentStatus);
        return <PlanRow key={agent.id} name={agent.name} detail={`${humanizeSetupName(mode)} · ${agentStatus}`} status={status} ready={!staged && agentStatus === "running"} visual={{ kind: "agent", name: agent.name }} onClick={() => setDetail({ kind: "Agent", title: agent.name, status, tone: !staged && agentStatus === "running" ? "ready" : staged ? "planned" : "warning", visual: { kind: "agent", name: agent.name }, description: staged ? "Created by Helper and waiting for your confirmation before activation." : "An agent configured for this workspace.", facts: [{ label: "Agent ID", value: String(agent.id) }, { label: "Behavior", value: humanizeSetupName(mode) }, { label: "Status", value: status }, { label: "Background memory", value: config.unconscious ? "Enabled" : "Off" }], groups: [{ label: "Directive", text: agent.directive || "No directive supplied" }, { label: "App access", text: "Configured on the agent" }] })} />;
      })}
    </PlanSection>
    <PlanSection title="Installed apps" count={resources.apps.length} empty="Apps will appear when Helper installs or finds them">
      {resources.apps.map((app) => { const visual: PlanVisual = { kind: "app", name: app.display_name || app.name, src: app.icon, iconStyle: app.icon_style }; const ready = app.status === "running"; return <PlanRow key={app.install_id} name={app.display_name || humanizeSetupName(app.name)} detail={app.project_id ? "Project app" : "Available in workspace"} status={app.status === "error" ? "Error" : ready ? "Ready" : humanizeSetupName(app.status)} ready={ready} warning={app.status === "error"} visual={visual} onClick={() => setDetail({ kind: "App", title: app.display_name || humanizeSetupName(app.name), status: app.status, tone: app.status === "error" ? "warning" : ready ? "ready" : "planned", visual, description: app.description || "Installed app available to the workspace.", facts: [{ label: "App", value: app.name }, { label: "Version", value: app.version || "—" }, { label: "Status", value: humanizeSetupName(app.status) }] })} />; })}
    </PlanSection>
    <PlanSection title="Available connections" count={activeConnections.length} empty="No project connections yet">{activeConnections.map((connection) => { const visual: PlanVisual = { kind: "connection", name: connection.app_name, src: connection.logo }; return <PlanRow key={connection.id} name={connection.name || connection.app_name} detail={connection.app_name} status="Connected" ready visual={visual} onClick={() => setDetail({ kind: "Connection", title: connection.name || connection.app_name, status: "Connected", tone: "ready", visual, description: `Authenticated ${connection.app_name} connection available to this project.`, facts: [{ label: "App", value: connection.app_name }, { label: "Authentication", value: humanizeSetupName(connection.auth_type) }] })} />; })}</PlanSection>
    <PlanSection title="Available skills" count={enabledSkills.length} empty="Skills supplied by installed apps will appear here">{enabledSkills.map((skill) => { const visual: PlanVisual = { kind: "skill", name: skill.name }; return <PlanRow key={skill.id} name={skill.name} detail={skill.app_name ? `From ${skill.app_name}` : "Workspace skill"} status="Available" ready visual={visual} onClick={() => setDetail({ kind: "Skill", title: skill.name, status: "Available", tone: "ready", visual, description: skill.description || "Instructions available to compatible agents.", facts: [{ label: "Source", value: skill.app_name || skill.source }, { label: "Version", value: skill.version || "—" }], groups: [{ label: "Instructions", text: skill.body, mono: true }] })} />; })}</PlanSection>
    {!!warnings.length && <section className="rounded-xl border border-yellow/20 bg-yellow/5 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-yellow"><span className="h-1.5 w-1.5 rounded-full bg-yellow" />Needs attention</div><div className="mt-2 space-y-1.5">{warnings.map((warning) => <p key={warning.install_id} className="text-[11px] leading-relaxed text-text-muted">{warning.display_name || warning.name} is not ready.</p>)}</div></section>}
  </div>{detail && <PlanDetailModal detail={detail} onClose={() => setDetail(null)} />}</>;
}

type PlanDetail = {
  kind: string;
  title: string;
  status: string;
  visual?: PlanVisual;
  tone?: "ready" | "warning" | "planned";
  description?: string;
  facts?: Array<{ label: string; value: string }>;
  groups?: Array<{ label: string; text?: string; items?: string[]; itemVisuals?: PlanVisual[]; mono?: boolean }>;
};

type PlanVisual = {
  kind: "agent" | "app" | "connection" | "skill" | "tool" | "widget";
  name: string;
  src?: string;
  iconStyle?: "image" | "monochrome";
};

function WorkspacePlanDetails({ proposal, resources, fallbackAgents = [] }: { proposal: WorkspaceSetupProposal | null; resources: WorkspaceResources; fallbackAgents?: { id: number; name: string; status: string }[] }) {
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const preview = proposal?.preview;
  const resultAgents = proposal?.result?.agents || [];
  const plannedAgents = preview?.agents || [];
  const activeConnections = resources.connections.filter((connection) => connection.status === "active");
  const enabledSkills = resources.skills.filter((skill) => skill.enabled);
  const previewWarnings = proposal?.status === "proposed" ? (preview?.warnings || []).filter((warning) => !isPlannedSetupNotice(warning)) : preview?.warnings || [];
  const warnings = [...new Set([...previewWarnings, ...(proposal?.result?.warnings || [])])];
  if (!preview && fallbackAgents.length === 0) return <div className="grid min-h-52 place-items-center px-3 text-center">
    <div><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-lg text-accent">✦</div><p className="mt-4 text-sm font-medium text-text">Start with the outcome</p><p className="mx-auto mt-1 max-w-64 text-xs leading-relaxed text-text-muted">Tell Helper what this workspace should accomplish. Agents, apps, and requirements will organize themselves here.</p></div>
  </div>;
  const agentRows = plannedAgents.length ? plannedAgents.map((agent) => {
    const applied = resultAgents.find((row) => row.name === agent.name);
    const appCount = agent.apps?.length || 0;
    const status = applied?.status || (proposal?.status === "proposed" ? "Planned" : "Configured");
    const toolNames = agent.apps.flatMap((name) => resources.apps.find((app) => app.name === name)?.surfaces?.mcp_tool_names || []);
    const inheritedSkills = enabledSkills.filter((skill) => !!skill.app_name && agent.apps.includes(skill.app_name));
    const appVisuals = agent.apps.map((name) => appVisualFor(name, resources));
    return {
      key: agent.key, name: agent.name, detail: `${agent.mode}${appCount ? ` · ${appCount} ${appCount === 1 ? "app" : "apps"}` : ""}`, status, ready: applied?.status === "running",
      visual: { kind: "agent" as const, name: agent.name },
      inspect: () => setDetail({
        kind: "Agent", title: agent.name, status, tone: applied?.status === "running" ? "ready" : "planned",
        visual: { kind: "agent", name: agent.name },
        description: "The agent Helper will configure for this workspace.",
        facts: [{ label: "Behavior", value: humanizeSetupName(agent.mode) }, { label: "Background memory", value: agent.unconscious ? "Enabled" : "Off" }, { label: "Assigned apps", value: String(appCount) }, { label: "Known MCP tools", value: String(toolNames.length) }],
        groups: [
          { label: "Directive", text: agent.directive },
          { label: "Apps & tool access", items: agent.apps.length ? agent.apps.map(humanizeSetupName) : ["No apps assigned"], itemVisuals: agent.apps.length ? appVisuals : undefined },
          { label: "Skills from assigned apps", items: inheritedSkills.length ? inheritedSkills.map((skill) => skill.name) : ["Skills supplied by new apps appear after installation"], itemVisuals: inheritedSkills.length ? inheritedSkills.map((skill) => ({ kind: "skill" as const, name: skill.name })) : undefined },
        ],
      }),
    };
  }) : fallbackAgents.map((agent) => ({
    key: String(agent.id), name: agent.name, detail: "Existing agent", status: agent.status, ready: agent.status === "running",
    visual: { kind: "agent" as const, name: agent.name },
    inspect: () => setDetail({ kind: "Agent", title: agent.name, status: agent.status, tone: agent.status === "running" ? "ready" : "warning", visual: { kind: "agent", name: agent.name }, description: "An existing agent in this workspace.", facts: [{ label: "Agent ID", value: String(agent.id) }, { label: "Status", value: humanizeSetupName(agent.status) }] }),
  }));
  return <><div className="space-y-5">
    <PlanSection title="Agents" count={agentRows.length} empty="No agents proposed yet">
      {agentRows.map((agent) => <PlanRow key={agent.key} name={agent.name} detail={agent.detail} status={agent.status} ready={agent.ready} visual={agent.visual} onClick={agent.inspect} />)}
    </PlanSection>
    <PlanSection title="Apps" count={preview?.apps.length || 0} empty="Apps will appear with the proposal">
      {preview?.apps.map((app) => {
        const installed = resources.apps.find((row) => row.name === app.name);
        const catalogApp = resources.marketplace?.find((row) => row.name === app.name);
        const ready = installed?.status === "running" || app.installed;
        const status = installed?.status === "error" ? "Error" : ready ? "Ready" : "Will add";
        const displayName = installed?.display_name || catalogApp?.display_name || humanizeSetupName(app.name);
        const visual: PlanVisual = { kind: "app", name: displayName, src: installed?.icon || catalogApp?.icon, iconStyle: installed?.icon_style || catalogApp?.icon_style };
        const assignedAgents = plannedAgents.filter((agent) => agent.apps.includes(app.name)).map((agent) => agent.name);
        const appSkills = enabledSkills.filter((skill) => skill.app_name === app.name);
        const toolNames = installed?.surfaces?.mcp_tool_names || [];
        return <PlanRow key={app.name} name={displayName} detail={ready ? "Available in this workspace" : "Added during setup"} status={status} ready={ready} warning={installed?.status === "error"} visual={visual} onClick={() => setDetail({
          kind: "App", title: displayName, status, tone: installed?.status === "error" ? "warning" : ready ? "ready" : "planned", visual,
          description: installed?.description || catalogApp?.description || (ready ? "Available to agents in this workspace." : "This app will be installed when you create the workspace."),
          facts: [{ label: "Version", value: installed?.version || "Latest available" }, { label: "Scope", value: app.scope ? humanizeSetupName(app.scope) : installed?.project_id ? "Project" : "Global" }, { label: "MCP tools", value: installed?.surfaces ? String(installed.surfaces.mcp_tool_count) : "After install" }, { label: "Skills", value: installed?.surfaces ? String(installed.surfaces.skill_count) : "After install" }],
          groups: [
            { label: "Assigned agents", items: assignedAgents.length ? assignedAgents : ["Not assigned directly to an agent"], itemVisuals: assignedAgents.length ? assignedAgents.map((name) => ({ kind: "agent" as const, name })) : undefined },
            { label: "Skills", items: appSkills.length ? appSkills.map((skill) => skill.name) : [ready ? "No enabled skills declared" : "Skill details will appear after installation"], itemVisuals: appSkills.length ? appSkills.map((skill) => ({ kind: "skill" as const, name: skill.name })) : undefined },
          ],
        })} />;
      })}
    </PlanSection>
    <PlanSection title="Available connections" count={activeConnections.length} empty="No project connections yet">
      {activeConnections.map((connection) => {
        const visual: PlanVisual = { kind: "connection", name: connection.app_name, src: connection.logo };
        return <PlanRow key={connection.id} name={connection.name || connection.app_name} detail={connection.app_name} status="Connected" ready visual={visual} onClick={() => setDetail({
          kind: "Connection", title: connection.name || connection.app_name, status: "Connected", tone: "ready", visual, description: `An authenticated ${connection.app_name} connection available to this project.`,
          facts: [{ label: "App", value: connection.app_name }, { label: "Authentication", value: humanizeSetupName(connection.auth_type) }, { label: "Tool count", value: String(connection.tool_count) }, { label: "Scope", value: connection.project_id ? "Project" : "Global" }],
          groups: [{ label: "Access", text: "The workspace can use this connection within its existing permissions. Reviewing it here does not grant additional access." }],
        })} />;
      })}
    </PlanSection>
    <PlanSection title="Available skills" count={enabledSkills.length} empty="Skills supplied by selected apps will appear here">
      {enabledSkills.map((skill) => {
        const visual: PlanVisual = { kind: "skill", name: skill.name };
        return <PlanRow key={skill.id} name={skill.name} detail={skill.app_name ? `From ${skill.app_name}` : skill.source === "user" ? "Workspace skill" : humanizeSetupName(skill.source)} status="Available" ready visual={visual} onClick={() => setDetail({
          kind: "Skill", title: skill.name, status: "Available", tone: "ready", visual, description: skill.description || "Instructions available to compatible agents in this workspace.",
          facts: [{ label: "Source", value: skill.app_name ? humanizeSetupName(skill.app_name) : humanizeSetupName(skill.source) }, { label: "Version", value: skill.version || "—" }, { label: "Command", value: skill.command || "No command" }, { label: "Enabled", value: skill.enabled ? "Yes" : "No" }],
          groups: [{ label: "Instructions", text: skill.body, mono: true }],
        })} />;
      })}
    </PlanSection>
    {!!preview?.layout.length && <PlanSection title="Home" count={preview.layout.length} empty="">{preview.layout.map((widget) => {
      const componentName = widget.component.split(":").pop() || widget.component;
      const visual: PlanVisual = { kind: "widget", name: componentName };
      return <PlanRow key={widget.id} name={humanizeSetupName(componentName)} detail={`${humanizeSetupName(widget.size)} widget`} status="Planned" visual={visual} onClick={() => setDetail({
        kind: "Home widget", title: humanizeSetupName(componentName), status: "Planned", tone: "planned", visual, description: "This widget will be placed on the workspace Home page.",
        facts: [{ label: "Component", value: widget.component }, { label: "Size", value: humanizeSetupName(widget.size) }],
        groups: widget.settings && Object.keys(widget.settings).length ? [{ label: "Settings", text: JSON.stringify(widget.settings, null, 2), mono: true }] : [{ label: "Settings", text: "Uses the widget defaults" }],
      })} />;
    })}</PlanSection>}
    {!!warnings.length && <section className="rounded-xl border border-yellow/20 bg-yellow/5 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-yellow"><span className="h-1.5 w-1.5 rounded-full bg-yellow" />Needs attention</div><div className="mt-2 space-y-1.5">{warnings.slice(0, 4).map((warning) => <p key={warning} className="text-[11px] leading-relaxed text-text-muted">{warning}</p>)}</div>{warnings.length > 4 && <p className="mt-2 text-[10px] text-text-dim">+{warnings.length - 4} more shown during review</p>}</section>}
  </div>{detail && <PlanDetailModal detail={detail} onClose={() => setDetail(null)} />}</>;
}

function PlanSection({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return <section><div className="mb-2 flex items-center gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{title}</h3><span className="rounded-full bg-bg-input px-1.5 py-0.5 text-[10px] tabular-nums text-text-dim">{count}</span></div>{count ? <div className="space-y-1.5">{children}</div> : <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-text-dim">{empty}</p>}</section>;
}

function PlanRow({ name, detail, status, visual, ready = false, warning = false, onClick }: { name: string; detail: string; status: string; visual?: PlanVisual; ready?: boolean; warning?: boolean; onClick?: () => void }) {
  const dot = warning ? "bg-red" : ready ? "bg-green" : "bg-accent";
  return <button type="button" onClick={onClick} aria-label={`View ${name} details`} className="group flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-border/70 bg-bg/45 px-3 py-2.5 text-left transition-colors hover:border-accent/35 hover:bg-bg-hover focus:outline-none focus:ring-1 focus:ring-accent/50"><span className="relative shrink-0">{visual ? <PlanVisualIcon visual={visual} /> : <span className="block h-8 w-8 rounded-lg border border-border bg-bg-input" />}<span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-card ${dot}`} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-text">{name}</span><span className="mt-0.5 block truncate text-[10px] text-text-dim">{detail}</span></span><span className={`shrink-0 text-[10px] font-medium ${warning ? "text-red" : ready ? "text-green" : "text-accent"}`}>{status}</span><span aria-hidden="true" className="shrink-0 text-sm text-text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-text-muted">›</span></button>;
}

function PlanVisualIcon({ visual, large = false, compact = false }: { visual: PlanVisual; large?: boolean; compact?: boolean }) {
  const frame = compact ? "h-5 w-5 rounded-md" : large ? "h-11 w-11 rounded-xl" : "h-8 w-8 rounded-lg";
  if (visual.kind === "app" || visual.kind === "connection") return <span className={`${frame} inline-flex shrink-0 items-center justify-center overflow-hidden border border-border ${visual.kind === "connection" ? "bg-white text-gray-800" : "bg-bg-input text-accent"}`} aria-hidden="true"><AppIcon src={visual.src} iconStyle={visual.iconStyle} name={visual.name} size={large ? "md" : compact ? "xs" : "sm"} framed={false} /></span>;
  const glyph = visual.kind === "agent" ? <><path d="M12 7V4" /><circle cx="12" cy="3" r="1" /><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M8 12h.01M16 12h.01M9 16h6M2 13h2M20 13h2" /></> : visual.kind === "skill" ? <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" /><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></> : visual.kind === "tool" ? <><path d="m14.7 6.3 3-3a4 4 0 0 1-5 5L7 14a2.1 2.1 0 1 0 3 3l5.7-5.7a4 4 0 0 1 5-5l-3 3" /><path d="m5 19-1 1" /></> : <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>;
  return <span className={`${frame} inline-flex shrink-0 items-center justify-center border border-accent/20 bg-accent/10 text-accent`} aria-hidden="true"><svg width={large ? 24 : compact ? 12 : 18} height={large ? 24 : compact ? 12 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{glyph}</svg></span>;
}

function appVisualFor(name: string, resources: WorkspaceResources): PlanVisual {
  const installed = resources.apps.find((app) => app.name === name);
  const catalog = resources.marketplace?.find((app) => app.name === name);
  return { kind: "app", name: installed?.display_name || catalog?.display_name || humanizeSetupName(name), src: installed?.icon || catalog?.icon, iconStyle: installed?.icon_style || catalog?.icon_style };
}

function PlanDetailModal({ detail, onClose }: { detail: PlanDetail; onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const tone = detail.tone === "ready" ? "border-green/20 bg-green/10 text-green" : detail.tone === "warning" ? "border-yellow/20 bg-yellow/10 text-yellow" : "border-accent/20 bg-accent/10 text-accent";
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm sm:p-8" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="workspace-plan-detail-title" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-card shadow-2xl">
      <header className="flex shrink-0 items-start gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
        {detail.visual && <PlanVisualIcon visual={detail.visual} large />}
        <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">{detail.kind}</p><h2 id="workspace-plan-detail-title" className="mt-1 truncate text-lg font-semibold text-text">{detail.title}</h2>{detail.description && <p className="mt-2 text-xs leading-relaxed text-text-muted">{detail.description}</p>}</div>
        <div className="flex shrink-0 items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${tone}`}>{detail.status}</span><button type="button" autoFocus aria-label="Close details" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg border border-border text-lg text-text-muted hover:bg-bg-hover hover:text-text">×</button></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {!!detail.facts?.length && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{detail.facts.map((fact) => <div key={fact.label} className="rounded-lg border border-border/70 bg-bg/45 p-3"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-dim">{fact.label}</dt><dd className="mt-1 break-words text-xs font-medium text-text">{fact.value}</dd></div>)}</dl>}
        {!!detail.groups?.length && <div className="mt-5 space-y-5">{detail.groups.map((group) => <section key={group.label}><h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">{group.label}</h3>{group.text !== undefined && <p className={`mt-2 whitespace-pre-wrap rounded-lg border border-border/70 bg-bg/45 p-3 text-xs leading-relaxed text-text-muted ${group.mono ? "font-mono" : ""}`}>{group.text || "No details available"}</p>}{group.items && <div className="mt-2 flex flex-wrap gap-1.5">{group.items.map((item, index) => <span key={item} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg/45 px-2 py-1 text-[11px] text-text-muted">{group.itemVisuals?.[index] && <PlanVisualIcon visual={group.itemVisuals[index]!} compact />}{item}</span>)}</div>}</section>)}</div>}
      </div>
    </section>
  </div>;
}

function humanizeSetupName(value: string) {
  return value.split(/[-_]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function isPlannedSetupNotice(warning: string) {
  return warning.endsWith("not installed for this project") || /^dashboard widget .+ is unavailable until its app is installed$/.test(warning);
}

function SetupResult({ result, retry, finish }: { result: ApplyResult; retry: () => void; finish: (destination: string) => void }) {
  const agents = [...result.created_agents, ...result.existing_agents];
  const ready = agents.length > 0 && agents.every((agent) => agent.status === "running") && !result.warnings?.length;
  const destination = agents.length === 1 ? `/conversations?agent=${agents[0]!.id}` : "/agents";
  return <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Setup result">
    <h2 className="font-semibold text-text">{ready ? "Your setup is ready" : "Your setup needs attention"}</h2>
    <p className="text-sm text-text-muted">{result.created_agents.length} agents created · {result.existing_agents.length} existing agents reused</p>
    {agents.map((agent) => <p key={agent.id} className="text-sm text-text">{agent.name} · {agent.status}</p>)}
    {result.warnings?.map((warning, index) => <p key={index} className="text-sm text-text-muted">{warning}</p>)}
    <div className="flex flex-wrap gap-2">{!!agents.length && <button onClick={() => finish(destination)} className={secondaryClass}>Finish setup</button>}{!ready && <button onClick={retry} className={secondaryClass}>Retry setup</button>}</div>
  </section>;
}


function InterfacePicker({ value, onChange }: { value: InterfaceLevel; onChange: (value: InterfaceLevel) => void }) {
  return <label className="block rounded-xl border border-border p-4 text-sm">
    <span className="font-semibold">Your interface</span>
    <select aria-label="Your interface" className={`${inputClass} mt-2`} value={value} onChange={(event) => onChange(event.target.value as InterfaceLevel)}>
      <option value="personal">Focused — agents and conversations</option>
      <option value="business">Workspace — dashboard, apps and agents</option>
      <option value="developer">Advanced — all controls and diagnostics</option>
    </select>
    <span className="mt-2 block text-xs text-text-muted">This sets your view of Apteva. You can change it later in Settings; other members keep their own preferences.</span>
  </label>;
}
