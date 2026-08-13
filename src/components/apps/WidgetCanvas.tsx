import { AppIcon } from "@apteva/ui-kit";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  reorderWidgetInstances,
  serializeWidgetInstances,
  useProjectUILayout,
  WidgetSettingsEditor,
  type WidgetInstance,
  type WidgetSize,
} from "./contributions";

export interface WidgetDefinition {
  key: string;
  label: string;
  description?: string;
  icon?: string;
  iconStyle?: "image" | "monochrome";
  supportedSizes: WidgetSize[];
  defaultSize: WidgetSize;
  defaultSettings?: Record<string, unknown>;
  settingsSchema?: Record<string, unknown>;
  suggested?: boolean;
  render: (instance: WidgetInstance) => ReactNode;
}

export function WidgetCanvas({
  projectId,
  slot,
  definitions,
  defaults = [],
  editing,
  onEditingChange,
  mergeLegacyDefaults = false,
  galleryRequest = 0,
  className = "grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2",
}: {
  projectId?: string | null;
  slot: string;
  definitions: WidgetDefinition[];
  defaults?: WidgetInstance[];
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  mergeLegacyDefaults?: boolean;
  galleryRequest?: number;
  className?: string;
}) {
  const { project, updateSurface, saveState } = useProjectUILayout(projectId);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [settingsID, setSettingsID] = useState<string | null>(null);
  useEffect(() => {
    if (galleryRequest > 0) setGalleryOpen(true);
  }, [galleryRequest]);
  const byKey = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions],
  );
  const explicit = Boolean(
    project.slots && Object.prototype.hasOwnProperty.call(project.slots, slot),
  );
  const stored = explicit && Array.isArray(project.slots?.[slot])
    ? normalizeStoredWidgets(project.slots?.[slot] || [], definitions)
    : serializeWidgetInstances(defaults);
  const configured = mergeLegacyDefaults && explicit &&
    stored.length > 0 && !stored.some((item) => item.component.startsWith("native:"))
    ? mergeLegacyWidgetDefaults(defaults, stored)
    : stored;
  const visible = configured.filter((instance) => byKey.has(instance.component));

  const persist = (next: WidgetInstance[]) => {
    if (!projectId) return;
    void updateSurface(slot, next);
  };
  const add = (definition: WidgetDefinition) => {
    persist([
      ...configured,
      {
        id: newWidgetID(definition.key),
        component: definition.key,
        size: definition.defaultSize,
        settings: { ...(definition.defaultSettings || {}) },
      },
    ]);
    setGalleryOpen(false);
  };
  const patchWidget = (id: string, patch: Partial<WidgetInstance>) =>
    persist(configured.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) => persist(configured.filter((item) => item.id !== id));
  const move = (id: string, target: string) =>
    persist(reorderWidgetInstances(configured, id, target));
  const activeSettings = settingsID
    ? configured.find((item) => item.id === settingsID)
    : undefined;
  const activeSettingsDefinition = activeSettings
    ? byKey.get(activeSettings.component)
    : undefined;

  return (
    <section className="space-y-3">
      {editing && (
        <div
          className="sticky top-0 z-30 flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card/95 px-3 py-2 shadow-md backdrop-blur"
          role="toolbar"
          aria-label="Layout editor"
        >
          <span className="text-[11px] font-bold uppercase tracking-wide text-accent">
            Editing layout
          </span>
          <span className={`text-[10px] ${saveState === "error" ? "text-red" : "text-text-dim"}`} aria-live="polite">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Could not save" : "Drag widgets to reorder"}
          </span>
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="ml-auto min-h-8 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-text hover:border-accent hover:text-accent"
          >
            Add widget
          </button>
          <button
            type="button"
            onClick={() => onEditingChange(false)}
            className="min-h-8 rounded-md border border-accent bg-accent px-3 py-1.5 text-[11px] font-bold text-bg hover:brightness-110"
          >
            Done
          </button>
        </div>
      )}

      {visible.length > 0 ? (
        <div className={className} data-widget-canvas={slot}>
          {visible.map((instance, index) => {
            const definition = byKey.get(instance.component)!;
            const sizes = definition.supportedSizes;
            return (
              <div
                key={instance.id}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => editing && event.preventDefault()}
                onDrop={() => {
                  if (editing && dragging) move(dragging, instance.id);
                  setDragging(null);
                }}
                className={`relative min-w-0 ${instance.size === "full" ? "xl:col-span-2" : ""} ${editing ? "flex h-full flex-col rounded-xl border border-dashed border-border p-1.5 transition-colors hover:border-accent/50" : ""} ${dragging === instance.id ? "border-accent opacity-55 ring-2 ring-accent/35" : ""}`}
                data-widget-id={instance.id}
                data-widget-editing={editing || undefined}
              >
                {editing && (
                  <div
                    className="mb-1.5 flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-bg-card px-2 py-1 shadow-sm"
                    data-widget-editor-controls
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(instance.id);
                      }}
                      className="hidden h-7 w-7 cursor-grab items-center justify-center rounded text-sm text-text-dim hover:bg-bg-hover hover:text-text active:cursor-grabbing sm:flex"
                      title="Drag to reorder"
                      aria-label={`Drag ${definition.label} to reorder`}
                    >
                      ⋮⋮
                    </button>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text">
                      {definition.label}
                    </span>
                    {sizes.length > 1 && (
                      <div className="flex items-center rounded-md border border-border bg-bg-subtle p-0.5" aria-label={`${definition.label} width`}>
                        {sizes.map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => patchWidget(instance.id, { size })}
                            aria-pressed={instance.size === size}
                            className={`min-h-7 rounded px-2 text-[10px] font-bold ${instance.size === size ? "bg-accent/15 text-accent" : "text-text-dim hover:bg-bg-hover hover:text-text"}`}
                          >
                            {size === "half" ? "Half" : "Full"}
                          </button>
                        ))}
                      </div>
                    )}
                    {definition.settingsSchema && (
                      <button
                        type="button"
                        onClick={() => setSettingsID(instance.id)}
                        className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-text-muted hover:bg-bg-hover hover:text-text"
                        aria-label={`Configure ${definition.label}`}
                      >
                        ⚙
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(instance.id, visible[index - 1]?.id || instance.id)}
                      className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-text-dim hover:bg-bg-hover disabled:opacity-25 sm:hidden"
                      aria-label={`Move ${definition.label} earlier`}
                    >↑</button>
                    <button
                      type="button"
                      disabled={index === visible.length - 1}
                      onClick={() => move(instance.id, visible[index + 1]?.id || instance.id)}
                      className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-text-dim hover:bg-bg-hover disabled:opacity-25 sm:hidden"
                      aria-label={`Move ${definition.label} later`}
                    >↓</button>
                    <button
                      type="button"
                      onClick={() => remove(instance.id)}
                      className="flex h-7 w-7 items-center justify-center rounded text-sm text-text-dim hover:bg-red/10 hover:text-red"
                      aria-label={`Remove ${definition.label}`}
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className={`min-w-0 ${editing ? "min-h-0 flex-1" : "h-full"}`}>
                  {definition.render(instance)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setGalleryOpen(true)}
          className="flex min-h-32 w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-dim hover:border-accent hover:text-accent"
        >
          Add your first widget
        </button>
      )}

      {galleryOpen && (
        <WidgetGallery
          definitions={definitions}
          configured={configured}
          onAdd={add}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {activeSettings && activeSettingsDefinition && (
        <WidgetSettingsDialog
          definition={activeSettingsDefinition}
          settings={activeSettings.settings || {}}
          onChange={(settings) => patchWidget(activeSettings.id, { settings })}
          onClose={() => setSettingsID(null)}
        />
      )}
    </section>
  );
}

function normalizeStoredWidgets(values: unknown[], definitions: WidgetDefinition[]): WidgetInstance[] {
  const byKey = new Map(definitions.map((item) => [item.key, item]));
  return values.flatMap((value, index) => {
    const legacy = typeof value === "string";
    if (!legacy && (!value || typeof value !== "object" || Array.isArray(value))) return [];
    const raw = legacy ? null : value as Partial<WidgetInstance>;
    const component = legacy ? value : raw?.component;
    if (typeof component !== "string") return [];
    const definition = byKey.get(component);
    const supported = definition?.supportedSizes || ["half"];
    const requested = raw?.size;
    const size = requested && supported.includes(requested)
      ? requested
      : definition?.defaultSize || "half";
    return [{
      id: raw?.id || `legacy:${index}:${component}`,
      component,
      size,
      settings: {
        ...(definition?.defaultSettings || {}),
        ...(raw?.settings || {}),
      },
    }];
  });
}

export function mergeLegacyWidgetDefaults(defaults: WidgetInstance[], stored: WidgetInstance[]) {
  if (defaults.length === 0) return stored;
  return [
    ...defaults.slice(0, -1),
    ...stored,
    defaults[defaults.length - 1],
  ];
}

function newWidgetID(component: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${component}:${suffix}`;
}

function WidgetGallery({
  definitions,
  configured,
  onAdd,
  onClose,
}: {
  definitions: WidgetDefinition[];
  configured: WidgetInstance[];
  onAdd: (definition: WidgetDefinition) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Widget gallery">
      <button className="absolute inset-0 bg-black/65" onClick={onClose} aria-label="Close widget gallery" />
      <div className="relative flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
        <header className="flex items-center border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-text">Add a widget</h2>
            <p className="mt-1 text-[10px] text-text-dim">Choose from Apteva and your installed apps.</p>
          </div>
          <button type="button" className="ml-auto text-lg text-text-dim hover:text-text" onClick={onClose}>×</button>
        </header>
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-5 sm:grid-cols-2">
          {definitions.map((definition) => {
            const count = configured.filter((item) => item.component === definition.key).length;
            return (
              <article key={definition.key} className="flex min-h-28 flex-col rounded-lg border border-border bg-bg-subtle p-4 hover:border-accent/55">
                <div className="flex items-start gap-3">
                  <AppIcon name={definition.label} src={definition.icon} iconStyle={definition.iconStyle} size="sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xs font-bold text-text">{definition.label}</h3>
                      {definition.suggested && (
                        <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-accent">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-text-dim">{definition.description || "Dashboard widget"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAdd(definition)}
                  className="mt-auto self-end rounded-md border border-accent px-3 py-1.5 text-[9px] font-bold text-accent hover:bg-accent/10"
                >
                  {count ? "Add another" : "Add"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WidgetSettingsDialog({
  definition,
  settings,
  onChange,
  onClose,
}: {
  definition: WidgetDefinition;
  settings: Record<string, unknown>;
  onChange: (settings: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[115] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={`Configure ${definition.label}`}>
      <button className="absolute inset-0 bg-black/65" onClick={onClose} aria-label="Close settings" />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-bg-card p-5 shadow-2xl">
        <div className="flex items-center">
          <h2 className="text-sm font-bold text-text">{definition.label}</h2>
          <button type="button" onClick={onClose} className="ml-auto text-lg text-text-dim hover:text-text">×</button>
        </div>
        <WidgetSettingsEditor schema={definition.settingsSchema} settings={settings} onChange={onChange} />
        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-md border border-accent bg-accent px-4 py-2 text-xs font-bold text-bg">Done</button>
        </div>
      </div>
    </div>
  );
}
