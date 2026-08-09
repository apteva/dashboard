import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { auth } from "../../api";
import { useOptionalAuth } from "../../hooks/useAuth";
import { useAppEvents } from "../../hooks/useAppEvents";
import {
  ChatComponentMount,
  type InstalledAppRow,
  type UIComponentSpec,
  useInstalledApps,
} from "./chatComponents";

export type WidgetSize = "half" | "full";

export interface WidgetInstance {
  /** Stable identity so one component may be added more than once. */
  id: string;
  /** app:component manifest identity. */
  component: string;
  size: WidgetSize;
  settings?: Record<string, unknown>;
}

type StoredWidget = string | WidgetInstance;

export interface ProjectUILayout {
  /** String entries are the legacy enabled-component format. */
  slots?: Record<string, StoredWidget[]>;
  sidebar?: string[];
}

export interface UILayoutDocument {
  projects?: Record<string, ProjectUILayout>;
}

const LAYOUT_EVENT = "apteva:ui-layout-changed";

function normalizeLayout(value: unknown): UILayoutDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as UILayoutDocument;
}

export function contributionKey(appName: string, componentName: string) {
  return `${appName}:${componentName}`;
}

export function useProjectUILayout(projectId?: string | null) {
  const user = useOptionalAuth()?.user;
  const initial =
    user && typeof user === "object" ? normalizeLayout(user.uiLayout) : {};
  const [document, setDocument] = useState<UILayoutDocument>(initial);

  useEffect(() => {
    if (user && typeof user === "object")
      setDocument(normalizeLayout(user.uiLayout));
  }, [user]);
  useEffect(() => {
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<UILayoutDocument>).detail;
      if (next) setDocument(next);
    };
    window.addEventListener(LAYOUT_EVENT, onChanged);
    return () => window.removeEventListener(LAYOUT_EVENT, onChanged);
  }, []);

  const project = projectId ? document.projects?.[projectId] || {} : {};
  const update = useCallback(
    async (nextProject: ProjectUILayout) => {
      if (!projectId) return;
      const next: UILayoutDocument = {
        ...document,
        projects: { ...(document.projects || {}), [projectId]: nextProject },
      };
      setDocument(next);
      window.dispatchEvent(new CustomEvent(LAYOUT_EVENT, { detail: next }));
      try {
        await auth.updatePreferences({
          ui_layout: next as Record<string, unknown>,
        });
      } catch {
        // Keep the optimistic local layout. The next authenticated profile load
        // reconciles it if persistence failed.
      }
    },
    [document, projectId],
  );

  return { document, project, update };
}

export interface Contribution {
  app: InstalledAppRow;
  spec: UIComponentSpec;
  key: string;
}

export interface ResolvedWidgetInstance extends WidgetInstance {
  contribution: Contribution;
}

export function contributionsFor(
  apps: InstalledAppRow[],
  slot: string,
): Contribution[] {
  const out: Contribution[] = [];
  for (const app of apps) {
    if (app.status && app.status !== "running") continue;
    for (const spec of app.ui_components || []) {
      if (!spec.slots?.includes(slot)) continue;
      out.push({ app, spec, key: contributionKey(app.name, spec.name) });
    }
  }
  return out;
}

export function supportedWidgetSizes(spec: UIComponentSpec): WidgetSize[] {
  const declared = (spec.supported_sizes || []).filter(
    (size): size is WidgetSize => size === "half" || size === "full",
  );
  if (declared.length) return [...new Set(declared)];
  // Legacy components stay fixed at the width their manifest requested.
  return [spec.default_width === 2 ? "full" : "half"];
}

export function defaultWidgetSize(spec: UIComponentSpec): WidgetSize {
  const sizes = supportedWidgetSizes(spec);
  return spec.default_size && sizes.includes(spec.default_size)
    ? spec.default_size
    : sizes[0];
}

function normalizedWidgetSize(
  spec: UIComponentSpec,
  requested?: string,
): WidgetSize {
  const sizes = supportedWidgetSizes(spec);
  return requested && sizes.includes(requested as WidgetSize)
    ? (requested as WidgetSize)
    : defaultWidgetSize(spec);
}

