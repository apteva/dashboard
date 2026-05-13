import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  agentTemplates,
  apps as appsAPI,
  evals as evalsAPI,
  instances,
  integrations as integrationsAPI,
  providers,
  type AgentTemplate,
  type AppRow,
  type ConnectionInfo,
  type EvalMock,
  type EvalRun,
  type EvalTrigger,
  type MarketplaceEntry,
} from "../api";
import { useProjects } from "../hooks/useProjects";

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

type StepId = "template" | "details" | "behavior" | "setup" | "verify" | "review";

const STEPS: { id: StepId; label: string }[] = [
  { id: "template", label: "Template" },
  { id: "details",  label: "Details" },
  { id: "behavior", label: "Behavior" },
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

interface DraftEval {
  // Seeded from the template's suggested_evals[0] when the operator
  // picks a template in step 1. Goals are editable as plain text;
  // trigger + mocks are surfaced read-only for PR-1 (PR-2 adds
  // structured editors).
  name: string;
  trigger: EvalTrigger;
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
  // Verify-step draft. null when the template has no suggested
  // evals or before any template is picked.
  draftEval: DraftEval | null;
}

const INITIAL: WizardState = {
  templateID: null,
  name: "",
  directive: "",
  mode: "learn",
  unconscious: true,
  includeAptevaServer: true,
  includeChannels: true,
  recommendedApps: [],
  draftEval: null,
};

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

  // Verify step state. verifyRun is the last preview run's result;
  // verifyRunning gates the Run button; verifyError surfaces
  // network / runner failures distinct from a fail-verdict (a fail
  // verdict is a successful run with red goals).
  const [verifyRun, setVerifyRun] = useState<EvalRun | null>(null);
  const [verifyRunning, setVerifyRunning] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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
        return true;
      case "behavior":
        if (!state.includeAptevaServer && !state.includeChannels) {
          setError("Pick at least one system MCP. Without channels or the apteva gateway, the agent can't reply to anything or see its own state.");
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  // runVerify drives one preview-eval call against the current
  // wizard state. The Verify step component calls this when the
  // operator clicks Run. We swallow non-network errors into
  // verifyError so the UI can render them inline (auth-style
  // problems land here; the run itself surfaces fail verdicts
  // through verifyRun.status='fail').
  const runVerify = async () => {
    if (!state.draftEval) return;
    setVerifyRunning(true);
    setVerifyError(null);
    setVerifyRun(null);
    try {
      const result = await evalsAPI.preview({
        directive: state.directive,
        name: state.name,
        project_id: currentProject?.id,
        eval: {
          name: state.draftEval.name,
          trigger: state.draftEval.trigger,
          goals: state.draftEval.goals,
          mocks: state.draftEval.mocks,
          max_turns: state.draftEval.max_turns,
        },
      });
      setVerifyRun(result);
    } catch (e: any) {
      setVerifyError(e?.message || "Eval preview failed.");
    } finally {
      setVerifyRunning(false);
    }
  };

  const applyTemplate = (t: AgentTemplate) => {
    // Seed the Verify step's draft eval from the template's first
    // suggested_eval if it has one. Goals are editable as plain
    // text in the step; trigger + mocks are read-only for PR-1.
    const firstSuggested = t.suggested_evals?.[0];
    const draftEval: DraftEval | null = firstSuggested
      ? {
          name: firstSuggested.name,
          trigger: firstSuggested.trigger,
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
      const created = await instances.create(
        state.name.trim(),
        state.directive,
        state.mode,
        currentProject?.id,
        startNow,
        {
          includeAptevaServer: state.includeAptevaServer,
          includeChannels: state.includeChannels,
          unconscious: state.unconscious,
          templateID: state.templateID || undefined,
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
          {step.id === "behavior" && (
            <BehaviorStep state={state} setState={setState} />
          )}
          {step.id === "setup" && (
            <SetupStep
              template={templates.find((t) => t.id === state.templateID) || null}
              installedApps={installedApps}
              marketplace={marketplace}
              connections={connections}
              onRefresh={refreshConnections}
            />
          )}
          {step.id === "verify" && (
            <VerifyStep
              state={state}
              setState={setState}
              run={verifyRun}
              running={verifyRunning}
              errorMessage={verifyError}
              onRun={runVerify}
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

function DetailsStep({ state, setState }: DetailsStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">Name + purpose</h2>
        <p className="text-text-muted text-sm mt-1">
          Name shows up everywhere — pick something you'd recognise on a chart. The directive is the agent's system prompt; it reads this on every wake-up.
        </p>
      </div>

      <div>
        <label className="block text-text-muted text-sm mb-2">Name</label>
        <input
          type="text"
          value={state.name}
          onChange={(e) =>
            setState((s) => ({ ...s, name: (e.target as HTMLInputElement).value }))
          }
          className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Inbox triage"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="block text-text-muted text-sm mb-2">Directive</label>
        <textarea
          value={state.directive}
          onChange={(e) =>
            setState((s) => ({
              ...s,
              directive: (e.target as HTMLTextAreaElement).value,
            }))
          }
          rows={10}
          className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono leading-relaxed focus:outline-none focus:border-accent resize-y"
          placeholder="What should this agent do? What's its rhythm? When should it ask before acting?"
          spellCheck={false}
        />
        <p className="text-text-muted text-xs mt-2">
          This is exactly what the agent reads at the top of its context every iteration. Write it in second person ("You are…").
        </p>
      </div>
    </div>
  );
}

interface BehaviorStepProps {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

function BehaviorStep({ state, setState }: BehaviorStepProps) {
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">Behavior</h2>
        <p className="text-text-muted text-sm mt-1">
          How careful the agent is, whether it remembers across sessions, and what system tools it has access to.
        </p>
      </div>

      <div>
        <label className="block text-text-muted text-sm mb-3">Safety mode</label>
        <div className="grid grid-cols-1 gap-2">
          {modes.map((m) => (
            <label
              key={m.id}
              className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                state.mode === m.id
                  ? "border-accent bg-bg-card"
                  : "border-border hover:border-text-dim"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value={m.id}
                checked={state.mode === m.id}
                onChange={() => setState((s) => ({ ...s, mode: m.id }))}
                className="mt-1"
              />
              <div>
                <div className="text-text font-medium">{m.label}</div>
                <div className="text-text-muted text-xs leading-relaxed mt-1">{m.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-6">
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
            <div className="text-text font-medium">Background memory (unconscious)</div>
            <div className="text-text-muted text-xs leading-relaxed mt-1">
              Spawns a second background thread that consolidates main's activity into typed memories — preferences, decisions, names, open questions — so the agent remembers across sessions. Off if you'd rather it stay stateless.
            </div>
          </div>
        </label>
      </div>

      <div className="border-t border-border pt-6">
        <label className="block text-text-muted text-sm mb-2">System MCPs</label>
        <p className="text-text-muted text-xs mb-3">
          Most agents need at least one of these. Unchecking both leaves the agent with no way to reply or introspect.
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={state.includeChannels}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  includeChannels: (e.target as HTMLInputElement).checked,
                }))
              }
              className="mt-1"
            />
            <div>
              <div className="text-text">Channels (chat + email + Slack delivery)</div>
              <div className="text-text-muted text-xs">Without this, the agent can't respond to anything.</div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={state.includeAptevaServer}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  includeAptevaServer: (e.target as HTMLInputElement).checked,
                }))
              }
              className="mt-1"
            />
            <div>
              <div className="text-text">Apteva (introspection + self-management)</div>
              <div className="text-text-muted text-xs">Lets the agent see its own threads, telemetry, and configured providers.</div>
            </div>
          </label>
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
  onRefresh: () => void;
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
  onRefresh,
}: SetupStepProps) {
  if (!template) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-text text-lg font-bold">Setup</h2>
        <p className="text-text-muted text-sm">
          Pick a template first to see what apps and integrations the agent needs.
        </p>
      </div>
    );
  }

  const requirements = template.requirements || [];
  const installedSlugs = new Set(installedApps.map((a) => a.name));
  const marketplaceByName: Record<string, MarketplaceEntry> = {};
  for (const m of marketplace) marketplaceByName[m.name] = m;
  // Index connections by their app slug so requirement-checks are O(1).
  const connectionsBySlug: Record<string, ConnectionInfo[]> = {};
  for (const c of connections) {
    (connectionsBySlug[c.app_slug] ??= []).push(c);
  }

  const apps = requirements.filter((r) => r.kind === "app");
  const ints = requirements.filter((r) => r.kind === "integration");
  const optionalCount = requirements.filter((r) => !r.required).length;
  const missingIntegrations = ints.filter(
    (r) =>
      r.required &&
      !(r.compatible_slugs || []).some((slug) => connectionsBySlug[slug]?.length),
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-text text-lg font-bold">Setup</h2>
        <p className="text-text-muted text-sm mt-1">
          Apps and integrations this template uses. Required apps install automatically when the agent is created. Required integrations need a one-time connection.
        </p>
      </div>

      {apps.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-text-muted text-xs uppercase tracking-wide">Apps</h3>
          <ul className="flex flex-col gap-1.5">
            {apps.map((r) => {
              const alreadyInstalled = !!r.slug && installedSlugs.has(r.slug);
              const inMarketplace = !!r.slug && !!marketplaceByName[r.slug];
              const status = alreadyInstalled
                ? "Installed"
                : inMarketplace
                  ? r.required
                    ? "Will be installed"
                    : "Available"
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
          </ul>
        </div>
      )}

      {ints.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-text-muted text-xs uppercase tracking-wide flex items-center gap-2">
            Integrations
            <button
              onClick={onRefresh}
              className="text-accent text-[10px] hover:underline normal-case"
              title="I just connected an integration — re-check"
            >
              ↻ Refresh
            </button>
          </h3>
          <ul className="flex flex-col gap-1.5">
            {ints.map((r) => {
              const slugs = r.compatible_slugs || [];
              const match = slugs.find((s) => connectionsBySlug[s]?.length);
              const ok = !!match;
              return (
                <RequirementRow
                  key={`int-${slugs.join(",")}`}
                  label={
                    ok
                      ? `${match} connected`
                      : `${slugs.join(" / ")} — not connected`
                  }
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
        </div>
      )}

      {missingIntegrations.length > 0 && (
        <div className="text-xs text-amber border-l-2 border-amber pl-3">
          {missingIntegrations.length} required integration{missingIntegrations.length === 1 ? "" : "s"} not connected.
          You can skip this step — Verify will run with mocked tool responses — but the live agent won't be able to call them until they're set up.
        </div>
      )}

      {optionalCount > 0 && (
        <p className="text-text-muted text-xs">
          {optionalCount} optional requirement{optionalCount === 1 ? "" : "s"} above. You can connect these later from the agent's detail page.
        </p>
      )}

      {requirements.length === 0 && (
        <p className="text-text-muted text-sm">
          This template has no apps or integrations to set up. Continue to Verify.
        </p>
      )}
    </div>
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
  onRun: () => void;
  onJumpToDirective: () => void;
}

// VerifyStep renders the wizard's preflight eval. Three states:
//   - No template selected, or template has no suggested_evals →
//     prompt with a skip-button. Empty agents legitimately skip.
//   - Draft eval present, never run → goals editor + Run button.
//   - Last run available → trajectory pane + per-goal verdicts +
//     iteration controls (Edit directive / Run again).
function VerifyStep({
  state,
  setState,
  run,
  running,
  errorMessage,
  onRun,
  onJumpToDirective,
}: VerifyStepProps) {
  const draft = state.draftEval;
  if (!draft) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-text text-lg font-bold">Verify</h2>
        <p className="text-text-muted text-sm">
          This template doesn't ship a starter eval, so there's nothing to run here. You can add evals from the agent's detail page after creation.
        </p>
      </div>
    );
  }

  const setGoal = (i: number, value: string) => {
    setState((s) => {
      if (!s.draftEval) return s;
      const goals = s.draftEval.goals.slice();
      goals[i] = value;
      return { ...s, draftEval: { ...s.draftEval, goals } };
    });
  };
  const addGoal = () => {
    setState((s) => {
      if (!s.draftEval) return s;
      return { ...s, draftEval: { ...s.draftEval, goals: [...s.draftEval.goals, ""] } };
    });
  };
  const removeGoal = (i: number) => {
    setState((s) => {
      if (!s.draftEval) return s;
      const goals = s.draftEval.goals.filter((_, j) => j !== i);
      return { ...s, draftEval: { ...s.draftEval, goals } };
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-text text-lg font-bold">Verify</h2>
        <p className="text-text-muted text-sm mt-1">
          Run a starter eval against your draft agent before creating it. Edit the goals to match how you want it to behave, then click Run. Iterate until every goal is green.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-text-muted text-xs uppercase tracking-wide">Eval name</label>
            <div className="text-text text-sm mt-1">{draft.name}</div>
          </div>
          <div>
            <label className="text-text-muted text-xs uppercase tracking-wide">Trigger</label>
            <pre className="text-text text-xs mt-1 bg-bg-card border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono">
              {JSON.stringify(draft.trigger, null, 2)}
            </pre>
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
                    className="flex-1 bg-bg border border-border rounded p-2 text-text text-sm font-mono resize-y"
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
          </div>
          {draft.mocks.length > 0 && (
            <details className="text-text-muted text-xs">
              <summary className="cursor-pointer hover:text-text">
                {draft.mocks.length} mock{draft.mocks.length === 1 ? "" : "s"} (tool responses)
              </summary>
              <pre className="text-text-muted text-xs mt-2 bg-bg-card border border-border rounded p-3 overflow-x-auto font-mono">
                {JSON.stringify(draft.mocks, null, 2)}
              </pre>
            </details>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onRun}
              disabled={running || draft.goals.every((g) => !g.trim())}
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
          {!run && !errorMessage && (
            <div className="text-text-muted text-sm">
              Click <span className="text-text font-medium">Run eval</span> to test the directive against the goals. ~10-20 seconds; one LLM call as the agent, one as the judge.
            </div>
          )}
          {run && <VerifyRunPane run={run} />}
        </div>
      </div>
    </div>
  );
}

// VerifyRunPane renders the captured trajectory + per-goal
// verdicts. Same component is reused on the agent detail page for
// past-run inspection.
function VerifyRunPane({ run }: { run: EvalRun }) {
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
          <span className="text-text-muted text-xs ml-2">— {(run.duration_ms / 1000).toFixed(1)}s, {run.turns_used} turn{run.turns_used === 1 ? "" : "s"}</span>
        )}
      </div>

      {run.error_message && (
        <div className="text-amber text-xs border-l-2 border-amber pl-3">{run.error_message}</div>
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

      <details className="text-text-muted text-xs">
        <summary className="cursor-pointer hover:text-text">Trajectory ({run.trajectory.turns.length} turns)</summary>
        <div className="mt-2 flex flex-col gap-1.5 max-h-96 overflow-y-auto font-mono">
          {run.trajectory.turns.map((turn, i) => (
            <div key={i} className="text-xs border-l-2 border-border pl-2">
              <span className="text-accent">{turn.role.toUpperCase()}</span>
              {turn.content && <span className="text-text ml-2 whitespace-pre-wrap">{turn.content}</span>}
              {turn.tool_call && (
                <span className="text-text ml-2">
                  {turn.tool_call.app}.{turn.tool_call.tool}
                  {turn.tool_call.warning && <span className="text-amber ml-1">[{turn.tool_call.warning}]</span>}
                </span>
              )}
            </div>
          ))}
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
        <Row label="Mode"        value={state.mode}                       onEdit={() => onEdit(2)} />
        <Row label="Background"  value={state.unconscious ? "On (unconscious thread)" : "Off (stateless)"} onEdit={() => onEdit(2)} />
        <Row
          label="System MCPs"
          value={
            [
              state.includeChannels && "channels",
              state.includeAptevaServer && "apteva",
            ]
              .filter(Boolean)
              .join(", ") || "none"
          }
          onEdit={() => onEdit(2)}
        />
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
