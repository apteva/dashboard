import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectUILayout, type WidgetInstance } from "./contributions";
import { normalizeStoredWidgets, type WidgetDefinition } from "./WidgetCanvas";
import { createWidgetActionBridge, type WidgetAction, type WidgetContext } from "./widgetContext";
import { Modal } from "../Modal";

type Area = "assistant" | "main" | "activity" | "details";
const tabClass = "min-h-10 shrink-0 rounded-md px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** An optional page layout. The saved widget instances remain the source of truth. */
export function WorkspaceCanvas({ projectId, slot, definitions, context, onAction, ready, onVisibleChange, selectionRevision, assistantRevision }: {
  projectId?: string; slot: string; definitions: WidgetDefinition[]; context: WidgetContext;
  onAction: (action: WidgetAction) => void; ready: boolean;
  onVisibleChange: (components: string[]) => void; selectionRevision: number; assistantRevision: number;
}) {
  const { project } = useProjectUILayout(projectId, context.scope);
  const widgets = normalizeStoredWidgets(project.slots?.[slot] || [], definitions);
  const keys = widgets.map(widget => widget.component).join("\0");
  const [pane, setPane] = useState<Area>("main");
  const [tabs, setTabs] = useState<Partial<Record<Area, string>>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const detailRef = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => createWidgetActionBridge(onAction), [onAction]);
  const renderContext = { context: { ...context, presentation: "workspace" as const }, actions };
  const groups = Object.fromEntries((["assistant", "main", "activity", "details"] as Area[]).map(area => [area, widgets.filter(widget => (widget.placement || "main") === area)])) as Record<Area, WidgetInstance[]>;
  useEffect(() => { if (ready) onVisibleChange(widgets.map(widget => widget.component)); }, [keys, ready, onVisibleChange]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!selectionRevision || !(context.selected || context.preview || context.activityId) || groups.details.length === 0) { setDetailsOpen(false); return; }
    const key = context.activityId || context.preview ? "native:result-preview" : "native:context-inspector";
    const widget = groups.details.find(widget => widget.component === key) || groups.details[0];
    setTabs(current => ({ ...current, details: widget.id })); setDetailsOpen(true);
  }, [selectionRevision, !!context.selected, !!context.preview, context.activityId]);
  useEffect(() => { if (assistantRevision) { setPane("assistant"); setDetailsOpen(false); } }, [assistantRevision]);
  useEffect(() => {
    if (!detailsOpen || !wide) return;
    const frame = requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [detailsOpen, wide, selectionRevision]);
  const label = (widget: WidgetInstance) => definitions.find(item => item.key === widget.component)?.label || widget.component;
  const renderGroup = (area: Area) => {
    const items = groups[area];
    const active = items.find(widget => widget.id === tabs[area]) || items[0];
    const resultsWidget = area === "main" ? groups.details.find(widget => widget.component === "native:result-preview") : undefined;
    if (!active) return <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-5 text-center text-xs text-text-muted">Assign a widget to this area in Edit page.</div>;
    return <div className="flex h-full min-h-0 flex-col gap-2">
      {(items.length > 1 || resultsWidget) && <div className="flex shrink-0 items-center gap-2">
        <div role="tablist" aria-label={`${area} widgets`} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">{items.map(widget => <button key={widget.id} role="tab" aria-selected={widget.id === active.id} className={`${tabClass} ${widget.id === active.id ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-bg-hover"}`} onClick={() => setTabs(current => ({ ...current, [area]: widget.id }))}>{label(widget)}</button>)}</div>
        {resultsWidget && <button type="button" aria-label="Browse results" onClick={() => { setTabs(current => ({ ...current, details: resultsWidget.id })); setDetailsOpen(true); }} className={`${tabClass} border border-accent/40 text-accent hover:bg-accent/5`}>Results ↗</button>}
      </div>}
      {items.map(widget => <div key={widget.id} hidden={widget.id !== active.id} className={`workspace-widget min-h-0 flex-1 ${widget.id === active.id ? "flex flex-col" : "hidden"}`} data-widget-id={widget.id}>
        {definitions.find(item => item.key === widget.component)?.render(widget, renderContext) || <p className="p-4 text-xs text-text-muted">{label(widget)} is unavailable. Check its app or edit this page.</p>}
      </div>)}
    </div>;
  };
  const details = <div ref={detailRef} tabIndex={-1} aria-label="Selected item" className="flex h-full min-h-0 flex-col outline-none" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setDetailsOpen(false); } }}><header className="mb-2 flex shrink-0 items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-text-muted">{context.preview?.title || context.selected?.label || "Details"}</span><button className={tabClass+" text-text-muted hover:bg-bg-hover"} onClick={() => setDetailsOpen(false)}>Close details</button></header><div className="min-h-0 flex-1">{renderGroup("details")}</div></div>;
  if (!ready) return <p className="p-4 text-sm text-text-muted">Loading workspace…</p>;
  return <div className="flex h-full min-h-0 flex-col gap-3" data-workspace-canvas={slot}>
    <nav aria-label="Workspace views" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border pb-2 lg:hidden">{([ ["assistant", "Helper"], ["main", "System"], ["activity", "Activity"] ] as const).filter(([area]) => groups[area].length).map(([area,name]) => <button key={area} aria-pressed={pane === area} className={`${tabClass} ${pane === area ? "bg-accent/10 text-accent" : "text-text-muted"}`} onClick={() => setPane(area)}>{name}</button>)}</nav>
    <div className={`grid min-h-0 flex-1 gap-3 ${groups.assistant.length ? "lg:grid-cols-[minmax(300px,32%)_minmax(0,1fr)]" : "lg:grid-cols-1"}`}>
      {groups.assistant.length > 0 && <aside aria-label="Workspace assistant" className={`min-h-0 ${pane === "assistant" ? "block" : "hidden"} lg:block`}>{renderGroup("assistant")}</aside>}
      <div className={`relative min-h-0 ${pane === "assistant" ? "hidden" : "flex"} flex-col gap-3 lg:flex`}>
        <div className={`min-h-0 flex-1 ${pane === "activity" ? "hidden" : "block"} lg:block`}>{renderGroup("main")}</div>
        {groups.activity.length > 0 && <div className={`min-h-0 ${pane === "activity" ? "flex-1" : "hidden"} lg:block lg:h-[36%] lg:min-h-48 lg:flex-none`}>{renderGroup("activity")}</div>}
        {wide && detailsOpen && <div className="absolute inset-y-0 right-0 z-20 w-[min(430px,100%)] rounded-lg border border-accent/30 bg-bg p-3 shadow-2xl">{details}</div>}
      </div>
    </div>
    <Modal open={!wide && detailsOpen} onClose={() => setDetailsOpen(false)} ariaLabel="Selected item" width="max-w-xl"><div className="h-[min(78dvh,640px)] min-h-0 p-3">{details}</div></Modal>
  </div>;
}
