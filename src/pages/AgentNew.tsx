import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  agentTemplates,
  apps as appsAPI,
  evals as evalsAPI,
  instances,
  integrations as integrationsAPI,
  providers,
  synthesizeDirective,
  type AgentTemplate,
  type AppRow,
  type AppGrantPolicy,
  type AppPermissionCatalog,
  type AppSummary,
  type ConnectionInfo,
  type EvalMock,
  type EvalRun,
  type EvalStreamHandle,
  type DirectiveEditSuggestion,
  type IterationEvent,
  type RunOptions,
  type MarketplaceEntry,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import { ConnectIntegrationModal } from "../components/integrations/ConnectIntegrationModal";

// AgentNew — guided "build your first agent" wizard. Four steps:
//
//   1. Pick a starting template (or "Empty" to start blank).
//   2. Name + directive (prefilled from template, editable).
//   3. Behavior — safety mode, unconscious thread, system MCPs.
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

type StepId = "template" | "details" | "setup" | "verify" | "review";

const STEPS: { id: StepId; label: string }[] = [
  { id: "template", label: "Template" },
  // Details combines name, directive, safety mode, and background-
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
  // none match. Skippable — Verify will run with mocked tool
  // responses if integrations aren't connected, which is fine for
  // behavioural grading but should be flagged.
  { id: "setup",    label: "Setup" },
  // Verify — run a starter eval against the draft directive before
  // commit. The eval comes from the template's suggested_evals
  // (seeded at agent-create time on the server side, but PR-1
  // surfaces it pre-create via a stateless /evals/preview call so
  // operators can iterate on the directive without churning rows).
  { id: "verify",   label: "Verify" },
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

interface DraftEval {
  // Seeded from the template's suggested_evals[0] when the operator
  // picks a template in step 1. description + goals are editable in
  // the Verify step; mocks are shown collapsed (read-only) as the
  // pinned-tools list the agent will see during the run.
  name: string;
  description: string;
  goals: string[];
  mocks: EvalMock[];
  max_turns: number;
}

interface WizardState {
  templateID: string | null;
  name: string;
  directive: string;
  mode: Mode;
  unconscious: boolean;
  includeAptevaServer: boolean;
  includeChannels: boolean;
  recommendedApps: string[]; // surface-only, no install in this flow
  // Setup-step explicit selections. Operator picks which existing
  // apps + integration connections attach to this agent as MCP
  // servers. Defaults at template-pick time to "every running
  // installed app" + "every connected integration" — the wizard
  // populates these once both inventories load (see effects below).
  boundAppInstallIDs: Set<number>;
  boundConnectionIDs: Set<number>;
  appAccess: Record<number, AppAccessDraft>;
  // Verify-step draft. null when the template has no suggested
  // evals or before any template is picked.
  draftEval: DraftEval | null;
  // Per-click run policy. Default is improvement mode (5
  // iterations) so wizard runs surface judge suggestions for
  // weak directives. Operator can flip to strict (1 iteration)
  // via the toggle when they just want a pass/fail signal.
  verifyOptions: RunOptions;
  // Directive edits the operator has accepted from a run's
  // suggested_improvements. Stored separately from `directive`
  // until create() time so the operator can toggle them on/off
  // before committing. Each entry includes the suggestion id so
  // the UI can show which ones are queued.
  acceptedEdits: { id: string; add: string; reason?: string }[];
}

const INITIAL: WizardState = {
  templateID: null,
  name: "",
  directive: "",
  mode: "learn",
  unconscious: true,
  // Locked defaults — the wizard no longer exposes these toggles
  // because in practice we always want channels (agent needs a way
  // to reply) and never want the apteva-server self-introspection
  // MCP attached to a wizard-built agent. Operators who need
  // either can flip them from the agent detail page's System MCP
  // panel post-create.
  includeAptevaServer: false,
  includeChannels: true,
  boundAppInstallIDs: new Set<number>(),
  boundConnectionIDs: new Set<number>(),
  appAccess: {},
  recommendedApps: [],
  draftEval: null,
  verifyOptions: { max_iterations: 5, strict_mocks: false },
  acceptedEdits: [],
};

function defaultAppAccessDraft(): AppAccessDraft {
  return { mode: "full", folders: "/", read: true, write: false, delete: false };
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
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  // Operator's existing integration connections, used by the Setup
  // step to satisfy template requirements. Refetched when the
  // operator returns from /integrations via the Refresh button.
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  // Inline status the Review step renders during create — one line
  // per app the wizard is installing on the user's behalf.
  const [installProgress, setInstallProgress] = useState<Record<string, string>>({});

  // Verify step state. verifyRun is the *final* EvalRun emitted by
  // the streaming runner's done event; verifyIteration is the most
  // recent in-flight iteration event (cleared on done). verifyRunning
  // gates the Run button; verifyError surfaces network / runner
  // failures distinct from a fail-verdict (a fail verdict is a
  // successful run with red goals). verifyAutoRun = checkbox state
  // for "auto-continue between iterations"; default off so first-time
  // users see the step UX.
  const [verifyRun, setVerifyRun] = useState<EvalRun | null>(null);
  const [verifyRunning, setVerifyRunning] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyIteration, setVerifyIteration] = useState<IterationEvent | null>(null);
  const [verifyAutoRun, setVerifyAutoRun] = useState(false);
  // streamRef holds the in-flight SSE handle so Continue/Stop/abort
  // can address it without forcing a re-render on every state tick.
  // autoRunRef mirrors verifyAutoRun for the same reason — the
  // onIteration callback closes over it once at stream-open time.
  const streamRef = useRef<EvalStreamHandle | null>(null);
  const autoRunRef = useRef(verifyAutoRun);
  useEffect(() => {
    autoRunRef.current = verifyAutoRun;
  }, [verifyAutoRun]);
  // Tear down any open stream on unmount so a navigation-away doesn't
  // leave a server-side runner parked on the control channel until
  // the per-iteration timeout (server cleans up after 10min/iter).
  useEffect(() => () => streamRef.current?.abort(), []);

  useEffect(() => {
    agentTemplates.list().then(setTemplates).catch(() => setTemplates([]));
    providers
      .list(currentProject?.id)
      .then((list) => setHasProvider(list.some((p) => p.type === "llm")))
      .catch(() => setHasProvider(false));
    appsAPI.list(currentProject?.id).then(setInstalledApps).catch(() => setInstalledApps([]));
    appsAPI
      .marketplace(currentProject?.id)
      .then((res) => setMarketplace(res.apps))
      .catch(() => setMarketplace([]));
    integrationsAPI
      .connections(currentProject?.id)
      .then(setConnections)
      .catch(() => setConnections([]));
  }, [currentProject?.id]);

  // Defaults: nothing pre-selected. Operators consciously opt in to
  // each MCP server attached to their new agent — that's safer
  // (least-privilege) and the wizard's choices stay legible
  // ("Storage" + "Slack" is clearer than "everything in the project
  // unless I think to uncheck it"). The boundAppInstallIDs / IDs
  // sets stay empty until the operator clicks rows in the Setup
  // step.

  // refreshConnections is called from the Setup step's "I just
  // connected something" Refresh button so the operator doesn't
  // have to leave the wizard after completing OAuth in /integrations.
  const refreshConnections = () => {
    integrationsAPI
      .connections(currentProject?.id)
      .then(setConnections)
      .catch(() => {});
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
  const installRequiredApps = async (tpl: AgentTemplate) => {
    const installedSlugs = new Set(installedApps.map((a) => a.name));
    const slugs = tpl.requirements
      .filter((r) => r.kind === "app" && r.required && r.slug)
      .map((r) => r.slug!)
      .filter((slug) => !installedSlugs.has(slug));
    if (slugs.length === 0) return;

    const installIDs: Record<string, number> = {};
    await Promise.all(
      slugs.map(async (slug) => {
        const m = marketplace.find((x) => x.name === slug);
        if (!m) throw new Error(`${slug}: not in marketplace`);
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
        return;
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
      default:
        return true;
    }
  };

  // runVerify opens an SSE stream against the streaming preview
  // endpoint. Sends the effective directive (base + any accepted
  // edits so the next run measures what the operator would actually
  // persist on Create) and the per-click RunOptions toggle. The
  // server emits one iteration event per attempt and parks waiting
  // for continueVerify/stopVerify between them (or auto-continues
  // when verifyAutoRun is on). The final EvalRun arrives via the
  // done event.
  const runVerify = () => {
    if (!state.draftEval) return;
    // Cancel any prior in-flight stream before kicking off a new one.
    // Unrequested late events from a stale run would otherwise scramble
    // the result panel during a quick "Run again" click.
    streamRef.current?.abort();
    streamRef.current = null;
    setVerifyRunning(true);
    setVerifyError(null);
    setVerifyRun(null);
    setVerifyIteration(null);
    const effectiveDirective = composeDirective(state.directive, state.acceptedEdits);
    streamRef.current = evalsAPI.previewStream(
      {
        directive: effectiveDirective,
        name: state.name,
        project_id: currentProject?.id,
        eval: {
          name: state.draftEval.name,
          description: state.draftEval.description,
          goals: state.draftEval.goals,
          mocks: state.draftEval.mocks,
          max_turns: state.draftEval.max_turns,
        },
        options: state.verifyOptions,
      },
      {
        onIteration: (it) => {
          setVerifyIteration(it);
          // Auto-advance only on non-final events — the final iteration
          // breaks the runner's loop on its own; the step endpoint
          // would 404 by the time the POST landed.
          if (!it.final && autoRunRef.current) {
            void streamRef.current?.sendStep("continue").catch(() => {});
          }
        },
        onDone: (run) => {
          setVerifyRun(run);
          setVerifyIteration(null);
          setVerifyRunning(false);
          streamRef.current = null;
        },
        onError: (err) => {
          setVerifyError(err.message);
          setVerifyRunning(false);
          streamRef.current = null;
        },
      },
    );
  };

  const continueVerify = () => {
    void streamRef.current?.sendStep("continue").catch((e: any) => {
      setVerifyError(e?.message || "continue failed");
    });
  };
  const stopVerify = () => {
    void streamRef.current?.sendStep("stop").catch((e: any) => {
      setVerifyError(e?.message || "stop failed");
    });
  };
  const setAutoRun = (v: boolean) => {
    setVerifyAutoRun(v);
    // If the toggle flips on while parked at a non-final iteration,
    // release it immediately so the operator doesn't have to also
    // click Continue.
    if (v && verifyIteration && !verifyIteration.final && streamRef.current) {
      void streamRef.current.sendStep("continue").catch(() => {});
    }
  };

  const applyTemplate = (t: AgentTemplate) => {
    // Seed the Verify step's draft eval from the template's first
    // suggested_eval if it has one. Description comes from the
    // template directly; legacy templates without it fall back to
    // a backfilled description from the trigger via the server's
    // suggested_evals projection (description is always populated
    // on the wire).
    const firstSuggested = t.suggested_evals?.[0];
    const draftEval: DraftEval | null = firstSuggested
      ? {
          name: firstSuggested.name,
          description: firstSuggested.description || derivedDescriptionFromTrigger(firstSuggested.trigger),
          goals: firstSuggested.goals.slice(),
          mocks: firstSuggested.mocks,
          max_turns: firstSuggested.max_turns ?? 5,
        }
      : null;
    setState((s) => ({
      ...s,
      templateID: t.id,
      // Suggest the template's name but let the user override.
      name: s.name || (t.id === "empty" ? "" : t.name),
      directive: t.directive,
      mode: t.mode as Mode,
      unconscious: t.unconscious,
      recommendedApps: t.recommended_apps || [],
      draftEval,
      // Reset queued edits when switching templates so we don't
      // carry directive proposals from a previous template's run
      // into a new one.
      acceptedEdits: [],
    }));
    setVerifyRun(null);
    setVerifyError(null);
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
      if (tpl) await installRequiredApps(tpl);

      const startNow = hasProvider !== false;
      // Fold any judge-proposed directive edits the operator
      // accepted in Verify into the directive at create-time. They
      // were ephemeral until this point; from here on they're part
      // of the agent's stored directive and bump the directive
      // history audit table at the agent's first run.
      const effectiveDirective = composeDirective(state.directive, state.acceptedEdits);
      const boundAppGrants = buildAppGrantPolicies(state);
      const created = await instances.create(
        state.name.trim(),
        effectiveDirective,
        state.mode,
        currentProject?.id,
        startNow,
        {
          includeAptevaServer: state.includeAptevaServer,
          includeChannels: state.includeChannels,
          unconscious: state.unconscious,
          templateID: state.templateID || undefined,
          boundAppInstallIDs: Array.from(state.boundAppInstallIDs),
          boundConnectionIDs: Array.from(state.boundConnectionIDs),
          boundAppGrants,
        },
      );
      // Persist the wizard's draft eval as a real agent_evals row
      // attached to the newly-created agent. Template-seeded evals
      // are already written server-side via templateID handling;
      // this covers two cases that one doesn't:
      //   1. Operator started from an Empty template and authored
      //      an eval inline → the wizard's Verify step is the only
      //      place this eval exists, so it'd vanish if we didn't
      //      persist it here.
      //   2. Operator edited a template-seeded draft (different
      //      goals, different trigger text) → their edits would
      //      get lost since the server seed wrote the original
      //      template values.
      // Best-effort: a persist failure doesn't block agent create.
      // The agent still works; operator can re-create the eval
      // from the detail page if needed.
      if (state.draftEval && state.draftEval.goals.some((g) => g.trim())) {
        try {
          await evalsAPI.create(created.id, {
            name: state.draftEval.name,
            description: state.draftEval.description,
            goals: state.draftEval.goals.filter((g) => g.trim()),
            mocks: state.draftEval.mocks,
            max_turns: state.draftEval.max_turns,
          });
        } catch (e) {
          // Surface as a console warning rather than blocking nav —
          // the agent is alive; the operator will discover the eval
          // is missing on the detail page and can re-add it.
          console.warn("persist draft eval failed", e);
        }
      }

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
    <div className="h-full overflow-y-auto">
      <div className="w-full px-8 py-10">
        <header className="mb-8">
          <h1 className="text-text text-3xl font-bold">Build your agent</h1>
          <p className="text-text-muted text-base mt-2">
            A short guided setup. You can change everything later from the agent's detail page.
          </p>
        </header>

        <Progress current={stepIdx} steps={STEPS} />

        <div className="border border-border rounded-lg p-8 bg-bg-card mt-6">
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
              projectId={currentProject?.id}
            />
          )}
          {step.id === "verify" && (
            <VerifyStep
              state={state}
              setState={setState}
              run={verifyRun}
              running={verifyRunning}
              errorMessage={verifyError}
              iteration={verifyIteration}
              autoRun={verifyAutoRun}
              onAutoRunChange={setAutoRun}
              onRun={runVerify}
              onContinue={continueVerify}
              onStop={stopVerify}
              onJumpToDirective={() => setStepIdx(1)}
            />
          )}
          {step.id === "review" && (
            <ReviewStep
              state={state}
              hasProvider={hasProvider}
              onEdit={(i) => setStepIdx(i)}
              installProgress={creating ? installProgress : {}}
            />
          )}

          {error && (
            <div className="text-red text-sm mt-4 border-l-2 border-red pl-3">
              {error}
            </div>
          )}

          <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
            <button
              onClick={back}
              disabled={stepIdx === 0 || creating}
              className="text-text-muted text-sm hover:text-text transition-colors disabled:opacity-30"
            >
              ← Back
            </button>
            <button
              onClick={advance}
              disabled={creating}
              className="px-5 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {creating
                ? Object.keys(installProgress).length > 0
                  ? "Installing apps…"
                  : "Creating…"
                : isLast
                  ? hasProvider === false
                    ? "Create (stopped — no provider yet)"
                    : "Create agent →"
                  : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Progress({ current, steps }: { current: number; steps: typeof STEPS }) {
  return (
    <ol className="flex items-center justify-center gap-2 text-xs">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`w-6 h-6 rounded-full border flex items-center justify-center font-bold ${
              i < current
                ? "border-accent bg-accent text-bg"
                : i === current
                  ? "border-accent text-accent"
                  : "border-border text-text-muted"
            }`}
          >
            {i + 1}
          </span>
          <span className={i === current ? "text-text" : "text-text-muted"}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-text-muted">→</span>}
        </li>
      ))}
    </ol>
  );
}

