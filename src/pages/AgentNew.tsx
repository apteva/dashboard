import { PickerOption } from "../components/PickerOption";
import { ProactivityControl } from "../components/ProactivityControl";
import { defaultProactivity, proactivityLabel } from "../agentBehavior";
import { behaviorDescriptions, behaviorExplanation } from "../agentBehavior";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { useNavigate } from "react-router-dom";
import {
  agentTemplates,
  apps as appsAPI,
  instances,
  integrations as integrationsAPI,
  integrations,
  type AgentTemplate,
  type AppRow,
  type AppGrantPolicy,
  type AppPermissionCatalog,
  type AppSummary,
  type ConnectionInfo,
  type MarketplaceEntry,
  type Requirement,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { Modal } from "../components/Modal";
import { ConnectIntegrationModal } from "../components/integrations/ConnectIntegrationModal";
import { structureDirectiveDraft } from "../utils/directiveMarkdown";

// AgentNew — guided "build your first agent" wizard. Four steps:
//
//   1. Pick a starting template (or "Empty" to start blank).
//   2. Name + directive (prefilled from template, editable).
//   3. Behavior — behavior mode, unconscious thread, system MCPs.
//   4. Review + create — single POST to /agents with all gathered fields.
//
// Templates are fetched from the server (/agent-templates). Builtin
// + app-contributed + user-saved all flow through one list. Step 1
// also surfaces an "Advanced — skip the wizard" link for power users.
//
// The P1.1 server-side gate (handleCreateInstance refuses start=true
// when the user has no LLM provider) means a no-provider user lands
// on a created-but-stopped agent with a warning. The wizard checks
// providers.list() at mount and either gates the final step or
// downgrades to start=false with a clear notice.

type StepId = "template" | "details" | "setup" | "review";

const STEPS: { id: StepId; label: string }[] = [
  { id: "template", label: "Template" },
  // Details combines name, directive, behavior mode, and background-
  // memory toggle. Used to be two separate steps (Details +
  // Behavior) but the Behavior step was thin once System MCPs got
  // hardcoded — folding them keeps the wizard tighter (5 steps
  // instead of 6) without losing any user-facing decisions.
  { id: "details",  label: "Details" },
  // Setup — surfaces the template's requirements (apps + integrations)
  // and lets the operator connect what's missing. Required apps
  // auto-install at create time so they show as informational;
  // required integrations check the operator's existing connections
  // by compatible_slugs and offer a deep-link to /integrations when
  // none match. The step is skippable; missing dependencies are
  // surfaced before the agent is created.
  { id: "setup",    label: "Setup" },
  { id: "review",   label: "Review" },
];

// On Create, the wizard installs every kind=app, required=true
// requirement that isn't already in this project before calling
// instances.create. The user never sees an Apps step — the spinner
// covers it. Install errors surface in the same red bar as agent
// creation errors. Optional apps (required=false) are ignored here;
// the operator can pick them up from the agent's detail page.

type Mode = "autonomous" | "cautious" | "learn";

interface AppAccessDraft {
  mode: "full" | "limited";
  folders: string;
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface WizardState {
  templateID: string | null;
  name: string;
  directive: string;
  mode: Mode;
  proactivity: number;
  unconscious: boolean;
  includeChannels: boolean;
  recommendedApps: string[]; // surface-only, no install in this flow
  highlights: string[];
  // Explicit selections; project app defaults seed once, template connections
  // seed once per template, and subsequent edits belong to the operator.
  boundAppInstallIDs: Set<number>;
  boundConnectionIDs: Set<number>;
  appAccess: Record<number, AppAccessDraft>;
}

export const INITIAL: WizardState = {
  templateID: null,
  name: "",
  directive: "",
  mode: "learn",
  proactivity: defaultProactivity,
  unconscious: true,
  // Replacement default: the conversations app owns the conversation
  // surface now, so new agents skip the legacy channels/agent-output
  // MCPs. Explicit opt-in remains possible from the agent detail page.
  includeChannels: false,
  boundAppInstallIDs: new Set<number>(),
  boundConnectionIDs: new Set<number>(),
  appAccess: {},
  recommendedApps: [],
  highlights: [],
};

function defaultAppAccessDraft(): AppAccessDraft {
  return { mode: "full", folders: "/", read: true, write: false, delete: false };
}

export function defaultAgentAppInstallIDs(rows: AppRow[]): Set<number> {
  return new Set(
    rows
      .filter((app) => app.status === "running" && app.default_for_new_agents)
      .map((app) => app.install_id),
  );
}

export function effectiveAgentAppInstallIDs(
  selected: Iterable<number>,
  installedApps: AppRow[],
  requiredSlugs: Iterable<string>,
): number[] {
  const effective = new Set(selected);
  const required = new Set(requiredSlugs);
  for (const app of installedApps) {
    if (app.status === "running" && required.has(app.name)) {
      effective.add(app.install_id);
    }
  }
  return Array.from(effective);
}

export function requirementSlugs(requirement: Requirement): string[] {
  if (requirement.compatible_slugs?.length) return requirement.compatible_slugs;
  return requirement.slug ? [requirement.slug] : [];
}

export function templateAgentConnectionIDs(template: AgentTemplate | null, connections: ConnectionInfo[], projectId?: string): Set<number> {
  const ids = new Set<number>();
  for (const requirement of template?.requirements || []) {
    if (requirement.kind !== "integration" || !requirement.required) continue;
    const slugs = requirementSlugs(requirement);
    const eligible = connections.filter((connection) => connection.status === "active" && slugs.includes(connection.app_slug));
    // Choose one compatible account, preferring this project's connection.
    // Never attach every account merely because they share a provider.
    const match = eligible.find((connection) => !!projectId && connection.project_id === projectId) || eligible[0];
    if (match) ids.add(match.id);
  }
  return ids;
}

function folderGrantResource(folder: string): string {
  let f = folder.trim();
  if (!f || f === "/") return "folder/**";
  if (!f.startsWith("/")) f = `/${f}`;
  if (!f.endsWith("/")) f += "/";
  return `folder/${f.replace(/^\//, "")}**`;
}

function splitFolderInput(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildAppGrantPolicies(state: WizardState): AppGrantPolicy[] {
  const policies: AppGrantPolicy[] = [];
  for (const installId of state.boundAppInstallIDs) {
    const draft = state.appAccess[installId];
    if (!draft || draft.mode !== "limited") continue;
    const folders = splitFolderInput(draft.folders);
    if (folders.length === 0) {
      throw new Error("Limited app access needs at least one folder.");
    }
    const permissions = [
      draft.read ? "media.read" : "",
      draft.write ? "media.write" : "",
      draft.delete ? "media.delete" : "",
    ].filter(Boolean);
    policies.push({
      install_id: installId,
      default_effect: "deny",
      rules: folders.flatMap((folder) =>
        permissions.map((permission) => ({
          effect: "allow" as const,
          permission,
          resource: folderGrantResource(folder),
        })),
      ),
    });
  }
  return policies;
}

export function AgentNew() {
  usePageTitle("New Agent");

  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const [stepIdx, setStepIdx] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Installed apps + marketplace are fetched on mount so the Create
  // step can auto-install required apps from the chosen template's
  // requirements without re-querying. Both calls are cheap.
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [installedAppsLoaded, setInstalledAppsLoaded] = useState(false);
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  // Operator's existing integration connections, used by the Setup
  // step to satisfy template requirements. Refetched when the
  // operator returns from /integrations via the Refresh button.
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const seededConnectionsTemplate = useRef<string | null>(null);
  const connectionInventoryProject = useRef<string | null>(null);
  // Inline status the Review step renders during create — one line
  // per app the wizard is installing on the user's behalf.
  const [installProgress, setInstallProgress] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setInstalledAppsLoaded(false);
    setConnectionsLoaded(false);
    seededConnectionsTemplate.current = null;
    connectionInventoryProject.current = null;
    agentTemplates.list().then(setTemplates).catch(() => setTemplates([]));
    integrations
      .runtimeConnections(currentProject?.id)
      .then((list) => setHasProvider(list.some((c) => c.role === "llm")))
      .catch(() => setHasProvider(false));
    appsAPI
      .list(currentProject?.id)
      .then((list) => {
        if (cancelled) return;
        setInstalledApps(list);
        setInstalledAppsLoaded(true);
        const defaults = defaultAgentAppInstallIDs(list);
        const access: Record<number, AppAccessDraft> = {};
        for (const id of defaults) access[id] = defaultAppAccessDraft();
        setState((s) => ({
          ...s,
          boundAppInstallIDs: defaults,
          appAccess: access,
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setInstalledApps([]);
          setInstalledAppsLoaded(false);
        }
      });
    appsAPI
      .marketplace(currentProject?.id)
      .then((res) => setMarketplace(res.apps))
      .catch(() => setMarketplace([]));
    integrationsAPI
      .connections(currentProject?.id)
      .then((list) => { if (!cancelled) { connectionInventoryProject.current = currentProject?.id || ""; setConnections(list); setConnectionsLoaded(true); } })
      .catch(() => { if (!cancelled) { connectionInventoryProject.current = currentProject?.id || ""; setConnections([]); setConnectionsLoaded(true); } });
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id]);

  useEffect(() => {
    if (!connectionsLoaded || connectionInventoryProject.current !== (currentProject?.id || "") || !state.templateID || seededConnectionsTemplate.current === state.templateID) return;
    const template = templates.find((t) => t.id === state.templateID);
    if (!template) return;
    seededConnectionsTemplate.current = template.id;
    setState((current) => ({ ...current, boundConnectionIDs: templateAgentConnectionIDs(template, connections, currentProject?.id) }));
  }, [connectionsLoaded, connections, templates, state.templateID, currentProject?.id]);

  // Refresh inventories without reapplying defaults or undoing explicit removals.
  const refreshConnections = async () => {
    const [appList, connectionList] = await Promise.all([
      appsAPI.list(currentProject?.id),
      integrationsAPI.connections(currentProject?.id),
    ]);
    setInstalledApps(appList);
    setInstalledAppsLoaded(true);
    connectionInventoryProject.current = currentProject?.id || "";
    setConnections(connectionList);
    setConnectionsLoaded(true);
  };

  const step = STEPS[stepIdx]!;
  const isLast = stepIdx === STEPS.length - 1;

  const advance = () => {
    setError(null);
    if (isLast) {
      void create();
      return;
    }
    if (!validateStep()) return;
    setStepIdx(stepIdx + 1);
  };
  const back = () => {
    setError(null);
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  };

  // installRequiredApps runs the kind=app, required=true install
  // cascade for the chosen template. Already-installed apps are
  // skipped. Returns when every required app has reached `running`
  // (or throws on first install error). Parallel POSTs are safe —
  // apps_loader serializes the build step server-side via semaphore.
  const installRequiredApps = async (tpl: AgentTemplate): Promise<AppRow[]> => {
    const installedSlugs = new Set(installedApps.map((a) => a.name));
    const slugs = tpl.requirements
      .filter((r) => r.kind === "app" && r.required && r.slug)
      .map((r) => r.slug!)
      .filter((slug) => !installedSlugs.has(slug));
    if (slugs.length === 0) return installedApps;

    const installIDs: Record<string, number> = {};
    await Promise.all(
      slugs.map(async (slug) => {
        const m = marketplace.find((x) => x.name === slug);
        if (!m) throw new Error(`${slug}: not in marketplace`);
        if (m.deprecated) throw new Error(`${slug}: deprecated and can no longer be installed`);
        setInstallProgress((p) => ({ ...p, [slug]: "Starting…" }));
        const res = await appsAPI.install({
          manifestUrl: m.manifest_url,
          projectId: currentProject?.id,
        });
        installIDs[slug] = res.install_id;
      }),
    );

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const list = await appsAPI.list(currentProject?.id).catch(() => [] as AppRow[]);
      let allDone = true;
      for (const slug of slugs) {
        const row = list.find((r) => r.install_id === installIDs[slug]);
        if (!row) {
          allDone = false;
          setInstallProgress((p) => ({ ...p, [slug]: "Queued…" }));
          continue;
        }
        if (row.status === "error") {
          throw new Error(`${slug}: ${row.error_message || "install failed"}`);
        }
        if (row.status !== "running") {
          allDone = false;
          setInstallProgress((p) => ({ ...p, [slug]: row.status_message || row.status }));
        } else {
          setInstallProgress((p) => ({ ...p, [slug]: "Running ✓" }));
        }
      }
      if (allDone) {
        setInstalledApps(list);
        return list;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("App install timed out after 5 minutes. Check the Apps page.");
  };

  // Per-step validation. Surfaces inline so the operator can't blow
  // past missing fields and only discover them at the create call.
  const validateStep = (): boolean => {
    switch (step.id) {
      case "template":
        if (!state.templateID) {
          setError("Pick a template or choose Empty to start blank.");
          return false;
        }
        return true;
      case "details":
        if (!state.name.trim()) {
          setError("Give your agent a name.");
          return false;
        }
        // Directive empty is fine — server fills "Idle. Waiting…".
        // Mode + unconscious always have sensible defaults; system
        // MCPs are hardcoded (channels on, apteva off).
        return true;
      case "setup":
        if (!installedAppsLoaded) {
          setError("Installed apps could not be loaded yet. Retry or refresh before creating the agent.");
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const applyTemplate = (t: AgentTemplate) => {
    setState((s) => ({
      ...s,
      templateID: t.id,
      // Suggest the template's name but let the user override.
      name: s.name || (t.id === "empty" ? "" : t.name),
      directive: structureDirectiveDraft(t.directive, s.name || (t.id === "empty" ? "" : t.name)),
      mode: t.mode as Mode,
      unconscious: t.unconscious,
      recommendedApps: t.recommended_apps || [],
      highlights: t.highlights || [],
    }));
  };

  const create = async () => {
    if (!validateStep()) return;
    setCreating(true);
    setError(null);
    setInstallProgress({});
    try {
      // Auto-install required apps before creating the agent — the
      // wizard treats them as part of the template's contract, not a
      // user choice. Optional (required=false) apps and integrations
      // are deferred to the agent detail page so the wizard stays
      // short and predictable.
      const tpl = templates.find((t) => t.id === state.templateID);
      const appsAtCreate = tpl ? await installRequiredApps(tpl) : installedApps;
      const requiredAppSlugs = new Set(
        (tpl?.requirements || [])
          .filter((r) => r.kind === "app" && r.required && r.slug)
          .map((r) => r.slug!),
      );
      const effectiveAppInstallIDs = effectiveAgentAppInstallIDs(
        state.boundAppInstallIDs,
        appsAtCreate,
        requiredAppSlugs,
      );

      const startNow = hasProvider !== false;
      const boundAppGrants = buildAppGrantPolicies({ ...state, boundAppInstallIDs: new Set(effectiveAppInstallIDs) });
      const created = await instances.create(
        state.name.trim(),
        state.directive,
        state.mode,
        currentProject?.id,
        startNow,
        {
          proactivity: state.proactivity,
          includeChannels: state.includeChannels,
          unconscious: state.unconscious,
          boundAppInstallIDs: effectiveAppInstallIDs,
          boundConnectionIDs: Array.from(state.boundConnectionIDs),
          boundAppGrants,
        },
      );
      // P1.1 gate may have returned a created-but-stopped row with a
      // .warning field. Either way we land on the detail page; the
      // warning will surface there.
      navigate(`/agents/${created.id}`, {
        replace: true,
        state: created.warning ? { firstAgentWarning: created.warning } : undefined,
      });
    } catch (e: any) {
      setError(e?.message || "Failed to create agent");
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6" key={step.id}>
        <header className="mb-5">
          <h1 className="text-text text-2xl font-bold sm:text-3xl">Build your agent</h1>
          <p className="text-text-muted text-sm mt-1.5 sm:mt-2 sm:text-base">
            Choose a starting point, make it yours, and connect the tools it needs.
          </p>
        </header>

        <Progress current={stepIdx} steps={STEPS} />

        <div className="mt-5">
          {step.id === "template" && (
            <TemplateStep
              templates={templates}
              selectedID={state.templateID}
              onSelect={applyTemplate}
              onSkipWizard={() => navigate("/agents")}
            />
          )}
          {step.id === "details" && (
            <DetailsStep state={state} setState={setState} />
          )}
          {step.id === "setup" && (
            <SetupStep
              template={templates.find((t) => t.id === state.templateID) || null}
              installedApps={installedApps}
              marketplace={marketplace}
              connections={connections}
              state={state}
              setState={setState}
              onRefresh={refreshConnections}
              onConnected={(connection) => setConnections((previous) => [...previous.filter((c) => c.id !== connection.id), connection])}
              projectId={currentProject?.id}
            />
          )}
          {step.id === "review" && (
            <ReviewStep
              state={state}
              hasProvider={hasProvider}
              installedApps={installedApps}
              connections={connections}
              template={templates.find((t) => t.id === state.templateID) || null}
              marketplace={marketplace}
              onEdit={(i) => setStepIdx(i)}
              installProgress={creating ? installProgress : {}}
            />
          )}

          {error && (
            <div className="text-red text-sm mt-4 border-l-2 border-red pl-3">
              {error}
            </div>
          )}

        </div>
      </div>
      <div className="page-safe-bottom z-20 flex shrink-0 items-center justify-between gap-3 border-t border-border bg-bg-card px-4 py-3 sm:px-6">
        <button
          onClick={back}
          disabled={stepIdx === 0 || creating}
          className="touch-target rounded-lg px-3 text-text-muted text-sm hover:bg-bg-hover hover:text-text transition-colors disabled:opacity-30"
        >
          ← Back
        </button>
        <p className="hidden min-w-0 flex-1 truncate text-center text-xs text-text-muted sm:block" aria-live="polite">
          {step.id === "template"
            ? state.templateID ? `Selected: ${templates.find((t) => t.id === state.templateID)?.name || "template"}` : "Choose a template to continue"
            : `Step ${stepIdx + 1} of ${STEPS.length} · ${STEPS[stepIdx + 1]?.label ? `Next: ${STEPS[stepIdx + 1].label}` : "Ready to create"}`}
        </p>
        <button
          onClick={advance}
          disabled={creating || (step.id === "template" && !state.templateID)}
          className="touch-target min-w-[132px] px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50 sm:px-5"
        >
          {creating
            ? Object.keys(installProgress).length > 0
              ? "Installing apps…"
              : "Creating…"
            : isLast
              ? hasProvider === false
                ? "Create (stopped — no provider yet)"
                : "Create agent →"
              : `Continue to ${STEPS[stepIdx + 1]?.label.toLowerCase()} →`}
        </button>
      </div>
    </div>
  );
}

function Progress({ current, steps }: { current: number; steps: typeof STEPS }) {
  return (
    <>
    <div className="sm:hidden rounded-lg border border-border bg-bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-accent">Step {current + 1} of {steps.length}</div>
          <div className="mt-0.5 text-sm font-semibold text-text">{steps[current]?.label}</div>
        </div>
        <div className="text-xs text-text-muted">{Math.round(((current + 1) / steps.length) * 100)}%</div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
      </div>
    </div>
    <ol aria-label="Agent setup progress" className="hidden grid-cols-4 gap-3 text-sm sm:grid">
      {steps.map((s, i) => (
        <li key={s.id} aria-current={i === current ? "step" : undefined} className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${i === current ? "border-accent bg-accent/5" : "border-border bg-bg-card"}`}>
          <span
            className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold ${
              i < current
                ? "border-accent bg-accent text-bg"
                : i === current
                  ? "border-accent text-accent"
                  : "border-border text-text-muted"
            }`}
          >
            {i < current ? "✓" : i + 1}
          </span>
          <span className={i === current ? "text-text" : "text-text-muted"}>{s.label}</span>
        </li>
      ))}
    </ol>
    </>
  );
}

interface TemplateStepProps {
  templates: AgentTemplate[];
  selectedID: string | null;
  onSelect: (t: AgentTemplate) => void;
  onSkipWizard: () => void;
}

export function TemplateStep({ templates, selectedID, onSelect, onSkipWizard }: TemplateStepProps) {
  const [query, setQuery] = useState("");
  const selected = templates.find((template) => template.id === selectedID);
  const filtered = templates.filter((template) =>
    [template.name, template.description, ...(template.resolved_logos || []).map((logo) => logo.label)]
      .join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-text text-lg font-bold">What should your agent do?</h2>
          <p className="text-text-muted text-sm mt-1">Choose a template or start from scratch. You can customize everything next.</p>
        </div>
        <input
          type="search"
          aria-label="Search templates"
          placeholder="Search templates or apps…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:outline-none focus:border-accent sm:w-72 sm:shrink-0"
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          {templates.length === 0 ? (
            <p className="text-text-muted text-sm">Loading templates…</p>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-text-muted">No templates match “{query}”. Try an app name or a different task.</p>
              <button onClick={() => setQuery("")} className="mt-3 text-sm text-accent hover:underline">Clear search</button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,250px),1fr))] gap-3">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t)}
                  aria-pressed={selectedID === t.id}
                  className={`flex h-full flex-col gap-3 text-left border rounded-lg p-4 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
                    selectedID === t.id
                      ? "border-accent bg-accent/5"
                      : "border-border bg-bg-card hover:border-text-dim hover:bg-bg-hover"
                  }`}
                >
                  <div className="flex w-full items-start gap-2.5">
                    <TemplateIcon name={t.icon} className="mt-0.5 text-accent shrink-0" />
                    <span className="flex-1 text-sm font-semibold text-text">{t.name}</span>
                    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${selectedID === t.id ? "border-accent bg-accent text-bg" : "border-border"}`}>
                      {selectedID === t.id ? "✓" : ""}
                    </span>
                  </div>
                  <p className="text-text-muted text-xs leading-relaxed">{t.description}</p>
                  {selectedID === t.id && !!t.highlights?.length && (
                    <ul className="space-y-2 border-t border-border pt-3 xl:hidden">
                      {t.highlights.map((highlight) => (
                        <li key={highlight} className="flex gap-2 text-xs leading-relaxed text-text">
                          <span className="text-accent">✓</span><span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.source === "app" && <span className="text-xs text-text-muted">By {t.source_ref}</span>}
                  <div className="mt-auto pt-1">
                    {t.resolved_logos && t.resolved_logos.length > 0 ? (
                      <LogoRow logos={t.resolved_logos} />
                    ) : <span className="text-xs text-text-muted">Customize your tools next</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="hidden rounded-lg border border-border bg-bg-card p-5 xl:sticky xl:top-0 xl:block" aria-label="Template preview">
          {selected ? (
            <>
              <div className="text-xs font-semibold text-accent">Selected template</div>
              <h3 className="mt-2 text-lg font-bold text-text">{selected.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">{selected.description}</p>
              {!!selected.highlights?.length && (
                <>
                  <h4 className="mt-5 text-xs font-semibold text-text">What it can help with</h4>
                  <ul className="mt-3 space-y-3">
                    {selected.highlights.map((highlight) => (
                      <li key={highlight} className="flex gap-2 text-xs leading-relaxed text-text">
                        <span className="text-accent">✓</span><span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!!selected.resolved_logos?.length && (
                <>
                  <h4 className="mt-5 text-xs font-semibold text-text">Apps & integrations</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selected.resolved_logos.map((logo) => (
                      <span key={`${logo.kind}:${logo.slug}`} className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-text">
                        <LogoPill logo={logo} isApp={logo.kind === "app"} />{logo.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
              <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-text-muted">Next, give your agent a name and instructions. You’ll review connections and app access before creating it.</p>
            </>
          ) : (
            <>
              <h3 className="font-semibold text-text">Start with a task</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">Select a template to see what it does and which apps it uses.</p>
              <ol className="mt-5 space-y-4 text-xs leading-relaxed text-text-muted">
                <li><span className="font-semibold text-text">1. Make it yours</span><br />Set a name, instructions, and behavior.</li>
                <li><span className="font-semibold text-text">2. Connect your tools</span><br />Choose the apps and accounts it can use.</li>
                <li><span className="font-semibold text-text">3. Review and create</span><br />Check the setup before your agent starts.</li>
              </ol>
            </>
          )}
        </aside>
      </div>

      <div>
        <button onClick={onSkipWizard} className="text-text-muted text-xs hover:text-text underline-offset-2 hover:underline transition-colors">
          Advanced: use the classic form →
        </button>
      </div>
    </div>
  );
}

interface DetailsStepProps {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

// DetailsStep — single merged step covering everything the operator
// authors about the agent itself: name, directive, behavior mode,
// background memory. Was two steps (Details + Behavior) until the
// Behavior step thinned out enough that combining was cleaner than
// keeping a tab with two controls.
function DetailsStep({ state, setState }: DetailsStepProps) {
  const modes: { id: Mode; label: string; description: string }[] = [
    {
      id: "learn",
      label: "Learn",
      description: behaviorDescriptions.learn + " " + behaviorExplanation,
    },
    {
      id: "cautious",
      label: "Cautious",
      description: behaviorDescriptions.cautious + " " + behaviorExplanation,
    },
    {
      id: "autonomous",
      label: "Autonomous",
      description: behaviorDescriptions.autonomous + " " + behaviorExplanation,
    },
  ];
  const selectedMode = modes.find((m) => m.id === state.mode) || modes[0]!;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-text text-lg font-bold">Details</h2>
        <p className="text-text-muted text-xs mt-1">
          Give your agent clear instructions and choose how independently it can act.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="min-w-0 space-y-5 rounded-lg border border-border bg-bg-card p-5">
      <div>
        <label htmlFor="agent-name" className="block text-text-muted text-xs mb-1.5">Name</label>
        <input
          id="agent-name"
          type="text"
          value={state.name}
          onChange={(e) =>
            setState((s) => ({ ...s, name: (e.target as HTMLInputElement).value }))
          }
          className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Support ticket triage"
          autoComplete="off"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="agent-directive" className="block text-text-muted text-xs">Instructions</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  directive: structureDirectiveDraft(s.directive, s.name),
                }))
              }
              className="text-accent text-xs hover:underline"
            >
              Structure
            </button>
          </div>
        </div>
        <textarea
          id="agent-directive"
          value={state.directive}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              directive: (e.target as HTMLTextAreaElement).value,
            }))
          }
          rows={16}
          className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono leading-relaxed focus:outline-none focus:border-accent resize-y"
          placeholder={"# Role\nYou are...\n\n# Goals\n- ..."}
          spellCheck={false}
        />
        <p className="text-text-muted text-xs mt-1.5">
          Describe its role, goals, and any rules it should follow. Use headings to organize longer instructions.
        </p>
      </div>

      </section>
      <div className="min-w-0 space-y-5">
      <section className="min-w-0 space-y-5 rounded-lg border border-border bg-bg-card p-5">
      <div>
        <label className="block text-text-muted text-xs mb-1.5">Safety mode</label>
        {/* Segmented control — three tabs in one row. Selected
            mode's description renders below so the trade-off info
            stays visible without three radio cards. */}
        <div className="flex border border-border rounded-lg overflow-hidden">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setState((s) => ({ ...s, mode: m.id }))}
              className={`flex-1 px-3 py-2 text-sm transition-colors ${
                state.mode === m.id
                  ? "bg-accent text-bg font-medium"
                  : "text-text-muted hover:text-text hover:bg-bg-card"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-text-muted text-xs mt-1.5 leading-relaxed">
          {selectedMode.description}
        </p>
      </div>

      <ProactivityControl value={state.proactivity} onChange={(proactivity) => setState((s) => ({ ...s, proactivity }))} />
      </section>

      <section aria-labelledby="agent-memory-label" className="rounded-lg border border-border bg-bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <h3 id="agent-memory-label" className="text-sm font-semibold text-text">Activate memory</h3>
          <button
            type="button"
            role="switch"
            aria-checked={state.unconscious}
            aria-labelledby="agent-memory-label"
            aria-describedby="agent-memory-description"
            onClick={() => setState((s) => ({ ...s, unconscious: !s.unconscious }))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <span aria-hidden="true" className={`relative h-6 w-11 rounded-full transition-colors ${state.unconscious ? "bg-accent" : "bg-border"}`}>
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${state.unconscious ? "translate-x-5" : "translate-x-0"}`} />
            </span>
          </button>
        </div>
        <p id="agent-memory-description" className="mt-2 text-xs leading-relaxed text-text-muted">
          Enable the agent’s memory system to learn from its activity, retain useful knowledge, and draw on past context in future work.
        </p>
      </section>
      </div>
      </div>
    </div>
  );
}

interface SetupStepProps {
  template: AgentTemplate | null;
  installedApps: AppRow[];
  marketplace: MarketplaceEntry[];
  connections: ConnectionInfo[];
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onRefresh: () => Promise<void>;
  onConnected: (connection: ConnectionInfo) => void;
  /** Scope for any newly-minted connection from the inline
   *  ConnectIntegrationModal — matches the agent's own scope. */
  projectId?: string;
}

const ESSENTIAL_APPS: Record<string, string> = {
  conversations: "Give your agent a place to talk with you.",
  tasks: "Let your agent track and complete tasks.",
  storage: "Keep files and results in one place.",
};

export function SetupStep({
  template,
  installedApps,
  marketplace,
  connections,
  state,
  setState,
  onRefresh,
  onConnected,
  projectId,
}: SetupStepProps) {
  const [picker, setPicker] = useState<"apps" | "integrations" | null>(null);
  const [query, setQuery] = useState("");
  const [integrationTab, setIntegrationTab] = useState<"connected" | "catalog">(
    "connected",
  );
  const [pickerSlugs, setPickerSlugs] = useState<string[] | null>(null);
  const [catalog, setCatalog] = useState<AppSummary[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [connectSlug, setConnectSlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [permissionCatalogs, setPermissionCatalogs] = useState<
    Record<number, AppPermissionCatalog | null>
  >({});
  const requestedPermissions = useRef(new Set<number>());

  const requirements = template?.requirements || [];
  const requiredApps = requirements.filter(
    (r) => r.kind === "app" && r.required && r.slug,
  );
  const integrationRequirements = requirements.filter(
    (r) => r.kind === "integration",
  );
  const requiredSlugs = new Set(requiredApps.map((r) => r.slug!));
  const effectiveIDs = effectiveAgentAppInstallIDs(
    state.boundAppInstallIDs,
    installedApps,
    requiredSlugs,
  );
  const selectedIDs = new Set(effectiveIDs);
  const selectedApps = installedApps.filter((app) =>
    selectedIDs.has(app.install_id),
  );
  const selectedConnections = connections.filter((connection) =>
    state.boundConnectionIDs.has(connection.id),
  );
  const missingApps = requiredApps.filter(
    (r) => !selectedApps.some((app) => app.name === r.slug),
  );
  const unmetIntegrations = integrationRequirements.filter(
    (r) =>
      !selectedConnections.some(
        (c) =>
          c.status === "active" && requirementSlugs(r).includes(c.app_slug),
      ),
  );
  const availableApps = installedApps.filter(
    (app) =>
      app.status === "running" ||
      app.status === "pending" ||
      selectedIDs.has(app.install_id),
  );
  const essentials = Object.keys(ESSENTIAL_APPS).flatMap((name) => {
    if (selectedApps.some((app) => app.name === name)) return [];
    const candidates = availableApps.filter(
      (app) => app.name === name && app.status === "running",
    );
    const best =
      candidates.find((app) => !!projectId && app.project_id === projectId) ||
      candidates[0];
    return best ? [best] : [];
  });
  const matches = (...values: (string | undefined)[]) =>
    values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const filteredApps = availableApps
    .filter((app) => matches(app.display_name, app.name, app.description))
    .sort(
      (a, b) =>
        Number(!!ESSENTIAL_APPS[b.name]) - Number(!!ESSENTIAL_APPS[a.name]) ||
        a.display_name.localeCompare(b.display_name),
    );
  const filteredConnections = connections.filter(
    (c) =>
      (!pickerSlugs || pickerSlugs.includes(c.app_slug)) &&
      matches(c.app_name, c.app_slug, c.name),
  );
  const filteredCatalog = (catalog || []).filter(
    (app) =>
      (!pickerSlugs || pickerSlugs.includes(app.slug)) &&
      matches(app.name, app.slug, app.description),
  );

  useEffect(() => {
    for (const id of effectiveIDs) {
      if (requestedPermissions.current.has(id)) continue;
      requestedPermissions.current.add(id);
      appsAPI
        .permissions(id)
        .then((result) =>
          setPermissionCatalogs((previous) => ({ ...previous, [id]: result })),
        )
        .catch(() =>
          setPermissionCatalogs((previous) => ({ ...previous, [id]: null })),
        );
    }
  }, [effectiveIDs.join(",")]);

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError("");
    try {
      await onRefresh();
    } catch {
      setRefreshError("Couldn’t refresh apps and connections. Try again.");
    } finally {
      setRefreshing(false);
    }
  };
  const loadCatalog = () => {
    if (catalog !== null || catalogLoading) return;
    setCatalogLoading(true);
    setCatalogError("");
    integrationsAPI
      .catalog()
      .then(setCatalog)
      .catch(() => setCatalogError("Couldn’t load the integration catalog."))
      .finally(() => setCatalogLoading(false));
  };
  const openPicker = (
    kind: "apps" | "integrations",
    slugs: string[] | null = null,
  ) => {
    setQuery("");
    setPickerSlugs(slugs);
    setPicker(kind);
    const hasAccount =
      !slugs || connections.some((c) => slugs.includes(c.app_slug));
    setIntegrationTab(hasAccount ? "connected" : "catalog");
    if (kind === "integrations" && !hasAccount) loadCatalog();
  };
  const toggleConnection = (id: number) =>
    setState((current) => {
      const next = new Set(current.boundConnectionIDs);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...current, boundConnectionIDs: next };
    });
  const toggleApp = (id: number) => {
    if (
      installedApps.some(
        (app) => app.install_id === id && requiredSlugs.has(app.name),
      )
    )
      return;
    setState((current) => {
      const next = new Set(current.boundAppInstallIDs);
      const appAccess = { ...current.appAccess };
      if (next.has(id)) {
        next.delete(id);
        delete appAccess[id];
      } else {
        next.add(id);
        appAccess[id] = appAccess[id] || defaultAppAccessDraft();
      }
      return { ...current, boundAppInstallIDs: next, appAccess };
    });
  };
  const updateAppAccess = (id: number, patch: Partial<AppAccessDraft>) =>
    setState((current) => ({
      ...current,
      appAccess: {
        ...current.appAccess,
        [id]: {
          ...(current.appAccess[id] || defaultAppAccessDraft()),
          ...patch,
        },
      },
    }));
  const connect = (slug: string) => {
    setPicker(null);
    setConnectSlug(slug);
  };
  const buttonClass =
    "touch-target shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text hover:border-accent hover:text-accent transition-colors";
  const badgeClass =
    "rounded bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent";
  const gridClass = "grid gap-3 sm:grid-cols-2 2xl:grid-cols-3";
  const connectionIcon = (c: ConnectionInfo) => (
    <AppIcon
      src={
        c.logo ||
        template?.resolved_logos?.find((logo) => logo.slug === c.app_slug)
          ?.icon_url
      }
      name={c.app_name || c.app_slug}
      size="md"
      framed={false}
      className="rounded-md bg-white text-gray-800"
    />
  );

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text">
            Choose apps and integrations
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Start with the template’s tools, then add what your agent needs.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className={buttonClass}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {refreshError && (
        <p role="alert" className="text-sm text-red">
          {refreshError}
        </p>
      )}

      <section aria-labelledby="setup-apps-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3
              id="setup-apps-heading"
              className="text-base font-semibold text-text"
            >
              Apps{" "}
              <span className="ml-2 text-xs font-normal text-text-muted">
                {selectedApps.length + missingApps.length} selected
              </span>
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              Give your agent the tools and skills to get work done.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openPicker("apps")}
            className={buttonClass}
          >
            + Add apps
          </button>
        </div>
        <div className={gridClass}>
          {selectedApps.map((app) => {
            const required = requiredSlugs.has(app.name);
            const permissionCatalog = permissionCatalogs[app.install_id];
            const scoped =
              !!permissionCatalog?.permissions?.length &&
              !!permissionCatalog?.resources?.length;
            return (
              <article
                key={app.install_id}
                className="min-w-0 rounded-lg border border-border bg-bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <AppIcon
                    src={app.icon}
                    iconStyle={app.icon_style}
                    name={app.display_name || app.name}
                    size="md"
                    className="text-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-text">
                      {app.display_name || app.name}
                    </h4>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {app.project_id ? "Project app" : "Global app"} ·{" "}
                      {app.surfaces?.mcp_tool_count || 0} tools
                    </p>
                  </div>
                  {!required && (
                    <button
                      type="button"
                      aria-label={`Remove ${app.display_name || app.name}`}
                      onClick={() => toggleApp(app.install_id)}
                      className="rounded p-1 text-text-muted hover:text-red"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-text-muted">
                  {ESSENTIAL_APPS[app.name] || app.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {required && (
                    <span className={badgeClass}>Required by template</span>
                  )}
                  {ESSENTIAL_APPS[app.name] && (
                    <span className={badgeClass}>Essential</span>
                  )}
                  {app.default_for_new_agents && !required && (
                    <span className="text-[10px] text-text-muted">
                      Default app
                    </span>
                  )}
                  {app.status !== "running" && (
                    <span className="text-[10px] text-amber">
                      {app.status === "pending"
                        ? "Starting…"
                        : `Unavailable · ${app.status}`}
                    </span>
                  )}
                </div>
                {scoped && (
                  <details className="mt-3 border-t border-border pt-3">
                    <summary className="cursor-pointer text-xs text-accent">
                      App access ·{" "}
                      {state.appAccess[app.install_id]?.mode === "limited"
                        ? "Limited"
                        : "Full"}
                    </summary>
                    <ul className="mt-3">
                      <ScopedAppAccess
                        app={app}
                        catalog={permissionCatalog}
                        draft={
                          state.appAccess[app.install_id] ||
                          defaultAppAccessDraft()
                        }
                        onChange={(patch) =>
                          updateAppAccess(app.install_id, patch)
                        }
                      />
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
          {missingApps.map((requirement) => {
            const entry = marketplace.find(
              (app) => app.name === requirement.slug,
            );
            const existing = installedApps.find(
              (app) => app.name === requirement.slug,
            );
            const canInstall = !existing && !!entry && !entry.deprecated;
            return (
              <article
                key={requirement.slug}
                className="rounded-lg border border-dashed border-border bg-bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <AppIcon
                    src={existing?.icon || entry?.icon}
                    iconStyle={existing?.icon_style || entry?.icon_style}
                    name={entry?.display_name || requirement.slug!}
                    size="md"
                    className="text-accent"
                  />
                  <h4 className="text-sm font-semibold text-text">
                    {existing?.display_name ||
                      entry?.display_name ||
                      requirement.slug}
                  </h4>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  {requirement.reason ||
                    "This app is required by the selected template."}
                </p>
                <p
                  className={`mt-3 text-xs ${canInstall ? "text-accent" : "text-amber"}`}
                >
                  {canInstall
                    ? "Will install when you create the agent"
                    : existing?.status === "pending"
                      ? "Starting — refresh when ready"
                      : "Unavailable — check this app before creating"}
                </p>
                {!canInstall && (
                  <a
                    href="/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs text-accent hover:underline"
                  >
                    Manage app →
                  </a>
                )}
              </article>
            );
          })}
        </div>
        {selectedApps.length + missingApps.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-5 text-sm text-text-muted">
            No apps selected yet. Add the tools this agent should use.
          </p>
        )}
        {essentials.length > 0 && (
          <div className="rounded-lg border border-border p-4">
            <h4 className="text-xs font-semibold text-text">
              Useful essentials{" "}
              <span className="ml-2 font-normal text-text-muted">
                Already installed
              </span>
            </h4>
            <div className="mt-3 flex flex-wrap gap-3">
              {essentials.map((app) => (
                <button
                  type="button"
                  key={app.install_id}
                  onClick={() => toggleApp(app.install_id)}
                  className="flex items-center gap-3 rounded-lg bg-bg-card px-3 py-2 text-left hover:bg-bg-hover"
                  aria-label={`Add ${app.display_name || app.name}`}
                >
                  <AppIcon
                    src={app.icon}
                    iconStyle={app.icon_style}
                    name={app.display_name || app.name}
                    size="sm"
                    className="text-accent"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-text">
                      {app.display_name || app.name}
                    </span>
                    <span className="block text-[11px] text-text-muted">
                      {app.project_id ? "Project" : "Global"} ·{" "}
                      {ESSENTIAL_APPS[app.name]}
                    </span>
                  </span>
                  <span className="text-accent">+</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section
        aria-labelledby="setup-integrations-heading"
        className="space-y-4 border-t border-border pt-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3
              id="setup-integrations-heading"
              className="text-base font-semibold text-text"
            >
              Integrations{" "}
              <span className="ml-2 text-xs font-normal text-text-muted">
                {selectedConnections.length} selected
              </span>
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              Choose the accounts your agent can use.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openPicker("integrations")}
            className={buttonClass}
          >
            + Add integrations
          </button>
        </div>
        <div className={gridClass}>
          {selectedConnections.map((connection) => (
            <article
              key={connection.id}
              className="rounded-lg border border-border bg-bg-card p-4"
            >
              <div className="flex items-start gap-3">
                {connectionIcon(connection)}
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-text">
                    {connection.app_name || connection.app_slug}
                  </h4>
                  <p className="mt-1 break-words text-xs text-text-muted">
                    {connection.name} ·{" "}
                    {connection.project_id ? "Project" : "Global"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${connection.name}`}
                  onClick={() => toggleConnection(connection.id)}
                  className="rounded p-1 text-text-muted hover:text-red"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`text-xs ${connection.status === "active" ? "text-green" : "text-amber"}`}
                >
                  {connection.status === "active"
                    ? "Connected"
                    : "Needs attention"}
                </span>
                {integrationRequirements.some((r) =>
                  requirementSlugs(r).includes(connection.app_slug),
                ) && <span className={badgeClass}>From template</span>}
              </div>
            </article>
          ))}
          {unmetIntegrations.map((requirement, index) => {
            const slugs = requirementSlugs(requirement);
            const logo = template?.resolved_logos?.find((item) =>
              slugs.includes(item.slug),
            );
            const names = slugs
              .map(
                (slug) =>
                  connections.find((c) => c.app_slug === slug)?.app_name ||
                  template?.resolved_logos?.find((item) => item.slug === slug)
                    ?.label ||
                  slug,
              )
              .join(" / ");
            return (
              <article
                key={`${slugs.join(":")}:${index}`}
                className="rounded-lg border border-dashed border-border bg-bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <AppIcon
                    src={logo?.icon_url}
                    name={names || "Integration"}
                    size="md"
                    framed={false}
                    className="rounded-md bg-white text-gray-800"
                  />
                  <h4 className="text-sm font-semibold text-text">
                    {names || requirement.role || "Integration"}
                  </h4>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  {requirement.reason ||
                    "Choose a compatible account for this template."}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span
                    className={`text-xs ${requirement.required ? "text-amber" : "text-text-muted"}`}
                  >
                    {requirement.required
                      ? "Needed for template"
                      : "Optional for template"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      openPicker("integrations", slugs.length ? slugs : null)
                    }
                    className="text-xs font-semibold text-accent"
                  >
                    Choose account →
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {selectedConnections.length + unmetIntegrations.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-5 text-sm text-text-muted">
            No integrations selected. Add an account when your agent needs an
            external service.
          </p>
        )}
        {unmetIntegrations.some((r) => r.required) && (
          <p className="text-xs text-amber">
            Template integrations still need an account. Your agent won’t be
            able to use them until connected and selected.
          </p>
        )}
      </section>

      <Modal
        open={picker !== null}
        onClose={() => setPicker(null)}
        width="max-w-3xl"
        ariaLabel={picker === "apps" ? "Choose apps" : "Choose integrations"}
      >
        <div className="space-y-4 border-b border-border p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-text">
              {picker === "apps" ? "Choose apps" : "Choose integrations"}
            </h3>
            <button
              type="button"
              onClick={() => setPicker(null)}
              aria-label="Close picker"
              className="rounded p-1 text-text-muted hover:text-text"
            >
              ✕
            </button>
          </div>
          <input
            type="search"
            aria-label={
              picker === "apps"
                ? "Search installed apps"
                : "Search integrations"
            }
            placeholder={
              picker === "apps"
                ? "Search installed apps…"
                : "Search integrations or accounts…"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
          />
          {picker === "integrations" && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIntegrationTab("connected")}
                aria-pressed={integrationTab === "connected"}
                className={`rounded-md px-3 py-1.5 text-xs ${integrationTab === "connected" ? "bg-accent text-bg" : "text-text-muted hover:bg-bg-hover"}`}
              >
                Your connections
              </button>
              <button
                type="button"
                onClick={() => {
                  setIntegrationTab("catalog");
                  loadCatalog();
                }}
                aria-pressed={integrationTab === "catalog"}
                className={`rounded-md px-3 py-1.5 text-xs ${integrationTab === "catalog" ? "bg-accent text-bg" : "text-text-muted hover:bg-bg-hover"}`}
              >
                Connect new
              </button>
              {pickerSlugs && (
                <button
                  type="button"
                  className="ml-auto text-xs text-accent"
                  onClick={() => setPickerSlugs(null)}
                >
                  Show all integrations
                </button>
              )}
            </div>
          )}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-3"
          style={{ maxHeight: "min(55vh, 520px)" }}
        >
          {picker === "apps" ? (
            <div className="space-y-1">
              {filteredApps.map((app) => (
                <PickerOption
                  key={app.install_id}
                  selected={selectedIDs.has(app.install_id)}
                  disabled={requiredSlugs.has(app.name)}
                  onToggle={() => toggleApp(app.install_id)}
                  name={app.display_name || app.name}
                  description={`${app.project_id ? "Project" : "Global"} · v${app.version}${ESSENTIAL_APPS[app.name] ? ` · ${ESSENTIAL_APPS[app.name]}` : app.description ? ` · ${app.description}` : ""}`}
                  badge={
                    requiredSlugs.has(app.name)
                      ? "Required by template"
                      : ESSENTIAL_APPS[app.name]
                        ? "Essential"
                        : undefined
                  }
                  icon={
                    <AppIcon
                      src={app.icon}
                      iconStyle={app.icon_style}
                      name={app.display_name || app.name}
                      size="md"
                      className="text-accent"
                    />
                  }
                />
              ))}
              {filteredApps.length === 0 && (
                <p className="p-5 text-sm text-text-muted">
                  {query
                    ? "No installed apps match your search."
                    : "No available apps installed yet."}
                </p>
              )}
            </div>
          ) : integrationTab === "connected" ? (
            <div className="space-y-1">
              {filteredConnections.map((connection) => (
                <PickerOption
                  key={connection.id}
                  selected={state.boundConnectionIDs.has(connection.id)}
                  disabled={
                    connection.status !== "active" &&
                    !state.boundConnectionIDs.has(connection.id)
                  }
                  onToggle={() => toggleConnection(connection.id)}
                  name={connection.app_name || connection.app_slug}
                  description={`${connection.name} · ${connection.project_id ? "Project" : "Global"}`}
                  badge={
                    connection.status === "active"
                      ? undefined
                      : "Needs attention"
                  }
                  icon={connectionIcon(connection)}
                />
              ))}
              {filteredConnections.length === 0 && (
                <div className="space-y-3 p-5 text-sm text-text-muted">
                  <p>
                    No connections match. Connect a new account or change your
                    search.
                  </p>
                  <button
                    type="button"
                    className="text-accent"
                    onClick={() => {
                      setIntegrationTab("catalog");
                      loadCatalog();
                    }}
                  >
                    Connect a new account →
                  </button>
                </div>
              )}
            </div>
          ) : catalogLoading ? (
            <p className="p-5 text-sm text-text-muted">Loading integrations…</p>
          ) : catalogError ? (
            <div role="alert" className="p-5 text-sm text-red">
              {catalogError}{" "}
              <button
                type="button"
                onClick={loadCatalog}
                className="text-accent"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCatalog.map((app) => (
                <div
                  key={app.slug}
                  className="flex items-center gap-3 rounded-lg p-3 hover:bg-bg-hover"
                >
                  <AppIcon
                    src={app.logo || undefined}
                    name={app.name}
                    size="md"
                    framed={false}
                    className="rounded-md bg-white text-gray-800"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text">
                      {app.name}
                    </div>
                    <p className="line-clamp-2 text-xs text-text-muted">
                      {app.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => connect(app.slug)}
                    className={buttonClass}
                  >
                    Connect
                  </button>
                </div>
              ))}
              {filteredCatalog.length === 0 && (
                <p className="p-5 text-sm text-text-muted">
                  No integrations match your search.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
            <span>
              {picker === "apps"
                ? selectedApps.length
                : selectedConnections.length}{" "}
              selected
            </span>
            {picker === "apps" && (
              <a
                href="/apps"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Install more apps ↗
              </a>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="text-accent"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            {refreshError && (
              <span role="alert" className="text-red">
                {refreshError}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPicker(null)}
            className="touch-target rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-bg hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      </Modal>
      {connectSlug && (
        <ConnectIntegrationModal
          open
          slug={connectSlug}
          projectId={projectId}
          onCancel={() => setConnectSlug(null)}
          onConnected={(connection) => {
            setConnectSlug(null);
            onConnected(connection);
            setState((current) => ({
              ...current,
              boundConnectionIDs: new Set([
                ...current.boundConnectionIDs,
                connection.id,
              ]),
            }));
          }}
        />
      )}
    </div>
  );
}


function ScopedAppAccess({
  app,
  catalog,
  draft,
  onChange,
}: {
  app: AppRow;
  catalog: AppPermissionCatalog;
  draft: AppAccessDraft;
  onChange: (patch: Partial<AppAccessDraft>) => void;
}) {
  const folderResource = catalog.resources.find((r) => r.name === "folder") || catalog.resources[0];
  const canRead = catalog.permissions.some((p) => p.name === "media.read");
  const canWrite = catalog.permissions.some((p) => p.name === "media.write");
  const canDelete = catalog.permissions.some((p) => p.name === "media.delete");

  return (
    <li className="bg-bg-card border-t border-border px-4 py-3 text-xs">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-text font-medium">{app.display_name || app.name} access</div>
            <div className="text-text-muted mt-0.5">
              Scope this app by {folderResource?.label?.toLowerCase() || "resource"} for this agent.
            </div>
          </div>
          <div className="inline-flex rounded border border-border overflow-hidden">
            {(["full", "limited"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ mode })}
                className={`px-2.5 py-1 text-[11px] capitalize ${
                  draft.mode === mode
                    ? "bg-accent text-bg font-bold"
                    : "bg-bg text-text-muted hover:text-text"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {draft.mode === "limited" && (
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="text-text-muted">Allowed folders</span>
              <textarea
                value={draft.folders}
                onChange={(e) => onChange({ folders: (e.target as HTMLTextAreaElement).value })}
                placeholder="/clients/acme/&#10;/renders/acme/"
                className="mt-1 w-full min-h-[70px] bg-bg-input border border-border rounded px-2.5 py-2 text-text font-mono text-xs focus:outline-none focus:border-accent"
              />
              <span className="block text-text-dim mt-1">
                One folder per line. Grants apply recursively.
              </span>
            </label>
            <div className="flex md:flex-col gap-2 md:min-w-[160px]">
              {canRead && (
                <label className="flex items-center gap-2 text-text-muted">
                  <input
                    type="checkbox"
                    checked={draft.read}
                    onChange={(e) => onChange({ read: (e.target as HTMLInputElement).checked })}
                  />
                  Read
                </label>
              )}
              {canWrite && (
                <label className="flex items-center gap-2 text-text-muted">
                  <input
                    type="checkbox"
                    checked={draft.write}
                    onChange={(e) => onChange({ write: (e.target as HTMLInputElement).checked })}
                  />
                  Write
                </label>
              )}
              {canDelete && (
                <label className="flex items-center gap-2 text-text-muted">
                  <input
                    type="checkbox"
                    checked={draft.delete}
                    onChange={(e) => onChange({ delete: (e.target as HTMLInputElement).checked })}
                  />
                  Delete
                </label>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

interface ReviewStepProps {
  installedApps: AppRow[];
  connections: ConnectionInfo[];
  template: AgentTemplate | null;
  marketplace: MarketplaceEntry[];
  state: WizardState;
  hasProvider: boolean | null;
  onEdit: (stepIdx: number) => void;
  // Per-app live status while the Create button is auto-installing
  // required apps. Empty until create() kicks off; one entry per
  // app slug while the cascade runs.
  installProgress: Record<string, string>;
}

function ReviewStep({ state, hasProvider, onEdit, installProgress, installedApps, connections, template, marketplace }: ReviewStepProps) {
  const requiredSlugs = (template?.requirements || []).filter((r) => r.kind === "app" && r.required && r.slug).map((r) => r.slug!);
  const appIDs = new Set(effectiveAgentAppInstallIDs(state.boundAppInstallIDs, installedApps, requiredSlugs));
  const selectedApps = installedApps.filter((app) => appIDs.has(app.install_id));
  const appNames = selectedApps.map((app) => app.display_name || app.name);
  for (const slug of requiredSlugs) {
    if (!selectedApps.some((app) => app.name === slug)) appNames.push(`${marketplace.find((app) => app.name === slug)?.display_name || slug} (template requirement)`);
  }
  const connectionNames = connections.filter((c) => state.boundConnectionIDs.has(c.id)).map((c) => `${c.app_name || c.app_slug} — ${c.name}`);
  const directivePreview = useMemo(() => {
    const d = state.directive.trim();
    if (!d) return "(blank — server will fill in a placeholder)";
    if (d.length <= 220) return d;
    return d.slice(0, 220) + "…";
  }, [state.directive]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">Review + create</h2>
        <p className="text-text-muted text-sm mt-1">
          Last check. Everything below can be edited later from the agent's detail page.
        </p>
      </div>

      {hasProvider === false && (
        <div className="border border-amber rounded-lg bg-amber/5 px-4 py-3 text-amber text-sm">
          <div className="font-medium">No LLM provider configured yet.</div>
          <div className="text-xs mt-1">
            We'll create the agent in stopped state. Add a provider in Settings → Providers, then come back and hit Start on the agent's detail page.
          </div>
        </div>
      )}

      <dl className="border border-border rounded-lg divide-y divide-border">
        <Row label="Name"        value={state.name}                       onEdit={() => onEdit(1)} />
        {state.highlights.length > 0 && (
          <Row label="What it can do" value={`• ${state.highlights.join("\n• ")}`} multiline onEdit={() => onEdit(0)} />
        )}
        <Row label="Directive"   value={directivePreview} multiline       onEdit={() => onEdit(1)} />
        <Row label="Mode"        value={state.mode}                       onEdit={() => onEdit(1)} />
        <Row label="Proactivity" value={`${state.proactivity}% — ${proactivityLabel(state.proactivity)}`} onEdit={() => onEdit(1)} />
        <Row label="Memory" value={state.unconscious ? "Active" : "Inactive"} onEdit={() => onEdit(1)} />
        <Row label="Apps" value={appNames.join(", ") || "None selected"} onEdit={() => onEdit(2)} />
        <Row label="Integrations" value={connectionNames.join(", ") || "None selected"} onEdit={() => onEdit(2)} />
      </dl>

      {Object.keys(installProgress).length > 0 && (
        <div className="border border-border rounded-lg bg-bg-card p-4">
          <div className="text-text-muted text-xs uppercase tracking-wide mb-2">
            Installing required apps
          </div>
          <ul className="text-text text-sm flex flex-col gap-1">
            {Object.entries(installProgress).map(([slug, status]) => (
              <li key={slug} className="flex items-center gap-2">
                <span className="text-text font-mono text-xs w-32 shrink-0">{slug}</span>
                <span
                  className={
                    status.includes("✓") ? "text-green text-xs" : "text-text-muted text-xs"
                  }
                >
                  {status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  multiline,
  hint,
  onEdit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  hint?: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="flex-1 min-w-0">
        <dt className="text-text-muted text-xs uppercase tracking-wide">{label}</dt>
        <dd className={`text-text text-sm mt-1 ${multiline ? "whitespace-pre-wrap font-mono leading-relaxed" : ""}`}>
          {value || <span className="text-text-muted italic">(empty)</span>}
        </dd>
        {hint && <p className="text-text-muted text-xs mt-1">{hint}</p>}
      </div>
      <button
        onClick={onEdit}
        className="text-text-muted text-xs hover:text-accent transition-colors shrink-0"
      >
        Edit
      </button>
    </div>
  );
}

// TemplateIcon — dispatcher from short icon name (returned by the
// server) to a stroked SVG. We deliberately don't pull lucide-react
// in for six icons; inline keeps the bundle smaller and matches the
// rest of the codebase's hand-rolled icon convention (GlobeIcon,
// BellIcon, etc.). Unknown names fall back to a neutral box glyph
// so a future template shipped with an icon name we don't recognise
// still renders without crashing.
function TemplateIcon({
  name,
  size = 18,
  className,
}: {
  name?: string;
  size?: number;
  className?: string;
}) {
  const path = TEMPLATE_ICON_PATHS[name ?? ""] ?? TEMPLATE_ICON_PATHS["box"]!;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {path}
    </svg>
  );
}

// LogoRow — renders the server-resolved logos for a template card.
// Each entry is either a remote logo URL (integrations catalog, app
// marketplace) or — when the catalog has no logo for the slug — a
// short text pill with the slug initials. The row caps at 6 icons
// and shows "+N" overflow.
function LogoRow({
  logos,
  className,
}: {
  logos: import("../api").TemplateLogo[];
  className?: string;
}) {
  if (!logos.length) return null;
  // Apps (local Apteva apps) lead. Integrations come after a thin
  // divider so the card visually communicates "self-contained" vs
  // "calls out to a SaaS". The divider drops out when one group
  // is empty so single-flavor templates don't look weird.
  const apps = logos.filter((l) => l.kind === "app");
  const others = logos.filter((l) => l.kind !== "app");
  const ordered = [...apps, ...others];
  const visible = ordered.slice(0, 6);
  const overflow = ordered.length - visible.length;
  const showDivider = apps.length > 0 && others.length > 0;
  let dividerInserted = false;
  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      {visible.map((l) => {
        const isApp = l.kind === "app";
        // Insert a divider once at the boundary between apps and others.
        const needsDivider = showDivider && !isApp && !dividerInserted;
        if (needsDivider) dividerInserted = true;
        return (
          <React.Fragment key={`${l.kind}:${l.slug}`}>
            {needsDivider && <span className="w-px h-3 bg-border mx-0.5" aria-hidden="true" />}
            <LogoPill logo={l} isApp={isApp} />
          </React.Fragment>
        );
      })}
      {overflow > 0 && (
        <span className="text-[10px] text-text-muted ml-0.5">+{overflow}</span>
      )}
    </div>
  );
}

// Use the same icon renderer as the Apps page: monochrome SVGs inherit
// the theme color, image logos retain their colors, and failed URLs get initials.
function LogoPill({ logo, isApp }: { logo: import("../api").TemplateLogo; isApp: boolean }) {
  return (
    <span title={`${logo.label}${logo.source === "derived" ? ` (via ${logo.via})` : ""}`}>
      <AppIcon
        src={logo.icon_url}
        iconStyle={logo.icon_style}
        name={logo.label || logo.slug}
        size="sm"
        framed={isApp}
        decorative={false}
        className={isApp ? "text-accent" : "rounded-md bg-white text-gray-800"}
      />
    </span>
  );
}
// Curated icon set — drop-in lucide-style paths for the builtin
// templates plus a generic fallback. Adding a new icon name means
// adding an entry here AND using that name in the seed (or in a
// template's manifest entry). Names are stable lucide identifiers.
const TEMPLATE_ICON_PATHS: Record<string, React.ReactNode> = {
  // user — Personal assistant
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // search — Research bot
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  // code — Code helper
  code: (
    <>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </>
  ),
  // pen — Content creator
  pen: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  // mail — Outbound sales
  mail: (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  // box — Empty (fallback)
  box: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  // message — Slack bot
  message: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>
  ),
  // github — GitHub helper
  github: (
    <>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </>
  ),
  // target — Sales prospecting
  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  // life-buoy — Customer support
  "life-buoy": (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.93 4.93 4.24 4.24" />
      <path d="m14.83 9.17 4.24-4.24" />
      <path d="m14.83 14.83 4.24 4.24" />
      <path d="m9.17 14.83-4.24 4.24" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  // calendar — Meeting coordinator
  calendar: (
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
  // git-branch — DevOps bot
  "git-branch": (
    <>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  // activity — Site monitoring
  activity: (
    <>
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96 0L9.24 2.18a.5.5 0 0 0-.96 0l-2.35 8.36A2 2 0 0 1 4 12H2" />
    </>
  ),
  // share-2 — Content distribution
  "share-2": (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </>
  ),
  // check-square — Todo coach
  "check-square": (
    <>
      <path d="m9 12 2 2 4-4" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </>
  ),
  // heart-pulse — Health logger
  "heart-pulse": (
    <>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </>
  ),
  // users — CRM assistant
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  // image — Image studio
  image: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  // megaphone — Social poster
  megaphone: (
    <>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
};
