import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Agent } from "../api";
import type { Audience } from "../hooks/useAudience";
import type { RuntimeEventItem } from "./AgentView";
import { AppPanels } from "./AppPanels";
import { AgentActivity, AgentEventDetails } from "./AgentActivity";
import type { ToolVisualRegistry } from "./chat/toolVisuals";
import { WidgetCanvas, type WidgetDefinition } from "./apps/WidgetCanvas";
import { useInstalledAppsState } from "./apps/chatComponents";
import {
  ContributionMount, contributionsFor, defaultWidgetSettings, defaultWidgetSize,
  fetchEligibleContributionKeys, storedWidgetInstancesFor, supportedWidgetSizes,
  useProjectUILayout, type WidgetInstance,
} from "./apps/contributions";

const SLOT = "dashboard.agent_detail";
const buttonClass = "min-h-9 rounded-md border border-border px-3 text-xs font-semibold text-text-muted hover:border-accent hover:text-accent";

export function AgentOverviewCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="h-full min-w-0 rounded-lg border border-border p-3 sm:p-4">
    <h2 className="text-sm font-semibold text-text">{title}</h2>
    {subtitle && <p className="mt-1 text-xs leading-relaxed text-text-muted">{subtitle}</p>}
    <div className="mt-4">{children}</div>
  </section>;
}

