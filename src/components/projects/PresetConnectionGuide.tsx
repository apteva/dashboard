import { useState } from "react";
import { apps, type AppRow, type PresetConnectionSetup } from "../../api";
import { AppDetailPanel } from "../apps/AppDetailPanel";

// Reuse the app's own connection/binding/settings UI, including during onboarding.
export function PresetConnectionGuide({ steps, projectId, compact = false, enabled = true }: {
  steps: PresetConnectionSetup[]; projectId?: string; compact?: boolean; enabled?: boolean;
}) {
  const [selected, setSelected] = useState<AppRow | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const open = async (name: string) => {
    if (busy || !projectId) return;
    setBusy(name); setError("");
    try {
      const rows = await apps.list(projectId);
      const app = rows.find((row) => row.name === name && row.project_id === projectId && row.install_id > 0)
        || rows.find((row) => row.name === name && !row.project_id && row.install_id > 0);
      if (!app) throw new Error("This app needs to be installed first. Retry setup or install it from Apps.");
      setSelected(app);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open app setup."); }
    finally { setBusy(""); }
  };
  if (!steps.length) return null;
  const content = <div className="space-y-3">
    {steps.map((step) => <div key={`${step.app}:${step.title}`} className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">{step.title}</h4><span className="text-[10px] text-text-dim">{step.required ? "Required for this workflow" : "When needed"}</span></div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">{step.description}</p>
      {enabled && <button type="button" disabled={!!busy || !projectId} onClick={() => void open(step.app)} className="mt-2 min-h-9 rounded-md border border-border px-3 text-xs text-accent disabled:opacity-50">{busy === step.app ? "Opening…" : "Configure " + step.app}</button>}
    </div>)}
    {error && <p role="alert" className="text-xs text-red">{error}</p>}
  </div>;
  return <>
    {compact ? <details className="mt-2 rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs text-text-muted">Connection setup</summary><div className="mt-3">{content}</div></details>
      : <section aria-label="Connections and setup" className="space-y-3"><h3 className="text-sm font-semibold">Connections and setup</h3><p className="text-xs text-text-muted">{enabled ? "Configure these apps now, or finish setup and return later. Access and permissions are managed by each app." : "These apps may need accounts or configuration after installation. You can do this now after creating the setup, or later."}</p>{content}</section>}
    <AppDetailPanel open={!!selected} mode="installed" install={selected || undefined} onClose={() => setSelected(null)} />
  </>;
}
