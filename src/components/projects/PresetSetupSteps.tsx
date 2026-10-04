import { useState } from "react";
import type { ProjectPresetSetupProgress, ProjectPresetSetupStep } from "../../api";

export function PresetSetupSteps({ steps, progress, retry }: {
  steps?: ProjectPresetSetupStep[];
  progress?: ProjectPresetSetupProgress[];
  retry?: (keys: string[]) => void;
}) {
  const [confirmed, setConfirmed] = useState<string[]>([]);
  if (!steps?.length) return null;
  return <section className="min-w-0 space-y-3" aria-label="Included app content">
    <h3 className="text-sm font-semibold text-text">Included app content <span className="font-normal text-text-dim">· {steps.length} items</span></h3>
    {!progress?.length && <p className="text-xs text-text-muted">Created when you apply this preset. Open and edit it in the corresponding app.</p>}
    <ol className="divide-y divide-border rounded-lg border border-border">
      {steps.map((step, index) => {
        const state = progress?.find((item) => item.key === step.key);
        return <li key={step.key} className="space-y-1 p-3 text-xs">
          <div className="flex items-start gap-2"><span className="text-text-dim">{index + 1}.</span><span className="min-w-0 flex-1 break-words font-medium">{step.title || step.tool}</span>{state && <span className={`shrink-0 ${state.status === "completed" ? "text-green" : "text-text-muted"}`}>{state.status === "uncertain" ? "Check app" : state.status}</span>}</div>
          {step.description && <p className="break-words leading-5 text-text-muted">{step.description}</p>}
          <p className="text-text-dim">In <span className="capitalize">{step.app.replace(/-/g, " ")}</span>{step.min_app_version && <span> · Requires {step.min_app_version} or newer</span>}</p>
          {state?.error && <p role="status" className="break-words text-text-muted">{state.error}</p>}
          {state?.status === "uncertain" && retry && <div className="space-y-2 pt-2">
            <label className="flex items-start gap-2 text-text-muted"><input type="checkbox" checked={confirmed.includes(step.key)} onChange={(event) => setConfirmed((current) => event.target.checked ? [...current, step.key] : current.filter((key) => key !== step.key))} /><span>I checked this app. Retrying this step is safe and may create data again.</span></label>
            <button type="button" disabled={!confirmed.includes(step.key)} className="rounded-md border border-border px-3 py-2 text-text hover:bg-bg-hover disabled:opacity-50" onClick={() => { setConfirmed([]); retry([step.key]); }}>Retry this step and continue</button>
          </div>}
        </li>;
      })}
    </ol>
  </section>;
}