export function defaultWidgetSettings(
  spec: UIComponentSpec,
): Record<string, unknown> {
  const properties = schemaProperties(spec.settings_schema);
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, property]) => Object.prototype.hasOwnProperty.call(property, "default"))
      .map(([name, property]) => [name, property.default]),
  );
}

export function widgetInstancesFor(
  contributions: Contribution[],
  slot: string,
  project: ProjectUILayout,
): ResolvedWidgetInstance[] {
  const byKey = new Map(contributions.map((item) => [item.key, item]));
  const explicit =
    project.slots && Object.prototype.hasOwnProperty.call(project.slots, slot);
  const explicitValue = project.slots?.[slot];
  const stored: StoredWidget[] = explicit
    ? Array.isArray(explicitValue) ? explicitValue : []
    : slot === "dashboard.home"
      ? []
      : contributions
        .filter((item) => item.spec.suggested)
        .map((item) => ({
          id: `suggested:${item.key}`,
          component: item.key,
          size: defaultWidgetSize(item.spec),
          settings: defaultWidgetSettings(item.spec),
        }));

  return stored.flatMap((entry, index) => {
    if (
      typeof entry !== "string" &&
      (!entry || typeof entry !== "object" || Array.isArray(entry))
    ) return [];
    const legacy = typeof entry === "string";
    const component = legacy ? entry : entry.component;
    const contribution = byKey.get(component);
    if (!contribution) return [];
    return [{
      id: legacy
        ? `legacy:${slot}:${index}:${component}`
        : entry.id || `widget:${slot}:${index}:${component}`,
      component,
      size: normalizedWidgetSize(
        contribution.spec,
        legacy ? undefined : entry.size,
      ),
      settings: legacy
        ? defaultWidgetSettings(contribution.spec)
        : { ...defaultWidgetSettings(contribution.spec), ...(entry.settings || {}) },
      contribution,
    }];
  });
}

export function enabledContributionKeys(
  contributions: Contribution[],
  slot: string,
  project: ProjectUILayout,
): string[] {
  return widgetInstancesFor(contributions, slot, project).map(
    (instance) => instance.component,
  );
}

export function serializeWidgetInstances(
  instances: WidgetInstance[],
): WidgetInstance[] {
  return instances.map((item) => ({
    id: item.id,
    component: item.component,
    size: item.size,
    ...(item.settings && Object.keys(item.settings).length
      ? { settings: item.settings }
      : {}),
  }));
}

