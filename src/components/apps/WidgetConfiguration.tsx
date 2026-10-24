import { useCallback, useState, type ReactNode } from "react";
import { Modal } from "../Modal";
import { WidgetSettingsEditor } from "./WidgetSettingsEditor";
import {
  settingErrors,
  settingProperties,
  settingsDefaults,
  type WidgetSettingsUI,
} from "./widgetSettings";
import type { WidgetContext, WidgetRenderContext } from "./widgetContext";
interface Props {
  label: string;
  schema?: Record<string, unknown>;
  ui?: WidgetSettingsUI;
  settings: Record<string, unknown>;
  app?: string;
  installId?: number;
  projectId?: string;
  adding?: boolean;
  onClose: () => void;
  onSave: (settings: Record<string, unknown>) => Promise<unknown> | void;
  renderPreview?: (
    settings: Record<string, unknown>,
    context: WidgetRenderContext,
  ) => ReactNode;
  context?: WidgetContext;
}
const button =
  "min-h-10 rounded-lg border border-border px-4 text-sm text-text hover:border-accent disabled:opacity-40";
export function WidgetConfiguration({
  label,
  schema,
  ui,
  settings,
  app,
  installId,
  projectId,
  adding,
  onClose,
  onSave,
  renderPreview,
  context,
}: Props) {
  const [draft, setDraft] = useState(() => ({
    ...settingsDefaults(schema),
    ...structuredClone(settings),
  }));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [fieldStatus, setFieldStatus] = useState<Record<string, string>>({});
  const status = useCallback(
    (name: string, error: string) =>
      setFieldStatus((old) =>
        old[name] === error ? old : { ...old, [name]: error },
      ),
    [],
  );
  const schemaErrors = settingErrors(schema, draft);
  const steps = ui?.steps || [];
  const assigned = new Set(steps.flatMap((s) => s.fields));
  const remaining = Object.keys(settingProperties(schema)).filter(
    (name) => !assigned.has(name),
  );
  const currentFields = steps.length
    ? [...steps[step].fields, ...(step === steps.length - 1 ? remaining : [])]
    : undefined;
  const visibleFields = new Set(
    currentFields || Object.keys(settingProperties(schema)),
  );
  const blocked = Object.entries({
    ...schemaErrors,
    ...Object.fromEntries(Object.entries(fieldStatus).filter(([, v]) => v)),
  }).some(([name]) => visibleFields.has(name));
  const allBlocked =
    Object.keys(schemaErrors).length > 0 ||
    Object.values(fieldStatus).some(Boolean);
  const save = async () => {
    if (busy || allBlocked) return;
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save widget settings",
      );
      setBusy(false);
    }
  };
  return (
    <div className="relative z-[115]">
      <Modal
        open
        onClose={() => {
          if (!busy) onClose();
        }}
        ariaLabel={`${adding ? "Add" : "Configure"} ${label}`}
        width={preview ? "max-w-4xl" : "max-w-lg"}
      >
        <div className="flex max-h-[85dvh] w-full flex-col p-5">
          <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {adding ? "Add" : "Configure"} {label}
            </h2>
            <button
              type="button"
              aria-label="Close configuration"
              disabled={busy}
              onClick={onClose}
              className={button}
            >
              ×
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={preview ? "grid gap-6 md:grid-cols-2" : ""}>
              <div className="space-y-4">
                {!!steps.length && (
                  <p className="text-sm text-text-muted">
                    {step + 1} / {steps.length} · {steps[step].title}
                  </p>
                )}
                <WidgetSettingsEditor
                  schema={schema}
                  settings={draft}
                  ui={ui}
                  app={app}
                  installId={installId}
                  projectId={projectId}
                  onChange={setDraft}
                  fields={currentFields}
                  onFieldStatus={status}
                />
              </div>
              {preview && renderPreview && (
                <section aria-label="Configuration preview" className="min-w-0">
                  <p className="mb-3 text-xs text-text-muted">
                    Unsaved preview
                  </p>
                  <div className="pointer-events-none" inert>
                    {renderPreview(draft, {
                      context: {
                        ...(context || { scope: "project" }),
                        projectId,
                        configurationPreview: true,
                        hostForeground: false,
                      },
                      actions: { dispatch: () => {}, select: () => {} },
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red">
              {error}
            </p>
          )}
          <footer className="mt-5 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            {ui?.preview && renderPreview && (
              <button
                type="button"
                className={`${button} mr-auto`}
                onClick={() => setPreview((v) => !v)}
              >
                {preview ? "Hide preview" : "Preview"}
              </button>
            )}
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            {step > 0 && (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </button>
            )}
            {steps.length > 0 && step < steps.length - 1 ? (
              <button
                type="button"
                className={button}
                disabled={blocked}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className={`${button} border-accent bg-accent text-bg`}
                disabled={busy || allBlocked}
                onClick={save}
              >
                {busy ? "Saving…" : adding ? "Add" : "Save"}
              </button>
            )}
          </footer>
        </div>
      </Modal>
    </div>
  );
}
