import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apps, auth, instances, projectPresets, workspaceSetup, type InterfaceLevel, type ProjectPreset, type ProjectPresetPreview, type WorkspaceSetupDraft } from "../api";
import { ContributionMount } from "../components/apps/contributions";
import { describeSetupPage } from "../components/chat/pageContext";
import { PresetContentsSummary, presetCountSummary } from "../components/projects/ProjectPresetSetup";
import { useAuth } from "../hooks/useAuth";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { AgentNew } from "./AgentNew";
import { openWorkspaceHelper } from "../utils/workspaceSetup";

type HelperSurface = Awaited<ReturnType<typeof openWorkspaceHelper>>;
type ApplyResult = Awaited<ReturnType<typeof projectPresets.apply>>;
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-4 py-5 sm:px-8 sm:py-8">
      <div className="mb-4 flex shrink-0 items-center justify-between"><span className="text-lg font-semibold text-accent">Apteva</span><span className="text-xs text-text-muted">Welcome · Set up your workspace</span></div>
      {!currentProject || !user ? <p className="p-6 text-sm text-text-muted">Loading your workspace…</p> :
        <SetupFlow key={`${user.id}:${currentProject.id}`} projectId={currentProject.id} userId={user.id} initialInterfaceLevel={user.interfaceLevel || "business"} onboarding={!user.onboarded} onFinish={finish} />}
    </div>
  </main>;
}

export function SetupFlow({ projectId, userId, onFinish, initialInterfaceLevel = "business", onboarding = true }: { projectId: string; userId: number; initialInterfaceLevel?: InterfaceLevel; onboarding?: boolean; onFinish?: (destination: string, interfaceLevel?: InterfaceLevel) => Promise<void> }) {
  const navigate = useNavigate();
  const [review, setReview] = useState<{ agents: { id: number; name: string; status: string }[]; apps: string[] } | null>(null);
  const [aiAvailable, setAIAvailable] = useState(false);
  const scratchKey = `apteva:setup-agent:${userId}:${projectId}`;
  const [scratchAgent, setScratchAgent] = useState<{ id: number; name: string; status: string; warning?: string } | null>(null);
  const [draft, setDraft] = useState<WorkspaceSetupDraft | null>(null);
  const [catalog, setCatalog] = useState<ProjectPreset[]>([]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ProjectPresetPreview | null>(null);
  const [helperProgress, setHelperProgress] = useState("Opening your conversation with Apteva Helper…");
  const [surface, setSurface] = useState<HelperSurface | null>(null);
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
  });

  const finish = (destination: string) => void run(async () => {
    await save(draft!);
    if (onFinish) await onFinish(destination, onboarding ? draft?.interface_level || initialInterfaceLevel : undefined);
    else navigate(destination);
  });

  const reviewAI = () => void run(async () => {
    await saves.current;
    const [saved, agents, installed] = await Promise.all([workspaceSetup.get(projectId), instances.list(projectId), apps.list(projectId)]);
    setDraft(saved);
    setReview({ agents, apps: [...new Set(installed.map((app) => app.name))] });
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

  if (review) return <section className="mx-auto w-full max-w-2xl space-y-5 py-8">
    <h1 className="text-2xl font-semibold">Review your workspace</h1>
    <div className="rounded-xl border border-border p-5"><h2 className="font-semibold">Agents</h2>{review.agents.map((agent) => <p key={agent.id} className="mt-2 text-sm">{agent.name} · {agent.status}</p>)}<h2 className="mt-4 font-semibold">Available apps</h2><p className="mt-2 text-sm text-text-muted">{review.apps.join(", ") || "None"}</p></div>
    <fieldset disabled={busy}>{interfacePicker}</fieldset>
    <div className="flex gap-3"><button disabled={busy} onClick={() => void run(async () => { await save(draft); setReview(null); })} className={secondaryClass}>← Conversation</button><button disabled={busy} onClick={() => finish("/")} className={secondaryClass}>Finish setup</button></div>
    {error && <p role="alert" className="text-sm text-red">{error}</p>}
  </section>;

  if (draft.mode === "choice") return <section className="m-auto w-full max-w-xl py-8">
    <h1 className="text-3xl font-semibold">How would you like to configure your workspace?</h1>
    <p className="mt-3 text-sm text-text-muted">Choose how to get started. You can change your choice as you go.</p>
    <div className="mt-7 grid gap-3">
      {aiAvailable && <button disabled={busy} onClick={() => chooseMode("ai")} className="rounded-xl border border-accent bg-accent/5 p-5 text-left disabled:opacity-50"><span className="block font-semibold text-accent">Configure with AI</span><span className="mt-2 block text-sm text-text-muted">Talk with Apteva Helper. Describe what you need and review its proposed setup.</span></button>}
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
    <header className="flex min-h-12 shrink-0 items-center justify-end gap-2 px-1 py-2">
      <span className="mr-auto text-xs text-text-dim">Setup with Helper</span>
      <button disabled={busy} onClick={back} className={secondaryClass}>← Setup options</button>
      <button disabled={busy} onClick={reviewAI} className={secondaryClass}>Review setup</button>
    </header>
    <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-border"><ContributionMount
      apps={surface.rows} projectId={projectId} agentId={surface.helper.id} slot="dashboard.build"
      pageContext={draft ? describeSetupPage(projectId, draft) : undefined}
      instance={{ id: `setup:${surface.helper.id}:${surface.conversationId}`, component: surface.contribution.key, contribution: surface.contribution, size: "full", settings: {
        ...workspaceSetupConversationSettings,
        initial_conversation_id: surface.conversationId,
        empty_message: "Welcome. Tell me what you’d like to accomplish, and I’ll help you choose a starting point.",
      } }}
    /></div>
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