// Only explicit response text is presented as a result. Reasoning and a
// successful tool call do not establish that a business task was completed.
function responseText(event: RuntimeEventItem) {
  if (event.status === "running") return "";
  const response = event.responseDetail?.trim() || "";
  if (/^(?:i(?:['’]ll| will| am|'m) (?:continue )?(?:wait|ready)|waiting\b|no (?:new |actionable )?(?:task|request|message)\b)/i.test(response)) return "";
  return response;
}

export function AgentOverview({ instance, projectId, audience, toolRegistry, events, loading, attachmentKey, onDetails, onActivity, onCapabilities }: {
  toolRegistry: ToolVisualRegistry;
  instance: Agent; projectId?: string; audience: Audience; events: RuntimeEventItem[]; loading: boolean;
  attachmentKey: string; onDetails: (id: string) => void; onActivity: () => void; onCapabilities: () => void;
}) {
  const { apps, ready } = useInstalledAppsState(projectId);
  const { project } = useProjectUILayout(projectId);
  const [editing, setEditing] = useState(false);
  const [selectedResponseKey, setSelectedResponseKey] = useState<string | null>(null);
  const selectedResponse = events.find((event) => (event.activityId || event.key) === selectedResponseKey) || null;
  const [galleryRequest, setGalleryRequest] = useState(0);
  const [retry, setRetry] = useState(0);
  const [eligibility, setEligibility] = useState<{ keys: Set<string>; error: boolean; ready: boolean }>({ keys: new Set(), error: false, ready: false });
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    setEligibility({ keys: new Set(), error: false, ready: false });
    fetchEligibleContributionKeys(projectId, SLOT, instance.id, undefined, controller.signal).then((keys) => {
      if (!cancelled) setEligibility({ keys, error: false, ready: true });
    }).catch(() => { if (!cancelled) setEligibility({ keys: new Set(), error: true, ready: true }); }).finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [projectId, instance.id, apps, attachmentKey, retry]);
  const contributions = useMemo(() => contributionsFor(apps, SLOT), [apps]);
  const eligible = contributions.filter((item) => eligibility.keys.has(item.key));
  const responses = [...events].reverse().filter((event) => event.kind === "thought" && !!responseText(event)).slice(0, 3);
  const definitions: WidgetDefinition[] = [
    { key: "native:agent-results", label: "Recent responses", description: "Explicit agent responses from recent activity.", supportedSizes: ["half", "full"], defaultSize: "half", kind: "builtin", render: () =>
      <AgentOverviewCard title="Recent responses" subtitle="Open a response to see its context.">
        {responses.length ? <div className="divide-y divide-border/60">{responses.map((event) => <button type="button" key={event.key} onClick={() => setSelectedResponseKey(event.activityId || event.key)} className="block w-full py-3 text-left hover:bg-bg-hover"><p className="line-clamp-3 break-words text-sm leading-relaxed text-text">{responseText(event)}</p></button>)}</div>
          : <p className="text-sm text-text-muted">{loading ? "Loading responses…" : "No recent responses yet. Outputs from your apps can be added as widgets."}</p>}
      </AgentOverviewCard> },
    { key: "native:agent-activity", label: "Recent activity", description: "Always on the overview. Resize it to leave room for your app widgets.", supportedSizes: ["half", "full"], defaultSize: "half", required: true, kind: "builtin", render: () =>
      <AgentOverviewCard title="Recent activity"><AgentActivity toolRegistry={toolRegistry} events={events} loading={loading} compact onDetails={onDetails} /><button type="button" className={`${buttonClass} mt-3`} onClick={onActivity}>View activity</button></AgentOverviewCard> },
    ...eligible.map((contribution): WidgetDefinition => ({
      key: contribution.key, label: contribution.spec.label || contribution.spec.name,
      description: contribution.spec.description, icon: contribution.app.icon, iconStyle: contribution.app.icon_style,
      supportedSizes: supportedWidgetSizes(contribution.spec), defaultSize: defaultWidgetSize(contribution.spec),
      defaultSettings: defaultWidgetSettings(contribution.spec), settingsSchema: contribution.spec.settings_schema,
      kind: "app", providerLabel: contribution.app.display_name || contribution.app.name, providerKey: contribution.app.name,
      suggested: contribution.spec.suggested && (!contribution.spec.recommended_views?.length || contribution.spec.recommended_views.includes(audience)),
      render: (widget, renderContext) => <ContributionMount instance={{ ...widget, contribution }} apps={apps} slot={SLOT} projectId={projectId} agentId={instance.id} widgetContext={renderContext?.context} widgetActions={renderContext?.actions} />,
    })),
  ];
  const builtin = (name: string): WidgetInstance => {
    const definition = definitions.find((item) => item.key === `native:agent-${name}`)!;
    return { id: `default:${definition.key}`, component: definition.key, size: definition.defaultSize };
  };
  // Inherit the existing project layout without rewriting it. Keep unknown or
  // temporarily unavailable app entries so customizing cannot erase them.
  const inherited = storedWidgetInstancesFor(contributions, SLOT, project);
  const hasProjectLayout = Object.prototype.hasOwnProperty.call(project.slots || {}, SLOT);
  const appDefaults = hasProjectLayout ? inherited : inherited.filter((widget) => {
    const spec = contributions.find((item) => item.key === widget.component)?.spec;
    return !spec?.recommended_views?.length || spec.recommended_views.includes(audience);
  });
  const defaultLayout = [builtin("activity"), ...appDefaults];
  const slot = `agent.${instance.id}.${audience}.overview`;
  return <div className="page-safe-bottom w-full space-y-3 p-3 sm:p-4">
    <AgentEventDetails toolRegistry={toolRegistry} event={selectedResponse} onClose={() => setSelectedResponseKey(null)} onDetails={onDetails} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xs font-semibold text-text-muted">Overview</h2>
      <div className="flex gap-2"><button type="button" disabled={!projectId || !ready || !eligibility.ready || eligibility.error} onClick={() => { setEditing(true); setGalleryRequest((value) => value + 1); }} className={`${buttonClass} disabled:opacity-40`}>Add widget</button>
        <button type="button" disabled={!projectId || !ready || !eligibility.ready || eligibility.error} onClick={() => setEditing(!editing)} className={`${buttonClass} disabled:opacity-40`}>{editing ? "Done" : "Customize"}</button></div>
    </div>
    {eligibility.error && <div role="status" className="rounded-lg border border-border p-3 text-xs text-yellow">App widgets could not be loaded. Your layout is saved. <button type="button" onClick={() => setRetry((value) => value + 1)} className="ml-2 underline">Retry</button></div>}
    <WidgetCanvas key={slot} projectId={projectId} slot={slot} definitions={definitions} defaultLayout={defaultLayout}
      editing={editing} onEditingChange={setEditing} galleryRequest={galleryRequest} definitionsReady={ready && (eligibility.ready || !projectId)}
      context={{ projectId, scope: "project", agentId: instance.id }} />
    {eligible.length === 0 && ready && eligibility.ready && !eligibility.error && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-3">
      <p className="flex-1 text-xs leading-relaxed text-text-muted">Apps can bring their own widgets here. Attach an app that provides agent widgets to get started.</p><button type="button" onClick={onCapabilities} className={buttonClass}>Explore capabilities</button>
    </div>}
    <AppPanels slot="instance.status" instanceId={instance.id} projectId={projectId} className="space-y-3" />
  </div>;
}
