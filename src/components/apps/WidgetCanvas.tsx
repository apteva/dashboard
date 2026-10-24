import { PresetConnectionGuide } from "../projects/PresetConnectionGuide";
import { WidgetGallery } from "./WidgetGallery";
import { WidgetIcon } from "./WidgetIcon";
import { WidgetConfiguration } from "./WidgetConfiguration";
import type { WidgetSettingsUI } from "./widgetSettings";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  reorderWidgetInstances,
  useProjectUILayout,
  type WidgetInstance,
  type WidgetSize,
} from "./contributions";
import {
  createWidgetActionBridge,
  type WidgetAction,
  type WidgetContext,
  type WidgetRenderContext,
} from "./widgetContext";

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
  settingsUI?: WidgetSettingsUI;
  sourceApp?: string;
  sourceInstallId?: number;
  suggested?: boolean;
  /** Show this widget on a fresh layout before the user customizes it. */
  defaultVisible?: boolean;
  /** Keep exactly one instance on this surface; it can still move and resize. */
  required?: boolean;
  kind?: "builtin" | "app";
  providerLabel?: string;
  /** Stable source identity, independent of its display name. */
  providerKey?: string;
  render: (instance: WidgetInstance, renderContext?: WidgetRenderContext) => ReactNode;
}

export function WidgetCanvas({
  projectId,
  layoutScope = "project",
  slot,
  definitions,
  editing,
  keepEditingWhenEmpty = false,
  onEditingChange,
  onVisibleComponentsChange,
  galleryRequest = 0,
  definitionsReady = true,
  defaultLayout,
  context,
  workspaceLayout = false,
  onWidgetAction,
  className = "grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2",
}: {
  projectId?: string | null;
  layoutScope?: "project" | "global";
  slot: string;
  definitions: WidgetDefinition[];
  editing: boolean;
  /** Custom pages keep their editor available before the first widget exists. */
  keepEditingWhenEmpty?: boolean;
  onEditingChange: (editing: boolean) => void;
  onVisibleComponentsChange?: (components: string[]) => void;
  galleryRequest?: number;
  /** False while app-owned definitions are still being discovered. */
  definitionsReady?: boolean;
  /** Contextual preset used until this surface has its own saved layout. */
  defaultLayout?: WidgetInstance[];
  /** Shared selection context passed to native and app-provided widgets. */
  context?: WidgetContext;
  workspaceLayout?: boolean;
  /** Optional host action handler. Actions are also published on the window bridge. */
  onWidgetAction?: (action: WidgetAction) => void;
  className?: string;
}) {
  const { project, updateSurface, saveState } = useProjectUILayout(projectId, layoutScope);
  const [activePane, setActivePane] = useState<string | null>(null);
  useEffect(() => setActivePane(null), [projectId, slot]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<{
    scope: string;
    instance: WidgetInstance;
    adding: boolean;
    installId?: number;
  } | null>(null);
  const configurationScope = JSON.stringify([projectId, layoutScope, slot]);
  const widgetActions = useMemo(() => createWidgetActionBridge(onWidgetAction), [onWidgetAction]);
  const renderContext = useMemo<WidgetRenderContext>(() => ({
    context: context || { scope: layoutScope },
    actions: widgetActions,
  }), [context, layoutScope, widgetActions]);
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
    : [];
  const initialLayout = explicit
    ? stored
    : defaultLayout ?? definitions.filter((definition) => definition.defaultVisible).map((definition) => ({
      id: `default:${definition.key}`,
      component: definition.key,
      size: definition.defaultSize,
      settings: { ...(definition.defaultSettings || {}) },
    }));
  const configured = ensureRequiredWidgets(initialLayout, definitions);
  const visible = configured.filter((instance) => instance.component !== "native:inbox");
  const loadingInstances = configured.filter((instance) =>
    byKey.has(instance.component) || !instance.component.startsWith("native:"),
  );
  const visibleComponentsKey = visible.map((instance) => instance.component).join("\u0000");

  useEffect(() => {
    if (!definitionsReady) return;
    onVisibleComponentsChange?.(visible.map((instance) => instance.component));
    if (visible.length === 0 && editing && !keepEditingWhenEmpty) onEditingChange(false);
  }, [definitionsReady, editing, keepEditingWhenEmpty, onEditingChange, onVisibleComponentsChange, visibleComponentsKey]);

  const persist = (next: WidgetInstance[], strict = false) => {
    if (layoutScope === "project" && !projectId) return;
    return updateSurface(slot, ensureRequiredWidgets(next, definitions), { rejectOnError: strict });
  };
  const add = (definition: WidgetDefinition) => {
    if (definition.required && configured.some((item) => item.component === definition.key)) return;
    const instance: WidgetInstance = {
      id: newWidgetID(definition.key), component: definition.key, size: definition.defaultSize,
      settings: { ...(definition.defaultSettings || {}) },
    };
    setGalleryOpen(false);
    if (Object.keys(definition.settingsSchema?.properties || {}).length) {
      setConfiguration({ scope: configurationScope, instance, adding: true, installId: definition.sourceInstallId });
      return;
    }
    void persist([...configured, instance]);
  };
  const patchWidget = (id: string, patch: Partial<WidgetInstance>) => persist(configured.map((item) => item.id === id ? { ...item, ...patch } : item));

  const remove = (id: string) => {
    const instance = configured.find((item) => item.id === id);
    if (instance && byKey.get(instance.component)?.required) return;
    persist(configured.filter((item) => item.id !== id));
  };
  const move = (id: string, target: string) =>
    persist(reorderWidgetInstances(configured, id, target));
  const activeSettings = configuration?.scope === configurationScope ? configuration : null;
  const activeSettingsDefinition = activeSettings ? byKey.get(activeSettings.instance.component) : undefined;


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
            hidden={!defaultLayout}
            onClick={() => defaultLayout && persist(defaultLayout)}
            className="min-h-8 rounded-md border border-border px-3 py-1.5 text-[11px] text-text-muted hover:text-text"
          >
            Reset view
          </button>
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

      {!definitionsReady ? (
        <WidgetCanvasLoading instances={loadingInstances} className={className} slot={slot} />
      ) : visible.length > 0 ? (
        <div className={className} data-widget-canvas={slot}>
          {visible.map((instance, index) => {
            const definition: WidgetDefinition = byKey.get(instance.component) || {
              key: instance.component, label: instance.component.split(":").pop()?.replaceAll("-", " ") || "Widget",
              supportedSizes: ["half", "full"], defaultSize: instance.size,
              render: () => <section className="h-full rounded-lg border border-dashed border-border p-4"><h3 className="text-sm font-semibold">Widget unavailable</h3><p className="mt-2 text-xs leading-relaxed text-text-muted">{instance.component} is saved here. Install or update its app and check its access to this page or agent.</p><a href="/apps" className="mt-3 inline-block text-xs text-accent">Manage apps</a></section>,
            };
            const sizes = definition.supportedSizes;
            return (
              <div
                key={instance.id}
                onFocusCapture={() => setActivePane(instance.id)}
                onPointerDownCapture={() => setActivePane(instance.id)}
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
                    className="mb-1.5 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-bg-card px-2 py-1 shadow-sm"
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
                    <WidgetIcon definition={definition} size="sm" />
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
                        onClick={() => setConfiguration({scope:configurationScope,instance:structuredClone(instance),adding:false,installId:definition.sourceInstallId})}
                        className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded text-[11px] text-text-muted hover:bg-bg-hover hover:text-text"
                        aria-label={`Configure ${definition.label}`}
                      >
                        ⚙
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(instance.id, visible[index - 1]?.id || instance.id)}
                      className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded text-[11px] text-text-dim hover:bg-bg-hover disabled:opacity-25 sm:hidden"
                      aria-label={`Move ${definition.label} earlier`}
                    >↑</button>
                    <button
                      type="button"
                      disabled={index === visible.length - 1}
                      onClick={() => move(instance.id, visible[index + 1]?.id || instance.id)}
                      className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded text-[11px] text-text-dim hover:bg-bg-hover disabled:opacity-25 sm:hidden"
                      aria-label={`Move ${definition.label} later`}
                    >↓</button>
                    {workspaceLayout && <select aria-label={`Area for ${definition.label}`} className="min-h-9 rounded border border-border bg-bg-input px-2 text-xs" value={instance.placement || "main"} onChange={event => patchWidget(instance.id, { placement: event.target.value as WidgetInstance["placement"] })}>
                      <option value="assistant">Side panel</option><option value="main">Main view</option><option value="activity">Activity panel</option><option value="details">Details panel</option>
                    </select>}
                    {definition.required ? <span className="px-1 text-[10px] text-text-dim" title="Always shown on this page. You can resize or move it.">Always shown</span> : <button
                      type="button"
                      onClick={() => remove(instance.id)}
                      className="flex h-10 w-10 sm:h-7 sm:w-7 items-center justify-center rounded text-sm text-text-dim hover:bg-red/10 hover:text-red"
                      aria-label={`Remove ${definition.label}`}
                    >
                      ×
                    </button>}
                  </div>
                )}
                <div className={`min-w-0 ${editing ? "min-h-0 flex-1" : "h-full"}`}>
                  {instance.agent_id === -1 ? <p className="rounded-lg border border-border p-4 text-sm text-text-muted">This widget is waiting for its preset agent. Retry workspace setup to finish creating it.</p> : definition.render(instance, { ...renderContext, context: { ...renderContext.context, hostForeground: workspaceLayout && !editing && (activePane || visible.find(item => (item.placement || "main") === "main")?.id || visible[0]?.id) === instance.id } })}
                  {!!instance.setup?.length && <PresetConnectionGuide steps={instance.setup} projectId={projectId || undefined} compact /> }
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {galleryOpen && (
        <WidgetGallery
          definitions={definitions}
          configured={configured}
          onAdd={add}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {activeSettings && activeSettingsDefinition && activeSettings.installId===activeSettingsDefinition.sourceInstallId && (
        <WidgetConfiguration key={`${configurationScope}:${activeSettings.instance.id}:${activeSettings.installId}`}
          label={activeSettingsDefinition.label} schema={activeSettingsDefinition.settingsSchema} ui={activeSettingsDefinition.settingsUI}
          app={activeSettingsDefinition.sourceApp} installId={activeSettingsDefinition.sourceInstallId} projectId={projectId||undefined}
          settings={activeSettings.instance.settings||{}} adding={activeSettings.adding} context={renderContext.context}
          renderPreview={(settings,previewContext)=>activeSettingsDefinition.render({...activeSettings.instance,settings},previewContext)}
          onSave={settings => {
            if (!activeSettings.adding && !configured.some(widget => widget.id === activeSettings.instance.id)) {
              throw new Error("This widget was removed. Add it again to configure it.");
            }
            const next = activeSettings.adding
              ? [...configured, { ...activeSettings.instance, settings }]
              : configured.map(widget => widget.id === activeSettings.instance.id ? { ...widget, settings } : widget);
            return persist(next, true);
          }}
          onClose={()=>setConfiguration(null)}
        />
      )}
    </section>
  );
}

function WidgetCanvasLoading({
  instances,
  className,
  slot,
}: {
  instances: WidgetInstance[];
  className: string;
  slot: string;
}) {
  const placeholders = instances.length > 0
    ? instances
    : [
        { id: "loading:half", component: "", size: "half" as const },
        { id: "loading:full", component: "", size: "full" as const },
      ];
  return (
    <div className={className} data-widget-canvas={slot} aria-label="Loading dashboard widgets">
      {placeholders.map((instance) => (
        <div
          key={instance.id}
          className={`min-h-40 rounded-lg border border-border bg-bg-card p-4 ${instance.size === "full" ? "xl:col-span-2" : ""}`}
        >
          <div className="h-3 w-28 rounded bg-bg-hover" />
          <div className="mt-4 h-2 w-full rounded bg-bg-subtle" />
          <div className="mt-2 h-2 w-2/3 rounded bg-bg-subtle" />
        </div>
      ))}
    </div>
  );
}

function ensureRequiredWidgets(instances: WidgetInstance[], definitions: WidgetDefinition[]): WidgetInstance[] {
  const required = definitions.filter((definition) => definition.required);
  if (required.length === 0) return instances;
  const requiredKeys = new Set(required.map((definition) => definition.key));
  const seen = new Set<string>();
  // Preserve saved size/order and unavailable app entries. Restore a mandatory
  // widget even when an older saved layout removed it, without rewriting it.
  const existing = instances.filter((instance) => {
    if (!requiredKeys.has(instance.component)) return true;
    if (seen.has(instance.component)) return false;
    seen.add(instance.component);
    return true;
  });
  return [
    ...required.filter((definition) => !seen.has(definition.key)).map((definition) => ({
      id: `required:${definition.key}`,
      component: definition.key,
      size: definition.defaultSize,
      settings: { ...(definition.defaultSettings || {}) },
    })),
    ...existing,
  ];
}

export function normalizeStoredWidgets(values: unknown[], definitions: WidgetDefinition[]): WidgetInstance[] {
  const byKey = new Map(definitions.map((item) => [item.key, item]));
  let hasTasks = values.some((value) => typeof value === "string" ? value === "tasks:task-overview" : !!value && typeof value === "object" && "component" in value && value.component === "tasks:task-overview");
  return values.flatMap((value, index) => {
    const legacy = typeof value === "string";
    if (!legacy && (!value || typeof value !== "object" || Array.isArray(value))) return [];
    const raw = legacy ? null : value as Partial<WidgetInstance>;
    let component = legacy ? value : raw?.component;
    if (component === "native:starter-assignments") {
      if (hasTasks) return [];
      component = "tasks:task-overview";
      hasTasks = true;
    }
    if (typeof component !== "string") return [];
    const definition = byKey.get(component);
    const supported = definition?.supportedSizes || ["half", "full"];
    const requested = raw?.size;
    const size = requested && supported.includes(requested)
      ? requested
      : definition?.defaultSize || "half";
    return [{
      id: raw?.id || `legacy:${index}:${component}`,
      placement: raw?.placement,
      agent_id: raw?.agent_id,
      setup: raw?.setup,
      component,
      size,
      settings: {
        ...(definition?.defaultSettings || {}),
        ...(raw?.settings || {}),
      },
    }];
  });
}

function newWidgetID(component: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${component}:${suffix}`;
}
