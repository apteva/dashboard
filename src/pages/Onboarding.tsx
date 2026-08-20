import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  auth,
  instances,
  integrations,
  runtimeEntryAsAppDetail,
  type RuntimeCatalogEntry,
} from "../api";
import { CredentialFields } from "../components/integrations/CredentialFields";
import { defaultIntegrationAuthType } from "../utils/integrationAuth";
import { useAuth } from "../hooks/useAuth";
import { useTheme, type ThemeMode } from "../hooks/useTheme";
import { usePageTitle } from "../hooks/usePageTitle";
import { ProjectPresetSetup } from "../components/projects/ProjectPresetSetup";

// Welcome flow gated on users.onboarded_at being NULL (see
// <OnboardingGate> in App.tsx). Skip is allowed at every step; the
// "Finish" button on the last step calls /auth/onboarding/complete,
// which stamps onboarded_at and lets the user into the dashboard.

export const ONBOARDING_STEP_IDS = ["theme", "setup", "provider"] as const;
type StepId = (typeof ONBOARDING_STEP_IDS)[number];

export async function activateOnboardingPresetAgents(
  agentIds: number[],
  startAgent: (id: number) => Promise<unknown> = instances.start,
) {
  const results = await Promise.allSettled(agentIds.map((id) => startAgent(id)));
  const started = results.filter((result) => result.status === "fulfilled").length;
  return { started, failed: results.length - started };
}

interface StepDef {
  id: StepId;
  // Whether the step exposes an explicit "Skip" link in addition to
  // its primary CTA. A step has no skip if there's nothing to opt out
  // of (theme always has a default).
  canSkip: boolean;
}

const STEPS: StepDef[] = [
  { id: "theme", canSkip: false },
  { id: "setup", canSkip: true },
  { id: "provider", canSkip: true },
];

