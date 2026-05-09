import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, providerTypes, providers, type ProviderTypeInfo } from "../api";
import { useAuth } from "../hooks/useAuth";
import { useTheme, type ThemeMode } from "../hooks/useTheme";

// Welcome flow gated on users.onboarded_at being NULL (see
// <OnboardingGate> in App.tsx). Skip is allowed at every step; the
// "Finish" button on the last step calls /auth/onboarding/complete,
// which stamps onboarded_at and lets the user into the dashboard.

type StepId = "theme" | "provider";

interface StepDef {
  id: StepId;
  // Whether the step exposes an explicit "Skip" link in addition to
  // its primary CTA. A step has no skip if there's nothing to opt out
  // of (theme always has a default).
  canSkip: boolean;
}

const STEPS: StepDef[] = [
  { id: "theme", canSkip: false },
  { id: "provider", canSkip: true },
];

export function Onboarding() {
  const [stepIdx, setStepIdx] = useState(0);
  const [finishing, setFinishing] = useState(false);
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

  const advance = async () => {
    if (!isLast) {
      setStepIdx(stepIdx + 1);
      return;
    }
    setFinishing(true);
    try {
      await auth.completeOnboarding();
      await refresh();
      navigate("/", { replace: true });
    } catch {
      // Best-effort: even if the server call fails, still let the user
      // through. They'll re-onboard on next reload, which is annoying
      // but better than wedging them on this page.
      navigate("/", { replace: true });
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
          {step.id === "provider" && <ProviderStep />}

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

function ProviderStep() {
  const [types, setTypes] = useState<ProviderTypeInfo[]>([]);
  const [selected, setSelected] = useState<ProviderTypeInfo | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    providerTypes
      .list()
      .then((all) => {
        // Onboarding only offers credentialed LLM providers — that's the
        // minimum to make an agent run. Browser/embedding/integration
        // providers can wait for Settings → Providers.
        const llm = all
          .filter((t) => t.type === "llm" && t.requires_credentials)
          .sort((a, b) => a.sort_order - b.sort_order);
        setTypes(llm);
        if (llm.length > 0) setSelected(llm[0] ?? null);
      })
      .catch(() => setTypes([]));
  }, []);

  const onSave = async () => {
    if (!selected) return;
    const trimmed: Record<string, string> = {};
    for (const f of selected.fields) {
      const v = (fields[f] || "").trim();
      if (v) trimmed[f] = v;
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
      await providers.create(selected.type, selected.name, trimmed, selected.id, "");
      setSaved(true);
    } catch (err: any) {
      setError(err?.message || "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-text text-lg font-bold">Add an LLM provider key</h2>
        <p className="text-text-muted text-sm mt-1">
          Your agents need a model to think with. Paste a key from a provider — you can add or change keys later in Settings → Providers.
        </p>
      </div>

      {types.length === 0 ? (
        <p className="text-text-muted text-sm">No providers available right now. You can configure one later.</p>
      ) : (
        <>
          <div>
            <label className="block text-text-muted text-sm mb-2">Provider</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelected(t);
                    setFields({});
                    setSaved(false);
                    setError("");
                  }}
                  className={`px-3 py-2 text-sm rounded border transition-colors ${
                    selected?.id === t.id
                      ? "border-accent bg-bg-card text-text"
                      : "border-border text-text-muted hover:text-text hover:border-text-dim"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {selected?.fields.map((f) => (
            <div key={f}>
              <label className="block text-text-muted text-sm mb-2">{f}</label>
              <input
                type={f.toLowerCase().includes("key") ? "password" : "text"}
                value={fields[f] || ""}
                onChange={(e) => {
                  setFields({ ...fields, [f]: (e.target as HTMLInputElement).value });
                  setSaved(false);
                  setError("");
                }}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
                autoComplete="off"
                spellCheck={false}
                placeholder={f.toLowerCase().includes("key") ? "paste your key" : ""}
              />
            </div>
          ))}

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