export function reorderWidgetInstances(
  instances: WidgetInstance[],
  id: string,
  targetID: string,
): WidgetInstance[] {
  const next = serializeWidgetInstances(instances);
  if (id === targetID) return next;
  const from = next.findIndex((item) => item.id === id);
  const to = next.findIndex((item) => item.id === targetID);
  if (from < 0 || to < 0) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function preferredSidebarAppNames<
  T extends { name: string; suggested?: boolean },
>(apps: T[], project: ProjectUILayout): string[] {
  return Object.prototype.hasOwnProperty.call(project, "sidebar")
    ? project.sidebar || []
    : apps.filter((app) => app.suggested).map((app) => app.name);
}

export function AppContributionArea({
  slot,
  projectId,
  agentId,
  threadId,
  className = "contents",
  empty = null,
}: {
  slot: string;
  projectId?: string | null;
  agentId?: number;
  threadId?: string;
  className?: string;
  empty?: React.ReactNode;
}) {
  const apps = useInstalledApps(projectId);
  const { project } = useProjectUILayout(projectId);
  const contributions = useMemo(
    () => contributionsFor(apps, slot),
    [apps, slot],
  );
  const widgets = widgetInstancesFor(contributions, slot, project);
  if (!projectId || widgets.length === 0) return empty;
  return (
    <div className={className}>
      {widgets.map((instance) => (
        <ContributionMount
          key={instance.id}
          instance={instance}
          apps={apps}
          slot={slot}
          projectId={projectId}
          agentId={agentId}
          threadId={threadId}
        />
      ))}
    </div>
  );
}

function ContributionMount({
  instance,
  apps,
  slot,
  projectId,
  agentId,
  threadId,
}: {
  instance: ResolvedWidgetInstance;
  apps: InstalledAppRow[];
  slot: string;
  projectId: string;
  agentId?: number;
  threadId?: string;
}) {
  const { contribution } = instance;
  const [eventRevision, setEventRevision] = useState(0);
  useAppEvents(contribution.app.name, projectId, () =>
    setEventRevision((value) => value + 1),
  );
  const width = instance.size === "full" ? "xl:col-span-2" : "";
  return (
    <div
      className={`h-full min-w-0 ${width}`}
      data-app-contribution={contribution.key}
      data-widget-id={instance.id}
      data-widget-size={instance.size}
    >
      <ChatComponentMount
        comp={{
          app: contribution.app.name,
          name: contribution.spec.name,
          props: {
            agentId,
            threadId,
            eventRevision,
            slot,
            widgetId: instance.id,
            widgetSize: instance.size,
            widgetSettings: instance.settings || {},
          },
        }}
        apps={apps}
        projectId={projectId}
        slot={slot}
      />
    </div>
  );
}

export function ContributionManager({
  slot,
  projectId,
  label = "Customize",
}: {
  slot: string;
  projectId?: string | null;
  label?: string;
}) {
  const apps = useInstalledApps(projectId);
  const { project, update } = useProjectUILayout(projectId);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const options = useMemo(() => contributionsFor(apps, slot), [apps, slot]);
  if (!projectId || options.length === 0) return null;
  const configured = widgetInstancesFor(options, slot, project);
  const persist = (next: WidgetInstance[]) => {
    const stored = serializeWidgetInstances(next);
    void update({
      ...project,
      slots: {
        ...(project.slots || {}),
        [slot]: stored,
      },
    });
  };
  const add = (item: Contribution) => {
    persist([
      ...configured,
      {
        id: newWidgetInstanceID(item.key),
        component: item.key,
        size: defaultWidgetSize(item.spec),
        settings: defaultWidgetSettings(item.spec),
      },
    ]);
  };
  const patchInstance = (id: string, patch: Partial<WidgetInstance>) =>
    persist(configured.map((item) => item.id === id ? { ...item, ...patch } : item));
  const remove = (id: string) =>
    persist(configured.filter((item) => item.id !== id));
  const move = (id: string, targetID: string) => {
    persist(reorderWidgetInstances(configured, id, targetID));
  };
  const nudge = (id: string, delta: number) => {
    const from = configured.findIndex((item) => item.id === id);
    const to = Math.max(0, Math.min(configured.length - 1, from + delta));
    if (from < 0 || from === to) return;
    move(id, configured[to].id);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border px-3 py-1.5 text-[10px] text-text-muted hover:bg-bg-hover hover:text-text"
      >
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Customize dashboard"
        >
          <button
            className="absolute inset-0 bg-black/65"
            onClick={() => setOpen(false)}
            aria-label="Close"
          />
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded border border-border bg-bg-card shadow-2xl">
            <header className="flex items-center border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-bold text-text">Customize widgets</h2>
                <p className="mt-1 text-[10px] text-text-dim">
                  Add, resize, configure, and reorder components from installed apps.
                </p>
              </div>
              <button
                className="ml-auto text-lg text-text-dim hover:text-text"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <div className="mb-3 flex items-center text-[9px] font-bold uppercase tracking-wide text-text-dim">
                <span>Your widgets</span>
                <span className="ml-auto">{configured.length}</span>
              </div>
              <div className="space-y-3">
                {configured.length === 0 && (
                  <div className="rounded border border-dashed border-border px-4 py-6 text-center text-[10px] text-text-dim">
                    No widgets in this area. Add one below.
                  </div>
                )}
                {configured.map((instance, index) => {
                  const item = instance.contribution;
                  const sizes = supportedWidgetSizes(item.spec);
                  return (
                    <div
                      key={instance.id}
                      draggable
                      onDragStart={() => setDragging(instance.id)}
                      onDragEnd={() => setDragging(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (dragging) move(dragging, instance.id);
                        setDragging(null);
                      }}
                      className={`rounded border bg-bg-subtle p-3 ${
                        dragging === instance.id ? "border-accent opacity-60" : "border-border"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label="Drag to reorder"
                          className="mt-1 cursor-grab text-sm text-text-dim active:cursor-grabbing"
                          title="Drag to reorder"
                        >
                          ⋮⋮
                        </button>
                        <AppIcon
                          name={item.app.display_name || item.app.name}
                          src={item.app.icon}
                          iconStyle={item.app.icon_style}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-text">
                                {item.spec.label || item.spec.name}
                              </div>
                              <div className="mt-0.5 text-[10px] text-text-dim">
                                {item.spec.description || item.app.display_name || item.app.name}
                              </div>
                            </div>
                            <WidgetFootprintPreview size={instance.size} />
                          </div>
                          {sizes.length > 1 && (
                            <div className="mt-3 flex items-center gap-1" aria-label="Widget size">
                              {sizes.map((size) => (
                                <button
                                  key={size}
                                  type="button"
                                  onClick={() => patchInstance(instance.id, { size })}
                                  className={`rounded border px-2.5 py-1 text-[9px] font-bold capitalize ${
                                    instance.size === size
                                      ? "border-accent bg-accent/10 text-accent"
                                      : "border-border text-text-muted hover:bg-bg-hover hover:text-text"
                                  }`}
                                >
                                  {size}
                                </button>
                              ))}
                            </div>
                          )}
                          <WidgetSettingsEditor
                            schema={item.spec.settings_schema}
                            settings={instance.settings || {}}
                            onChange={(settings) => patchInstance(instance.id, { settings })}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            aria-label="Move widget up"
                            disabled={index === 0}
                            onClick={() => nudge(instance.id, -1)}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-muted hover:bg-bg-hover disabled:opacity-25"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label="Move widget down"
                            disabled={index === configured.length - 1}
                            onClick={() => nudge(instance.id, 1)}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-muted hover:bg-bg-hover disabled:opacity-25"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label="Remove widget"
                            onClick={() => remove(instance.id)}
                            className="rounded border border-red/40 px-2 py-1 text-[10px] text-red hover:bg-red/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mb-3 mt-6 text-[9px] font-bold uppercase tracking-wide text-text-dim">
                Widget gallery
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((item) => {
                  const count = configured.filter((instance) => instance.component === item.key).length;
                  return (
                    <div key={item.key} className="flex items-center gap-3 rounded border border-border p-3">
                      <AppIcon
                        name={item.app.display_name || item.app.name}
                        src={item.app.icon}
                        iconStyle={item.app.icon_style}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-text">
                          {item.spec.label || item.spec.name}
                        </div>
                        <div className="truncate text-[9px] text-text-dim">
                          {item.app.display_name || item.app.name}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => add(item)}
                        className="rounded border border-accent px-2.5 py-1 text-[9px] font-bold text-accent hover:bg-accent/10"
                      >
                        {count ? "Add another" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <footer className="flex justify-end border-t border-border p-4">
              <button
                onClick={() => setOpen(false)}
                className="rounded border border-accent bg-accent/10 px-4 py-2 text-xs font-bold text-accent hover:bg-accent/20"
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

interface WidgetSettingProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

function schemaProperties(schema?: Record<string, unknown>): Record<string, WidgetSettingProperty> {
  if (!schema || typeof schema.properties !== "object" || !schema.properties || Array.isArray(schema.properties)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(schema.properties).filter(
      ([, property]) => Boolean(property) && typeof property === "object" && !Array.isArray(property),
    ),
  ) as Record<string, WidgetSettingProperty>;
}

function newWidgetInstanceID(component: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${component}:${suffix}`;
}

function WidgetFootprintPreview({ size }: { size: WidgetSize }) {
  return (
    <span
      title={`${size} width`}
      className="grid h-7 w-12 grid-cols-2 gap-0.5 rounded border border-border bg-bg p-1"
      aria-label={`${size} width preview`}
    >
      <span className={`rounded-sm bg-accent/45 ${size === "full" ? "col-span-2" : ""}`} />
      {size === "half" && <span className="rounded-sm bg-border" />}
    </span>
  );
}

function WidgetSettingsEditor({
  schema,
  settings,
  onChange,
}: {
  schema?: Record<string, unknown>;
  settings: Record<string, unknown>;
  onChange: (settings: Record<string, unknown>) => void;
}) {
  const properties = schemaProperties(schema);
  if (Object.keys(properties).length === 0) return null;
  const set = (name: string, value: unknown) => onChange({ ...settings, [name]: value });
  return (
    <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
      {Object.entries(properties).map(([name, property]) => {
        const label = property.title || name.replaceAll("_", " ");
        const value = settings[name] ?? property.default;
        if (property.type === "boolean") {
          return (
            <label key={name} className="flex cursor-pointer items-center gap-2 text-[10px] text-text-muted">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(event) => set(name, event.target.checked)}
                className="accent-accent"
              />
              <span className="capitalize">{label}</span>
            </label>
          );
        }
        if (property.enum?.length) {
          return (
            <label key={name} className="text-[9px] text-text-dim">
              <span className="mb-1 block capitalize">{label}</span>
              <select
                value={String(value ?? "")}
                onChange={(event) => set(name, event.target.value)}
                className="w-full rounded border border-border bg-bg-input px-2 py-1.5 text-[10px] text-text"
              >
                {property.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
              </select>
            </label>
          );
        }
        return (
          <label key={name} className="text-[9px] text-text-dim">
            <span className="mb-1 block capitalize">{label}</span>
            <input
              type={property.type === "integer" || property.type === "number" ? "number" : "text"}
              min={property.minimum}
              max={property.maximum}
              value={String(value ?? "")}
              onChange={(event) => set(
                name,
                property.type === "integer" || property.type === "number"
                  ? Number(event.target.value)
                  : event.target.value,
              )}
              className="w-full rounded border border-border bg-bg-input px-2 py-1.5 text-[10px] text-text"
            />
            {property.description && <span className="mt-1 block">{property.description}</span>}
          </label>
        );
      })}
    </div>
  );
}

export function SidebarAppManager({
  projectId,
  apps,
  onClose,
}: {
  projectId: string;
  apps: Array<{
    name: string;
    label: string;
    icon?: string;
    iconStyle?: "image" | "monochrome";
    suggested?: boolean;
  }>;
  onClose: () => void;
}) {
  const { project, update } = useProjectUILayout(projectId);
  const selected = new Set(preferredSidebarAppNames(apps, project));
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    void update({
      ...project,
      sidebar: apps.filter((app) => next.has(app.name)).map((app) => app.name),
    });
  };
  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Preferred apps"
    >
      <button
        className="absolute inset-0 bg-black/65"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-md rounded border border-border bg-bg-card shadow-2xl">
        <header className="flex items-center border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-text">Preferred apps</h2>
            <p className="mt-1 text-[10px] text-text-dim">
              Choose which app pages stay in the sidebar.
            </p>
          </div>
          <button
            className="ml-auto text-lg text-text-dim hover:text-text"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="max-h-[60vh] divide-y divide-border overflow-auto">
          {apps.map((app) => (
            <label
              key={app.name}
              className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-bg-hover"
            >
              <input
                type="checkbox"
                checked={selected.has(app.name)}
                onChange={() => toggle(app.name)}
                className="accent-accent"
              />
              <AppIcon
                name={app.label}
                src={app.icon}
                iconStyle={app.iconStyle}
                size="sm"
              />
              <span className="text-xs font-semibold text-text">
                {app.label}
              </span>
            </label>
          ))}
        </div>
        <footer className="flex justify-end border-t border-border p-4">
          <button
            onClick={onClose}
            className="rounded border border-accent bg-accent/10 px-4 py-2 text-xs font-bold text-accent hover:bg-accent/20"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
