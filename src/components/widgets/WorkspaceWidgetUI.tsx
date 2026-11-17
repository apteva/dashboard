import type { ReactNode } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { AgentMark } from "../AgentMark";
import type { NativeWidgetContext } from "./NativeWidgets";
import type { WidgetRenderContext, WidgetResourceRef } from "../apps/widgetContext";
import { resourceKey, type WorkspaceResource } from "./workspaceModel";

export type SystemWidgetProps = NativeWidgetContext & { renderContext?: WidgetRenderContext };
export const widgetButton = "min-h-9 rounded-md border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:border-accent hover:text-accent focus-visible:outline-accent disabled:opacity-50";
export const widgetInput = "min-h-9 min-w-0 rounded-md border border-border bg-bg-input px-2 text-xs text-text focus:border-accent";
export function contextFor(props: SystemWidgetProps) { return props.renderContext || { context: props.widgetContext, actions: props.widgetActions }; }
export function WidgetSection({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <section className="@container flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
    <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2.5"><div className="min-w-0 flex-1"><h2 className="text-sm font-bold">{title}</h2><p className="mt-0.5 text-[11px] text-text-dim">{description}</p></div>{action && <div className="shrink-0">{action}</div>}</header>{children}
  </section>;
}
export function ResourceMark({ resource }: { resource: WorkspaceResource }) {
  return resource.ref.type === "agent" ? <AgentMark name={resource.name} icon={resource.agentIcon} size="sm" /> : <AppIcon name={resource.name} src={resource.icon} iconStyle={resource.iconStyle} size="sm" />;
}
export function ResourceButton({ resource, selected, onSelect, detail }: { resource: WorkspaceResource; selected?: WidgetResourceRef; onSelect: (ref: WidgetResourceRef) => void; detail?: string }) {
  const active = selected && resourceKey(selected) === resourceKey(resource.ref);
  return <button type="button" aria-pressed={!!active} onClick={() => onSelect(resource.ref)} className={`flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${active ? "border-accent bg-accent/5" : "border-border hover:border-accent/50 hover:bg-bg-hover"}`}>
    <ResourceMark resource={resource} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{resource.name}</span><span className="block truncate text-[10px] capitalize text-text-dim">{detail || `${resource.ref.type} · ${resource.status}`}</span></span>
  </button>;
}
export function StateBadge({ label, live = false, attention = false }: { label: string; live?: boolean; attention?: boolean }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold capitalize ${attention ? "border-error/30 text-error" : live ? "border-accent/40 text-accent" : "border-border text-text-muted"}`}>
    {live && <svg aria-hidden="true" className="motion-safe:animate-pulse" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1 6h2l1-4 3 8 1-4h3" /></svg>}{label}
  </span>;
}
export function EmptyWidget({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return <div className="flex min-h-36 flex-col items-start justify-center gap-2 p-5"><p className="text-sm font-semibold">{title}</p><p className="max-w-md text-xs leading-relaxed text-text-muted">{detail}</p>{children && <div className="mt-1 flex flex-wrap gap-2">{children}</div>}</div>;
}