interface TemplateStepProps {
  templates: AgentTemplate[];
  selectedID: string | null;
  onSelect: (t: AgentTemplate) => void;
  onSkipWizard: () => void;
}

function TemplateStep({ templates, selectedID, onSelect, onSkipWizard }: TemplateStepProps) {
  // Empty template sits last in the grid as the "I'll fill it in"
  // option for users who want to write everything themselves but
  // still go through the wizard's mode/MCP steps.
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">Pick a starting point</h2>
        <p className="text-text-muted text-sm mt-1">
          Each template comes with a starter directive, a recommended safety mode, and a hint about which apps pair well with it. You can adjust everything in the next steps.
        </p>
      </div>

      {templates.length === 0 ? (
        <p className="text-text-muted text-sm">Loading templates…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className={`text-left border rounded-lg p-4 transition-colors ${
                selectedID === t.id
                  ? "border-accent bg-bg-card"
                  : "border-border hover:border-text-dim"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <TemplateIcon name={t.icon} className="text-accent shrink-0" />
                <span className="text-text font-medium">{t.name}</span>
                {t.source === "app" && (
                  <span className="text-xs text-text-muted ml-auto">via {t.source_ref}</span>
                )}
              </div>
              <p className="text-text-muted text-xs leading-relaxed">{t.description}</p>
              {t.resolved_logos && t.resolved_logos.length > 0 && (
                <LogoRow logos={t.resolved_logos} className="mt-3" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="text-right">
        <button
          onClick={onSkipWizard}
          className="text-text-muted text-xs hover:text-text underline-offset-2 hover:underline transition-colors"
        >
          Advanced — skip the wizard and use the classic form
        </button>
      </div>
    </div>
  );
}

interface DetailsStepProps {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

// SuggestFromGoalsButton — calls the server's /agents/seed-directive
// endpoint with the wizard's current eval goals + agent name, then
// pastes the returned directive into state.directive. Disabled when
// no goals exist yet (template provided none, operator hasn't typed
// any). The platform meta-agent does the synthesis; one LLM call,
// 5-15s depending on load. We park a small loading + error indicator
// inline so the operator can see the call landed (or failed loud).
function SuggestFromGoalsButton({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const goals = (state.draftEval?.goals ?? []).filter((g) => g.trim() !== "");
  const disabled = busy || goals.length === 0;

  const onClick = async () => {
    setBusy(true);
    setErr(null);
    try {
      const resp = await synthesizeDirective({
        goals,
        agent_name: state.name || undefined,
        current_directive: state.directive || undefined,
      });
      setState((s) => ({ ...s, directive: resp.directive }));
    } catch (e: any) {
      setErr(e?.message ?? "synthesis failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {err && (
        <span className="text-red text-[11px]" title={err}>
          ✗ {err.length > 60 ? err.slice(0, 60) + "…" : err}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="text-accent text-xs hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
        title={
          goals.length === 0
            ? "Add eval goals first (Verify step)"
            : "Ask the platform to draft a starter directive from your eval goals"
        }
      >
        {busy ? "Synthesizing…" : "Suggest from goals"}
      </button>
    </div>
  );
}

// DetailsStep — single merged step covering everything the operator
// authors about the agent itself: name, directive, safety mode,
// background memory. Was two steps (Details + Behavior) until the
// Behavior step thinned out enough that combining was cleaner than
// keeping a tab with two controls.
function DetailsStep({ state, setState }: DetailsStepProps) {
  const modes: { id: Mode; label: string; description: string }[] = [
    {
      id: "learn",
      label: "Learn",
      description: "Soft gate — agent asks before any tool it hasn't used this session. Recommended for new agents while you tune the directive.",
    },
    {
      id: "cautious",
      label: "Cautious",
      description: "Pauses before any tool call that mutates state (sends, writes, executes). Reads stay free.",
    },
    {
      id: "autonomous",
      label: "Autonomous",
      description: "Full speed — agent takes actions without asking. Best after you've watched it work for a while.",
    },
  ];
  const selectedMode = modes.find((m) => m.id === state.mode) || modes[0]!;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-text text-lg font-bold">Details</h2>
        <p className="text-text-muted text-xs mt-1">
          Name, directive, and how the agent should behave at runtime.
        </p>
      </div>

      <div>
        <label className="block text-text-muted text-xs mb-1.5">Name</label>
        <input
          type="text"
          value={state.name}
          onChange={(e) =>
            setState((s) => ({ ...s, name: (e.target as HTMLInputElement).value }))
          }
          className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Inbox triage"
          autoComplete="off"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-text-muted text-xs">Directive</label>
          <SuggestFromGoalsButton state={state} setState={setState} />
        </div>
        <textarea
          value={state.directive}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              directive: (e.target as HTMLTextAreaElement).value,
            }))
          }
          rows={9}
          className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text font-mono leading-relaxed focus:outline-none focus:border-accent resize-y"
          placeholder="What should this agent do? What's its rhythm? When should it ask before acting?"
          spellCheck={false}
        />
        <p className="text-text-muted text-xs mt-1.5">
          Written in second person ("You are…"). The agent reads it at the top of context every iteration.
        </p>
      </div>

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

      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={state.unconscious}
            onChange={(e) =>
              setState((s) => ({ ...s, unconscious: (e.target as HTMLInputElement).checked }))
            }
            className="mt-1"
          />
          <div>
            <div className="text-text text-sm font-medium">Background memory (unconscious)</div>
            <div className="text-text-muted text-xs leading-relaxed mt-0.5">
              Spawns a second thread that consolidates main's activity into typed memories — preferences, decisions, names, open questions — so the agent remembers across sessions. Off keeps it stateless.
            </div>
          </div>
        </label>
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
  onRefresh: () => void;
  /** Scope for any newly-minted connection from the inline
   *  ConnectIntegrationModal — matches the agent's own scope. */
  projectId?: string;
}

// SetupStep — surfaces the template's requirements as a checklist
// the operator can act on. Required apps auto-install at create
// time, so they show as informational rows ("✓ Will be installed").
// Required integrations check the operator's existing connection
// pool by compatible_slugs; unmatched requirements get a deep-link
// to /integrations (new tab) plus a Refresh button so the operator
// doesn't have to leave the wizard once OAuth completes.
//
// The step is skippable: Verify will still run with mocked tool
// responses regardless of what's connected. A note in Verify
// reminds the operator when integrations are missing.
function SetupStep({
  template,
  installedApps,
  marketplace,
  connections,
  state,
  setState,
  onRefresh,
  projectId,
}: SetupStepProps) {
  // Inline catalog browse. Lazy fetch on first focus so the wizard
  // doesn't make the call until the operator actually wants to
  // discover something new.
  const [catalog, setCatalog] = useState<AppSummary[] | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Inline connect modal — opens when the operator clicks Set up
  // on a catalog row. Single-slug at a time; on success we refetch
  // connections + auto-attach the new one so the operator's
  // selection trail is intact without leaving the wizard.
  const [connectSlug, setConnectSlug] = useState<string | null>(null);
  const loadCatalog = () => {
    if (catalog !== null || catalogLoading) return;
    setCatalogLoading(true);
    integrationsAPI
      .catalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
      .finally(() => setCatalogLoading(false));
  };
  // Slugs the operator has already connected — used to grey out
  // catalog rows that are already "in use" so they don't try to
  // double-connect from the wizard.
  const connectedSlugs = useMemo(
    () => new Set(connections.map((c) => c.app_slug)),
    [connections],
  );
  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return catalog.slice(0, 8); // a few "popular" rows visible by default
    return catalog
      .filter((a) => a.name.toLowerCase().includes(q) || a.slug.toLowerCase().includes(q))
      .slice(0, 12);
  }, [catalog, catalogQuery]);

  const requirements = template?.requirements || [];
  const installedSlugs = new Set(installedApps.map((a) => a.name));
  const marketplaceByName: Record<string, MarketplaceEntry> = {};
  for (const m of marketplace) marketplaceByName[m.name] = m;
  const connectionsBySlug: Record<string, ConnectionInfo[]> = {};
  for (const c of connections) {
    (connectionsBySlug[c.app_slug] ??= []).push(c);
  }
  const reqApps = requirements.filter((r) => r.kind === "app");
  const reqInts = requirements.filter((r) => r.kind === "integration");
  const missingIntegrations = reqInts.filter(
    (r) =>
      r.required &&
      !(r.compatible_slugs || []).some((slug) => connectionsBySlug[slug]?.length),
  );

  const runningInstalledApps = installedApps.filter((a) => a.status === "running" || a.status === "pending");
  const [permissionCatalogs, setPermissionCatalogs] = useState<Record<number, AppPermissionCatalog | null>>({});

  useEffect(() => {
    for (const id of state.boundAppInstallIDs) {
      if (permissionCatalogs[id] !== undefined) continue;
      appsAPI
        .permissions(id)
        .then((catalog) => {
          setPermissionCatalogs((prev) => ({ ...prev, [id]: catalog }));
        })
        .catch(() => {
          setPermissionCatalogs((prev) => ({ ...prev, [id]: null }));
        });
    }
  }, [state.boundAppInstallIDs, permissionCatalogs]);

  const toggleConnection = (id: number) => {
    setState((s) => {
      const next = new Set(s.boundConnectionIDs);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...s, boundConnectionIDs: next };
    });
  };
  const toggleApp = (id: number) => {
    setState((s) => {
      const next = new Set(s.boundAppInstallIDs);
      const appAccess = { ...s.appAccess };
      if (next.has(id)) {
        next.delete(id);
        delete appAccess[id];
      } else {
        next.add(id);
        appAccess[id] = appAccess[id] || defaultAppAccessDraft();
      }
      return { ...s, boundAppInstallIDs: next, appAccess };
    });
  };
  const updateAppAccess = (id: number, patch: Partial<AppAccessDraft>) => {
    setState((s) => ({
      ...s,
      appAccess: {
        ...s.appAccess,
        [id]: { ...(s.appAccess[id] || defaultAppAccessDraft()), ...patch },
      },
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-text text-lg font-bold">MCP servers</h2>
        <p className="text-text-muted text-sm mt-1">
          Pick the integrations + apps this agent should attach as MCP servers. Nothing's selected by default — least-privilege is the safer floor, so opt in to what this agent actually needs.
        </p>
      </div>

      {/* Template-required gates stay at the top so missing
          required integrations are unmissable. Selection of
          connections + apps below is the operator's call. */}
      {requirements.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-text-muted text-xs uppercase tracking-wide flex items-center gap-2">
            Required by template
            <button
              onClick={onRefresh}
              className="text-accent text-[10px] hover:underline normal-case"
              title="I just connected an integration — re-check"
            >
              ↻ Refresh
            </button>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {reqApps.map((r) => {
              const alreadyInstalled = !!r.slug && installedSlugs.has(r.slug);
              const inMarketplace = !!r.slug && !!marketplaceByName[r.slug];
              const status = alreadyInstalled
                ? "Installed"
                : inMarketplace
                  ? r.required ? "Will be installed" : "Available"
                  : "Not in marketplace";
              return (
                <RequirementRow
                  key={`app-${r.slug}`}
                  label={marketplaceByName[r.slug || ""]?.display_name || r.slug || ""}
                  reason={r.reason}
                  badge={status}
                  ok={alreadyInstalled || (inMarketplace && r.required)}
                  optional={!r.required}
                />
              );
            })}
            {reqInts.map((r) => {
              const slugs = r.compatible_slugs || [];
              const match = slugs.find((s) => connectionsBySlug[s]?.length);
              const ok = !!match;
              return (
                <RequirementRow
                  key={`int-${slugs.join(",")}`}
                  label={ok ? `${match} connected` : `${slugs.join(" / ")} — not connected`}
                  reason={r.reason}
                  badge={ok ? "Connected" : r.required ? "Required" : "Optional"}
                  ok={ok}
                  optional={!r.required}
                  action={
                    !ok ? (
                      <a
                        href={`/integrations?app=${encodeURIComponent(slugs[0] || "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent text-xs hover:underline"
                      >
                        Set up →
                      </a>
                    ) : null
                  }
                />
              );
            })}
          </ul>
          {missingIntegrations.length > 0 && (
            <div className="text-xs text-amber border-l-2 border-amber pl-3 mt-1">
              {missingIntegrations.length} required integration{missingIntegrations.length === 1 ? "" : "s"} not connected. Verify will run with mocked responses, but the live agent won't reach them until set up.
            </div>
          )}
        </div>
      )}

      {/* ─── Integrations ─── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-text-muted text-xs uppercase tracking-wide flex items-center justify-between">
          <span>
            Integrations
            {connections.length > 0 && (
              <span className="text-text-muted normal-case ml-1">
                — {state.boundConnectionIDs.size}/{connections.length} attached
              </span>
            )}
          </span>
        </h3>
        {connections.length === 0 ? (
          <p className="text-text-muted text-xs px-3 py-2 border border-border border-dashed rounded-lg">
            No integrations connected yet. Use the search below to find one and{" "}
            <a href="/integrations" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              connect →
            </a>
          </p>
        ) : (
          <ul className="flex flex-col gap-px bg-border border border-border rounded-lg overflow-hidden">
            {connections.map((c) => {
              const checked = state.boundConnectionIDs.has(c.id);
              return (
                <SelectableRow
                  key={c.id}
                  checked={checked}
                  onToggle={() => toggleConnection(c.id)}
                  label={c.app_name || c.app_slug}
                  meta={c.name}
                  badge={`MCP: ${c.app_slug}`}
                  statusDot={c.status === "active" ? "green" : "amber"}
                  hint={c.project_id ? undefined : "global"}
                />
              );
            })}
          </ul>
        )}

        {/* Inline catalog browse — search any of the 400+ catalog
            apps. Set-up links open /integrations in a new tab; the
            wizard's Refresh-on-return button (above) re-checks
            after the operator finishes OAuth. */}
        <details
          className="border border-border rounded-lg"
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) loadCatalog();
          }}
        >
          <summary className="cursor-pointer px-3 py-2 text-text-muted text-xs hover:text-text flex items-center justify-between">
            <span>+ Browse + connect more integrations</span>
            {catalog && <span className="text-text-dim">{catalog.length} available</span>}
          </summary>
          <div className="border-t border-border p-3 flex flex-col gap-2">
            <input
              type="text"
              value={catalogQuery}
              onChange={(e) => setCatalogQuery((e.target as HTMLInputElement).value)}
              placeholder="Search apps (slack, stripe, notion…)"
              className="w-full bg-bg-input border border-border rounded px-2.5 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
              autoComplete="off"
            />
            {catalogLoading ? (
              <p className="text-text-muted text-xs">Loading catalog…</p>
            ) : (
              <ul className="flex flex-col gap-px max-h-72 overflow-y-auto">
                {filteredCatalog.map((a) => {
                  const already = connectedSlugs.has(a.slug);
                  return (
                    <li key={a.slug} className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-card rounded">
                      <span className="flex-1 min-w-0 text-sm text-text truncate">
                        {a.name}
                        <span className="text-text-dim text-xs ml-1.5">{a.slug}</span>
                      </span>
                      {already ? (
                        <span className="text-green text-xs shrink-0">connected</span>
                      ) : (
                        <button
                          onClick={() => setConnectSlug(a.slug)}
                          className="text-accent text-xs hover:underline shrink-0"
                        >
                          Set up →
                        </button>
                      )}
                    </li>
                  );
                })}
                {filteredCatalog.length === 0 && catalogQuery && (
                  <li className="text-text-muted text-xs px-2 py-1.5">No matches.</li>
                )}
              </ul>
            )}
          </div>
        </details>
      </div>

      {/* ─── Apps ─── */}
      <div className="flex flex-col gap-2">
        <h3 className="text-text-muted text-xs uppercase tracking-wide flex items-center justify-between">
          <span>
            Apps
            {runningInstalledApps.length > 0 && (
              <span className="text-text-muted normal-case ml-1">
                — {Array.from(state.boundAppInstallIDs).filter((id) => runningInstalledApps.some((a) => a.install_id === id)).length}/{runningInstalledApps.length} attached
              </span>
            )}
          </span>
          <a
            href="/apps"
            target="_blank"
            rel="noreferrer"
            className="text-accent text-[10px] hover:underline normal-case"
          >
            + Install more →
          </a>
        </h3>
        <p className="text-text-muted text-[11px]">
          Binding an app gives this agent its tools and its skills (playbooks).
        </p>
        {runningInstalledApps.length === 0 ? (
          <p className="text-text-muted text-xs px-3 py-2 border border-border border-dashed rounded-lg">
            No apps installed in this project.{" "}
            <a href="/apps" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Browse the marketplace →
            </a>
          </p>
        ) : (
          <ul className="flex flex-col gap-px bg-border border border-border rounded-lg overflow-hidden">
            {runningInstalledApps.map((a) => {
              const checked = state.boundAppInstallIDs.has(a.install_id);
              const toolCount = a.surfaces?.mcp_tool_count || 0;
              const skillCount = a.surfaces?.skill_count || 0;
              const catalog = permissionCatalogs[a.install_id];
              const hasScopedAccess = !!catalog?.permissions?.length && !!catalog?.resources?.length;
              // What binding this app brings the agent: its tools (via the
              // gateway) + its skills (attached on bind, server-side).
              const parts: string[] = [];
              if (toolCount > 0) parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
              if (skillCount > 0) parts.push(`${skillCount} skill${skillCount === 1 ? "" : "s"}`);
              const surfaceBadge = parts.length > 0 ? parts.join(" · ") : "MCP";
              return (
                <React.Fragment key={a.install_id}>
                  <SelectableRow
                    checked={checked}
                    onToggle={() => toggleApp(a.install_id)}
                    label={a.display_name || a.name}
                    meta={`v${a.version}`}
                    badge={hasScopedAccess ? `${surfaceBadge} · scoped` : surfaceBadge}
                    statusDot={a.status === "running" ? "green" : "amber"}
                    hint={a.project_id ? undefined : "global"}
                  />
                  {checked && hasScopedAccess && (
                    <ScopedAppAccess
                      app={a}
                      catalog={catalog}
                      draft={state.appAccess[a.install_id] || defaultAppAccessDraft()}
                      onChange={(patch) => updateAppAccess(a.install_id, patch)}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </ul>
        )}
      </div>

      {/* AI suggestions slot — placeholder for the meta-agent
          classifier+suggester landing in a follow-up. */}
      <div className="border border-border border-dashed rounded-lg px-3 py-2">
        <div className="text-text-muted text-xs flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-dim shrink-0" />
          <span>
            The meta-agent will suggest integrations + apps based on your directive.{" "}
            <span className="text-text-dim italic">Coming soon.</span>
          </span>
        </div>
      </div>

      <p className="text-text-muted text-[11px] italic">
        Custom MCP server URLs can be added from the agent's detail page after creation.
      </p>

      {/* Inline connect modal. The Set-up button on each catalog
          row opens it; on success the new connection lands in the
          local connections list and we auto-attach it to the agent
          so the operator doesn't have to scroll back up to tick a
          box for what they literally just connected. */}
      {connectSlug && (
        <ConnectIntegrationModal
          open={connectSlug !== null}
          slug={connectSlug}
          projectId={projectId}
          onCancel={() => setConnectSlug(null)}
          onConnected={(conn) => {
            setConnectSlug(null);
            // Auto-attach: the wizard's least-privilege default
            // (nothing pre-selected) doesn't fight the user
            // intent here — they explicitly just connected this
            // integration FROM the wizard, so they want it on
            // this agent.
            setState((s) => {
              const next = new Set(s.boundConnectionIDs);
              next.add(conn.id);
              return { ...s, boundConnectionIDs: next };
            });
            onRefresh();
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

// SelectableRow — compact list row with a themed selection visual.
// Used by both the integrations + apps inventories in the Setup
// step. Clicking the row anywhere toggles selection.
//
// Visual design: avoids the native <input type="checkbox"> (which
// inherits the OS chrome and looks out of place against the
// dashboard's dark theme). Replaces it with a span styled as a
// rounded square — empty border when unchecked, accent-filled
// with a check glyph when checked — plus a left accent bar that
// fades in for selected rows so the operator can eye-scan their
// picks at a glance.
//
// A visually-hidden checkbox input still rides along for screen
// readers + keyboard form semantics.
function SelectableRow({
  checked,
  onToggle,
  label,
  meta,
  badge,
  statusDot,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  meta?: string;
  badge?: string;
  statusDot: "green" | "amber" | "red" | "dim";
  hint?: string;
}) {
  const dotColor =
    statusDot === "green"
      ? "bg-green"
      : statusDot === "amber"
        ? "bg-yellow"
        : statusDot === "red"
          ? "bg-red"
          : "bg-text-dim";
  return (
    <li
      className={`group relative flex items-center gap-3 pl-3.5 pr-3 py-2 text-sm cursor-pointer select-none transition-colors ${
        checked
          ? "bg-accent/10 hover:bg-accent/15"
          : "bg-bg hover:bg-bg-card"
      }`}
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {/* Left accent bar — invisible by default, slides in as a
          1.5px stripe along the row's left edge when selected. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 bottom-0 w-[2px] transition-colors ${
          checked ? "bg-accent" : "bg-transparent"
        }`}
      />
      {/* Themed checkbox: rounded square. Border-only when off,
          accent-filled with a check glyph when on. */}
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center w-4 h-4 rounded shrink-0 border transition-colors ${
          checked
            ? "bg-accent border-accent text-bg"
            : "bg-bg border-border group-hover:border-text-dim"
        }`}
      >
        {checked && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5 L7 12 L13 5" />
          </svg>
        )}
      </span>
      {/* Hidden native input for form semantics + screen readers. */}
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className={`truncate flex-1 min-w-0 ${checked ? "text-text font-medium" : "text-text"}`}>
        {label}
      </span>
      {meta && <span className="text-text-muted text-xs shrink-0">{meta}</span>}
      {badge && (
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
            checked ? "bg-accent/15 text-accent" : "bg-bg text-text-muted"
          }`}
        >
          {badge}
        </span>
      )}
      {hint && (
        <span className="text-text-muted text-[10px] uppercase tracking-wide bg-border px-1.5 py-0.5 rounded shrink-0">
          {hint}
        </span>
      )}
    </li>
  );
}

// RequirementRow is one entry in the Setup step's checklist. Used
// for both apps and integrations; ok=true renders the green check,
// optional collapses the status badge to a quieter tone.
function RequirementRow({
  label,
  reason,
  badge,
  ok,
  optional,
  action,
}: {
  label: string;
  reason?: string;
  badge: string;
  ok: boolean;
  optional: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 border border-border rounded-lg px-3 py-2">
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
          ok ? "bg-green" : optional ? "bg-text-muted" : "bg-amber"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-text text-sm">{label}</div>
        {reason && <div className="text-text-muted text-xs mt-0.5">{reason}</div>}
      </div>
      <span
        className={`text-xs shrink-0 ${
          ok ? "text-green" : optional ? "text-text-muted" : "text-amber"
        }`}
      >
        {badge}
      </span>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

interface VerifyStepProps {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  run: EvalRun | null;
  running: boolean;
  errorMessage: string | null;
  // Per-iteration in-flight event from the streaming runner.
  // Mutually exclusive with `run`: while the stream is open we show
  // iteration state; once the done event arrives we swap to the
  // final run panel.
  iteration: IterationEvent | null;
  autoRun: boolean;
  onAutoRunChange: (v: boolean) => void;
  onRun: () => void;
  onContinue: () => void;
  onStop: () => void;
  onJumpToDirective: () => void;
}

// VerifyStep renders the wizard's preflight eval.
//
// Operator surface is three fields — description (what the agent
// should do), goals (the judge's rubric), and a strict-vs-improve
// toggle that controls whether the run is a single-shot
// verification or a multi-iteration improvement loop. The system
// handles tool mocking, judging, and (in improvement mode)
// proposing directive edits the operator can queue into the
// directive before agent create.
function VerifyStep({
  state,
  setState,
  run,
  running,
  errorMessage,
  iteration,
  autoRun,
  onAutoRunChange,
  onRun,
  onContinue,
  onStop,
  onJumpToDirective,
}: VerifyStepProps) {
  const draft = state.draftEval;

  // Empty state — no template suggested_eval and operator hasn't
  // added one yet. Offer a "+ Add an eval" CTA so they can author
  // one inline instead of being told to come back from the agent
  // detail page.
  if (!draft) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-text text-lg font-bold">Verify</h2>
          <p className="text-text-muted text-sm mt-1">
            Define a behavioural eval: a description of what the agent should do + a list of goals the platform's meta-agent will grade against. Iterate until every goal is green.
          </p>
        </div>
        <div className="border border-border border-dashed rounded-lg px-4 py-6 text-center">
          <p className="text-text-muted text-sm mb-3">
            No eval yet. Add one to verify the agent's behaviour before creation.
          </p>
          <button
            onClick={() =>
              setState((s) => ({
                ...s,
                draftEval: makeBlankDraftEval(),
              }))
            }
            className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
          >
            + Add an eval
          </button>
        </div>
      </div>
    );
  }

  const updateDraft = (patch: Partial<DraftEval>) =>
    setState((s) => (s.draftEval ? { ...s, draftEval: { ...s.draftEval, ...patch } } : s));
  const setGoal = (i: number, value: string) => {
    const goals = draft.goals.slice();
    goals[i] = value;
    updateDraft({ goals });
  };
  const addGoal = () => updateDraft({ goals: [...draft.goals, ""] });
  const removeGoal = (i: number) => updateDraft({ goals: draft.goals.filter((_, j) => j !== i) });

  const setMaxIterations = (n: number) =>
    setState((s) => ({ ...s, verifyOptions: { ...s.verifyOptions, max_iterations: n } }));

  // Suggestion acceptance: clicking the checkbox queues the
  // directive edit into state.acceptedEdits. Already-accepted
  // edits show pre-checked; toggling off removes them. Edits are
  // persisted into the agent's directive at create() time, not
  // immediately — operator can run again to confirm.
  const toggleAcceptEdit = (sugg: DirectiveEditSuggestion) => {
    setState((s) => {
      const has = s.acceptedEdits.some((e) => e.id === sugg.id);
      const next = has
        ? s.acceptedEdits.filter((e) => e.id !== sugg.id)
        : [...s.acceptedEdits, { id: sugg.id, add: sugg.add, reason: sugg.reason }];
      return { ...s, acceptedEdits: next };
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-text text-lg font-bold">Verify</h2>
        <p className="text-text-muted text-sm mt-1">
          Run an eval against your draft agent before creating it. Write what the agent should do + the goals it'll be graded against. In improvement mode, the platform judge proposes directive edits you can queue into the directive.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-text-muted text-xs uppercase tracking-wide block mb-1">Eval name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft({ name: (e.target as HTMLInputElement).value })}
              placeholder="e.g. Replies to incoming chat"
              className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-text-muted text-xs uppercase tracking-wide block mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => updateDraft({ description: (e.target as HTMLTextAreaElement).value })}
              rows={5}
              placeholder="What the agent is being asked to do. E.g. 'Reconcile this week's Stripe payouts against open invoices and post a discrepancy report to #finance.'"
              className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text font-mono resize-y focus:outline-none focus:border-accent"
            />
            <p className="text-text-dim text-[11px] mt-1">
              The agent reads this as its opening event. The judge reads it too to interpret your goals.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-text-muted text-xs uppercase tracking-wide">Goals</label>
              <button
                onClick={addGoal}
                className="text-accent text-xs hover:underline"
              >
                + Add goal
              </button>
            </div>
            <ul className="flex flex-col gap-2">
              {draft.goals.map((g, i) => (
                <li key={i} className="flex items-start gap-2">
                  <textarea
                    value={g}
                    onChange={(e) => setGoal(i, e.target.value)}
                    rows={2}
                    placeholder="A behaviour the agent should demonstrate (e.g. 'Reply within 200 words')"
                    className="flex-1 bg-bg-input border border-border rounded p-2 text-text text-sm font-mono resize-y focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => removeGoal(i)}
                    className="text-text-muted hover:text-red text-xs mt-2"
                    title="Remove goal"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-text-dim text-[11px] mt-1">
              The judge grades each goal pass/fail. The agent does NOT see this list — otherwise it'd parrot the criteria back.
            </p>
          </div>
          {draft.mocks.length > 0 && (
            <details className="text-text-muted text-xs">
              <summary className="cursor-pointer hover:text-text">
                {draft.mocks.length} pinned mock{draft.mocks.length === 1 ? "" : "s"} (tool responses)
              </summary>
              <pre className="text-text-muted text-xs mt-2 bg-bg-card border border-border rounded p-3 overflow-x-auto font-mono">
                {JSON.stringify(draft.mocks, null, 2)}
              </pre>
            </details>
          )}

          {/* Iteration count. Improvement loop is always on in the
              wizard — the judge proposes directive edits when an
              attempt fails, the agent retries with them ephemerally
              applied, and the operator can queue accepted edits into
              the directive on Create. Higher count = more LLM cost
              per run but better chance of converging on a fix. */}
          <div className="border border-border rounded-md p-3 bg-bg-card flex flex-col gap-2">
            <label className="text-text-muted text-xs uppercase tracking-wide">Iterations</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={2}
                max={10}
                value={state.verifyOptions.max_iterations ?? 5}
                onChange={(e) => {
                  const raw = Number((e.target as HTMLInputElement).value) || 5;
                  setMaxIterations(Math.max(2, Math.min(10, raw)));
                }}
                className="w-20 bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
              />
              <span className="text-text-muted text-xs">
                attempts (loop ends early on pass)
              </span>
            </div>
            <label className="flex items-center gap-2 text-text-muted text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(e) => onAutoRunChange((e.target as HTMLInputElement).checked)}
                className="accent-accent"
              />
              <span>
                Auto-run all iterations
                <span className="text-text-dim"> — skip the pause between attempts</span>
              </span>
            </label>
            <p className="text-text-dim text-[11px]">
              Each iteration is one agent run + judge pass. With Auto-run off, the run pauses after every attempt so you can inspect the result and decide whether to continue or stop.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onRun}
              disabled={running || draft.goals.every((g) => !g.trim()) || !draft.description.trim()}
              className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {running ? "Running…" : run ? "Run again" : "Run eval"}
            </button>
            {run && run.status !== "error" && (
              <button
                onClick={onJumpToDirective}
                className="text-text-muted text-xs hover:text-text underline-offset-2 hover:underline"
              >
                Edit directive
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <label className="text-text-muted text-xs uppercase tracking-wide">Result</label>
          {errorMessage && (
            <div className="text-red text-sm border-l-2 border-red pl-3">{errorMessage}</div>
          )}
          {!run && !iteration && !errorMessage && (
            <div className="text-text-muted text-sm">
              Click <span className="text-text font-medium">Run eval</span> to test against your goals.{" "}
              {autoRun
                ? "Auto-run on — the full loop will play through without pausing."
                : "Run pauses after each iteration so you can decide whether to continue."}
            </div>
          )}
          {/* In-flight iteration view: shown between the first event
              landing and the done event finalizing. The user inspects
              this iteration's verdict + suggestions and decides to
              continue or stop. */}
          {!run && iteration && (
            <IterationPane
              iteration={iteration}
              running={running}
              autoRun={autoRun}
              onContinue={onContinue}
              onStop={onStop}
              acceptedEditIds={new Set(state.acceptedEdits.map((e) => e.id))}
              onToggleAccept={toggleAcceptEdit}
            />
          )}
          {/* Final run view (done event delivered): same panel as
              before, no behaviour change for batch-mode callers. */}
          {run && (
            <VerifyRunPane
              run={run}
              acceptedEditIds={new Set(state.acceptedEdits.map((e) => e.id))}
              onToggleAccept={toggleAcceptEdit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// makeBlankDraftEval — seed an empty draft when the template
// didn't ship one and the operator clicks "+ Add an eval".
// Description default is a one-line hint so the textarea isn't
// blank-staring at the operator; one empty goal slot opens the
// list editor.
function makeBlankDraftEval(): DraftEval {
  return {
    name: "My first eval",
    description: "",
    goals: [""],
    mocks: [],
    max_turns: 5,
  };
}

// derivedDescriptionFromTrigger renders a legacy trigger blob into
// the natural-language description the new wizard wants. Server
// already does this for stored rows; templates loaded over the
// wire that still ship `trigger` (and no description) get the
// same treatment here so the editor never lands on an empty
// textarea for a template that has data.
function derivedDescriptionFromTrigger(trg?: EvalMockTrigger): string {
  if (!trg || !trg.type) return "";
  const p = (trg.payload || {}) as Record<string, any>;
  switch (trg.type) {
    case "chat_message": {
      const parts = ["Incoming chat message"];
      if (p.from) parts.push(`from ${p.from}`);
      if (p.channel) parts.push(`in ${p.channel}`);
      return parts.join(" ") + (p.text ? `:\n${p.text}` : ".");
    }
    case "webhook":
      return "Incoming webhook event:\n" + JSON.stringify(p, null, 2);
    case "scheduled_tick":
      return `Scheduled tick at ${p.iso_time || "(unspecified)"}.`;
    default:
      return `Event of type ${trg.type}:\n` + JSON.stringify(p, null, 2);
  }
}

// Local alias so we don't need to re-import EvalTrigger now that
// it's purely a legacy compat shape.
type EvalMockTrigger = { type: string; payload?: Record<string, unknown> };

// composeDirective folds the operator's queued judge suggestions
// onto the base directive in stable order. Used in two places:
//   - runVerify → so the next preview measures what would actually
//     ship on Create.
//   - create() → so the persisted directive includes them.
function composeDirective(base: string, edits: { id: string; add: string }[]): string {
  let out = base;
  for (const e of edits) {
    const add = e.add.trim();
    if (!add) continue;
    if (!out.trim()) out = add;
    else out = out + "\n\n" + add;
  }
  return out;
}

// IterationPane renders the in-flight state between the runner's
// per-iteration emit and the final done event. Same structural
// pieces as VerifyRunPane (verdict, per-goal grid, suggestions
// with apply-checkboxes, trajectory) — plus the Continue/Stop row
// the operator drives the loop with.
//
// When `iteration.final` is true the runner is already collapsing
// to the done event; we keep the buttons hidden and show a
// "finalizing…" hint so the operator doesn't try to step a loop
// that's no longer parked.
//
// When autoRun is on we hide the buttons too (the runner is
// auto-driven by the onIteration handler in AgentNew) and surface
// a "auto-continuing…" line so the operator knows what's happening.
function IterationPane({
  iteration,
  running,
  autoRun,
  onContinue,
  onStop,
  acceptedEditIds,
  onToggleAccept,
}: {
  iteration: IterationEvent;
  running: boolean;
  autoRun: boolean;
  onContinue: () => void;
  onStop: () => void;
  acceptedEditIds?: Set<string>;
  onToggleAccept?: (sugg: DirectiveEditSuggestion) => void;
}) {
  const v = iteration.verdict;
  const isPass = v?.overall === "pass";
  const isFinal = iteration.final;
  const showControls = !isFinal && !autoRun && running;
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`px-3 py-2 rounded border text-sm ${
          isPass ? "border-green/40 bg-green/5 text-green" : "border-red/40 bg-red/5 text-red"
        }`}
      >
        Iteration {iteration.iteration} of {iteration.max_iterations} —{" "}
        {isPass ? "✓ Pass" : "✗ Fail"}
        {isFinal && (
          <span className="text-text-muted text-xs ml-2">— finalizing run…</span>
        )}
        {!isFinal && autoRun && (
          <span className="text-text-muted text-xs ml-2">— auto-continuing…</span>
        )}
      </div>

      {v && (
        <div className="flex flex-col gap-2">
          {v.reasoning && (
            <p className="text-text-muted text-xs italic">{v.reasoning}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {v.per_goal.map((g, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`inline-block w-3 h-3 rounded-full mt-1 shrink-0 ${
                    g.verdict === "pass" ? "bg-green" : "bg-red"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-text text-sm">{g.goal}</div>
                  <div className="text-text-muted text-xs mt-0.5">{g.why}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {iteration.suggestions?.directive_edits &&
        iteration.suggestions.directive_edits.length > 0 &&
        onToggleAccept && (
          <div className="border border-border rounded-md p-3 bg-bg-card flex flex-col gap-2">
            <div className="text-text-muted text-xs uppercase tracking-wide">
              Directive suggestions so far
            </div>
            <ul className="flex flex-col gap-2 mt-1">
              {iteration.suggestions.directive_edits.map((sugg) => {
                const accepted = acceptedEditIds?.has(sugg.id) ?? false;
                return (
                  <li key={sugg.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={() => onToggleAccept(sugg)}
                      className="mt-1 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-text text-sm whitespace-pre-wrap">{sugg.add}</div>
                      {sugg.reason && (
                        <div className="text-text-muted text-xs mt-0.5 italic">{sugg.reason}</div>
                      )}
                      {sugg.helped && (
                        <div className="text-green text-[11px] mt-0.5">✓ helped a later iteration pass</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

      {showControls && (
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onContinue}
            className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
          >
            Continue to iteration {iteration.iteration + 1}
          </button>
          <button
            onClick={onStop}
            className="px-3 py-2 text-text-muted text-sm hover:text-text border border-border rounded-lg"
          >
            Stop here
          </button>
        </div>
      )}

      <details className="text-text-muted text-xs">
        <summary className="cursor-pointer hover:text-text">
          Trajectory ({iteration.trajectory.turns.length} turn{iteration.trajectory.turns.length === 1 ? "" : "s"})
        </summary>
        <div className="mt-2 flex flex-col gap-1.5 max-h-96 overflow-y-auto font-mono">
          {iteration.trajectory.turns.map((turn, i) => {
            const isJudge = turn.role === "judge";
            const isSystem = turn.role === "system";
            return (
              <div
                key={i}
                className={`text-xs border-l-2 pl-2 ${
                  isJudge ? "border-amber" : isSystem ? "border-text-dim" : "border-border"
                }`}
              >
                <span className={isJudge ? "text-amber" : isSystem ? "text-text-dim" : "text-accent"}>
                  {turn.role.toUpperCase()}
                  {turn.iteration ? ` (iter ${turn.iteration})` : ""}
                </span>
                {turn.content && (
                  <span className="text-text ml-2 whitespace-pre-wrap">{turn.content}</span>
                )}
                {turn.tool_call && (
                  <span className="text-text ml-2">
                    {turn.tool_call.app}.{turn.tool_call.tool}
                    {turn.tool_call.warning && (
                      <span className="text-amber ml-1">[{turn.tool_call.warning}]</span>
                    )}
                    {turn.tool_call.error && (
                      <span className="text-red ml-1">error: {turn.tool_call.error}</span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

// VerifyRunPane renders the captured trajectory + per-goal
// verdicts + (in improvement mode) the judge's directive-edit
// suggestions with apply-checkboxes. acceptedEditIds is the
// caller's queue of already-accepted suggestion ids so the
// checkboxes render in the right state across re-renders.
function VerifyRunPane({
  run,
  acceptedEditIds,
  onToggleAccept,
}: {
  run: EvalRun;
  acceptedEditIds?: Set<string>;
  onToggleAccept?: (sugg: DirectiveEditSuggestion) => void;
}) {
  const isPass = run.status === "pass";
  const isError = run.status === "error";
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`px-3 py-2 rounded border text-sm ${
          isPass
            ? "border-green/40 bg-green/5 text-green"
            : isError
              ? "border-amber/40 bg-amber/5 text-amber"
              : "border-red/40 bg-red/5 text-red"
        }`}
      >
        {isPass ? "✓ Pass" : isError ? "⚠ Error" : "✗ Fail"}
        {run.duration_ms > 0 && (
          <span className="text-text-muted text-xs ml-2">
            — {(run.duration_ms / 1000).toFixed(1)}s
            {run.iterations_used > 1 && ` · ${run.iterations_used} iteration${run.iterations_used === 1 ? "" : "s"}`}
            {`, ${run.turns_used} turn${run.turns_used === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      {run.error_message && (
        <div className="text-amber text-xs border-l-2 border-amber pl-3 whitespace-pre-wrap">
          {run.error_message}
        </div>
      )}

      {run.verdict && (
        <div className="flex flex-col gap-2">
          {run.verdict.reasoning && (
            <p className="text-text-muted text-xs italic">{run.verdict.reasoning}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {run.verdict.per_goal.map((g, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`inline-block w-3 h-3 rounded-full mt-1 shrink-0 ${
                    g.verdict === "pass" ? "bg-green" : "bg-red"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-text text-sm">{g.goal}</div>
                  <div className="text-text-muted text-xs mt-0.5">{g.why}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions — only shown when the run gathered any across
          its iterations. Each directive edit gets a checkbox the
          operator toggles to queue it into the wizard's
          acceptedEdits state. */}
      {run.suggestions?.directive_edits && run.suggestions.directive_edits.length > 0 && onToggleAccept && (
        <div className="border border-border rounded-md p-3 bg-bg-card flex flex-col gap-2">
          <div className="text-text-muted text-xs uppercase tracking-wide">
            Directive suggestions
          </div>
          <p className="text-text-dim text-[11px]">
            The judge proposed these edits to help the agent pass. Check the ones you want appended to the directive on Create.
          </p>
          <ul className="flex flex-col gap-2 mt-1">
            {run.suggestions.directive_edits.map((sugg) => {
              const accepted = acceptedEditIds?.has(sugg.id) ?? false;
              return (
                <li key={sugg.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={() => onToggleAccept(sugg)}
                    className="mt-1 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-text text-sm whitespace-pre-wrap">{sugg.add}</div>
                    {sugg.reason && (
                      <div className="text-text-muted text-xs mt-0.5 italic">{sugg.reason}</div>
                    )}
                    {sugg.helped && (
                      <div className="text-green text-[11px] mt-0.5">✓ helped a later iteration pass</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <details className="text-text-muted text-xs">
        <summary className="cursor-pointer hover:text-text">
          Trajectory ({run.trajectory.turns.length} turn{run.trajectory.turns.length === 1 ? "" : "s"})
        </summary>
        <div className="mt-2 flex flex-col gap-1.5 max-h-96 overflow-y-auto font-mono">
          {run.trajectory.turns.map((turn, i) => {
            const isJudge = turn.role === "judge";
            const isSystem = turn.role === "system";
            return (
              <div
                key={i}
                className={`text-xs border-l-2 pl-2 ${
                  isJudge
                    ? "border-amber"
                    : isSystem
                      ? "border-text-dim"
                      : "border-border"
                }`}
              >
                <span className={isJudge ? "text-amber" : isSystem ? "text-text-dim" : "text-accent"}>
                  {turn.role.toUpperCase()}
                  {turn.iteration ? ` (iter ${turn.iteration})` : ""}
                </span>
                {turn.content && (
                  <span className="text-text ml-2 whitespace-pre-wrap">{turn.content}</span>
                )}
                {turn.tool_call && (
                  <span className="text-text ml-2">
                    {turn.tool_call.app}.{turn.tool_call.tool}
                    {turn.tool_call.warning && (
                      <span className="text-amber ml-1">[{turn.tool_call.warning}]</span>
                    )}
                    {turn.tool_call.error && (
                      <span className="text-red ml-1">error: {turn.tool_call.error}</span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

interface ReviewStepProps {
  state: WizardState;
  hasProvider: boolean | null;
  onEdit: (stepIdx: number) => void;
  // Per-app live status while the Create button is auto-installing
  // required apps. Empty until create() kicks off; one entry per
  // app slug while the cascade runs.
  installProgress: Record<string, string>;
}

function ReviewStep({ state, hasProvider, onEdit, installProgress }: ReviewStepProps) {
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
        <Row label="Directive"   value={directivePreview} multiline       onEdit={() => onEdit(1)} />
        <Row label="Mode"        value={state.mode}                       onEdit={() => onEdit(1)} />
        <Row label="Background"  value={state.unconscious ? "On (unconscious thread)" : "Off (stateless)"} onEdit={() => onEdit(1)} />
        {state.recommendedApps.length > 0 && (
          <Row
            label="Recommended apps"
            value={state.recommendedApps.join(", ")}
            hint="Install these later from the Apps page if you don't have them already."
            onEdit={() => onEdit(0)}
          />
        )}
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
// short text pill with the slug initials. The row caps at 5 icons
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

// LogoPill renders a single resolved-logo entry. The registry's icon
// URLs aren't all live (most apteva apps don't have an icon.png
// committed yet), so we attempt the <img> and fall back to text
// initials on load error. The fallback styling mirrors the no-url
// path so a missing icon doesn't reflow the row.
function LogoPill({
  logo,
  isApp,
}: {
  logo: import("../api").TemplateLogo;
  isApp: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!logo.icon_url && !imgFailed;
  return (
    <span
      title={
        isApp
          ? `${logo.label} — local Apteva app`
          : `${logo.label}${logo.source === "derived" ? ` (via ${logo.via})` : ""}`
      }
      className={`inline-flex items-center justify-center w-5 h-5 rounded-sm overflow-hidden ${
        isApp ? "bg-accent/10 ring-1 ring-accent/40 p-0.5" : "bg-bg"
      } ${logo.source === "derived" ? "opacity-60" : ""}`}
    >
      {showImg ? (
        <img
          src={logo.icon_url}
          alt=""
          className="w-full h-full object-contain"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className={`text-[8px] leading-none ${isApp ? "text-accent" : "text-text-muted"}`}>
          {(logo.label || logo.slug).slice(0, 2).toUpperCase()}
        </span>
      )}
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