export function Onboarding() {
  const [stepIdx, setStepIdx] = useState(0);
  usePageTitle("Onboarding");
  const [finishing, setFinishing] = useState(false);
  // providerAdded — flipped by ProviderStep when it successfully
  // saves a key. Drives the post-onboarding redirect: with a provider,
  // the user can usefully build an agent next, so we route to the
  // /agents/new wizard. Without one, we route to / and let them poke
  // around the dashboard first.
  const [providerAdded, setProviderAdded] = useState(false);
  const [setupApplied, setSetupApplied] = useState(false);
  const [presetAgentsToStart, setPresetAgentsToStart] = useState<number[]>([]);
  const [activationMessage, setActivationMessage] = useState("");
  const navigate = useNavigate();
  const { refresh, user } = useAuth();

  // Belt-and-braces: the gate already bounces onboarded users back to
  // /, but a manual visit to /onboarding from the URL bar would render
  // this page anyway. Send them home.
  useEffect(() => {
    if (user && user.onboarded) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const step = STEPS[stepIdx]!;
  const isLast = stepIdx === STEPS.length - 1;

  const activatePresetAgents = async () => {
    if (presetAgentsToStart.length === 0) return;
    setActivationMessage("Starting your new agents…");
    const { started, failed } = await activateOnboardingPresetAgents(presetAgentsToStart);
    setPresetAgentsToStart([]);
    setActivationMessage(
      failed === 0
        ? `${started} preset agent${started === 1 ? " is" : "s are"} online.`
        : `${started} preset agent${started === 1 ? " is" : "s are"} online; ${failed} still need attention.`,
    );
  };

  const advance = async () => {
    if (!isLast) {
      setStepIdx(stepIdx + 1);
      return;
    }
    setFinishing(true);
    // If the operator saved a provider during onboarding, drop them
    // straight into the build-an-agent wizard. Otherwise the
    // dashboard's empty state with its "Build your first agent →"
    // CTA is a fine landing — they can come back when they're ready
    // to wire up an LLM key.
    const dest = setupApplied ? "/" : providerAdded ? "/agents/new" : "/";
    try {
      await auth.completeOnboarding();
      await refresh();
      navigate(dest, { replace: true });
    } catch {
      // Best-effort: even if the server call fails, still let the user
      // through. They'll re-onboard on next reload, which is annoying
      // but better than wedging them on this page.
      navigate(dest, { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-text text-3xl font-bold">Welcome to Apteva</h1>
          <p className="text-text-muted text-base mt-2">
            A couple of quick choices and you're ready to go.
          </p>
        </div>

        <Progress current={stepIdx} total={STEPS.length} />

        <div className="border border-border rounded-lg p-8 bg-bg-card mt-6">
          {step.id === "theme" && <ThemeStep />}
          {step.id === "setup" && (
            <ProjectPresetSetup
              onApplied={(result) => {
                setSetupApplied(true);
                setPresetAgentsToStart(
                  result.createdAgents
                    .filter((agent) => agent.status !== "running")
                    .map((agent) => agent.id),
                );
              }}
            />
          )}
          {step.id === "provider" && (
            <>
              <ProviderStep
                setupReady={setupApplied}
                onSaved={async () => {
                  setProviderAdded(true);
                  await activatePresetAgents();
                }}
              />
              {activationMessage && (
                <div className="mt-4 text-sm text-accent" role="status">{activationMessage}</div>
              )}
            </>
          )}

          <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
            {step.canSkip ? (
              <button
                onClick={advance}
                disabled={finishing}
                className="text-text-muted text-sm hover:text-text transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={advance}
              disabled={finishing}
              className="px-5 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {finishing ? "…" : isLast ? "Finish" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Progress({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 w-12 rounded-full transition-colors ${
            i <= current ? "bg-accent" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function ThemeStep() {
  const { theme, mode, resolvedMode, setTheme, setMode } = useTheme();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">Pick a theme</h2>
        <p className="text-text-muted text-sm mt-1">
          Changes apply instantly. You can switch later in Settings → Appearance.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ThemeCard
          label="Terminal"
          description="Monospace, sharp corners, a workshop look. The default."
          selected={theme === "terminal"}
          onSelect={() => setTheme("terminal")}
        />
        <ThemeCard
          label="Clean"
          description="Inter, rounded corners, subtle shadows. Boardroom-ready."
          selected={theme === "clean"}
          onSelect={() => setTheme("clean")}
        />
      </div>

      <div>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">Mode</h3>
        <div className="flex flex-wrap gap-2">
          {(["auto", "dark", "light"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                mode === m
                  ? "border-accent text-text bg-bg-card"
                  : "border-border text-text-muted hover:text-text hover:border-text-dim"
              }`}
            >
              {m === "auto" ? "Auto" : m === "dark" ? "Dark" : "Light"}
              {m === "auto" && (
                <span className="ml-2 text-text-dim text-xs">
                  (currently {resolvedMode})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`text-left border rounded-lg p-4 transition-colors ${
        selected
          ? "border-accent bg-bg-card"
          : "border-border hover:border-text-dim"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 rounded-full border ${
            selected ? "bg-accent border-accent" : "border-border"
          }`}
        />
        <span className="text-text font-medium">{label}</span>
      </div>
      <p className="text-text-muted text-xs leading-relaxed">{description}</p>
    </button>
  );
}

// isTypeableRuntimeEntry — onboarding only offers providers the operator
// can connect by pasting a key. OAuth and device-code flows need a popup
// and a round trip, which is more than a first-run screen should ask for;
// they stay available in Settings.
export function isTypeableRuntimeEntry(entry: RuntimeCatalogEntry): boolean {
  if ((entry.credential_fields || []).length === 0) return false;
  const authType = defaultIntegrationAuthType(runtimeEntryAsAppDetail(entry));
  return authType !== "oauth2" && authType !== "oauth1" && authType !== "oauth_device_code";
}

function ProviderStep({
  setupReady,
  onSaved,
}: {
  setupReady?: boolean;
  onSaved?: () => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<RuntimeCatalogEntry[]>([]);
  const [selected, setSelected] = useState<RuntimeCatalogEntry | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // The server filters to runtime-capable apps; asking for the whole
    // catalog and filtering here would pull 600+ entries on first run.
    integrations
      .runtimeCatalog("llm")
      .then((all) => {
        const typeable = all.filter(isTypeableRuntimeEntry);
        setEntries(typeable);
        if (typeable.length > 0) setSelected(typeable[0] ?? null);
      })
      .catch(() => setEntries([]));
  }, []);

  const onSave = async () => {
    if (!selected) return;
    const trimmed: Record<string, string> = {};
    for (const field of selected.credential_fields || []) {
      const value = (fields[field.name] || "").trim();
      if (value) trimmed[field.name] = value;
    }
    if (Object.keys(trimmed).length === 0) {
      setError("Paste a key to save.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      // Empty project_id = global scope; the user's auto-created
      // "Default" project picks it up via the unscoped fallback in
      // GetAllProviderEnvVars.
      //
      // auto_mcp stays off: this credential exists to back the agent
      // runtime, and exposing the provider's REST tools to every agent
      // in the project is a separate decision the operator can make
      // later in Integrations.
      await integrations.connect(
        selected.slug,
        selected.name,
        trimmed,
        defaultIntegrationAuthType(runtimeEntryAsAppDetail(selected)) || "api_key",
        "",
        undefined,
        "integration",
        false,
      );
      setSaved(true);
      await onSaved?.();
    } catch (err: any) {
      setError(err?.message || "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">
          {setupReady ? "Bring your agents online" : "Add an LLM provider key"}
        </h2>
        <p className="text-text-muted text-sm mt-1">
          {setupReady
            ? "Your workspace is ready. Connect a model to start its agents — you can change providers later in Settings."
            : "Your agents need a model to think with. Paste a key from a provider — you can add or change keys later in Settings → Providers."}
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-text-muted text-sm">No providers available right now. You can configure one later.</p>
      ) : (
        <>
          <div>
            <label className="block text-text-muted text-sm mb-2">Provider</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {entries.map((entry) => (
                <button
                  key={entry.slug}
                  onClick={() => {
                    setSelected(entry);
                    setFields({});
                    setSaved(false);
                    setError("");
                  }}
                  className={`px-3 py-2 text-sm rounded border transition-colors ${
                    selected?.slug === entry.slug
                      ? "border-accent bg-bg-card text-text"
                      : "border-border text-text-muted hover:text-text hover:border-text-dim"
                  }`}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </div>

          {/* Same renderer every other integration uses, so the inputs
              carry the catalog's labels and descriptions. The old form
              labelled these with raw env var names ("ANTHROPIC_API_KEY")
              and guessed password-vs-text by string-matching "key",
              which rendered OPENAI_BASE_URL as a secret field. */}
          {selected && (
            <CredentialFields
              detail={runtimeEntryAsAppDetail(selected)}
              credentials={fields}
              setCredentials={(next) => {
                setFields(next);
                setSaved(false);
                setError("");
              }}
            />
          )}

          {error && <div className="text-red text-sm">{error}</div>}
          {saved && (
            <div className="text-accent text-sm">Saved — you're ready to continue.</div>
          )}

          {selected && !saved && (
            <button
              onClick={onSave}
              disabled={saving}
              className="self-start px-4 py-2 border border-accent text-accent rounded-lg text-sm font-bold hover:bg-bg-card transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save key"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
