import { useState } from "react";
import { Link } from "react-router-dom";
import { resourceKey } from "./workspaceModel";
import { activityID } from "./useWorkspaceActivity";
import { isResultActivity } from "./workspaceActivityModel";
import { contextFor, EmptyWidget, ResourceButton, ResourceMark, StateBadge, WidgetSection, widgetButton, widgetInput, type SystemWidgetProps } from "./WorkspaceWidgetUI";

export function SystemMapWidget(props: SystemWidgetProps) {
  const { context, actions } = contextFor(props);
  const { resources, edges, states, highlighted, changes, activity } = props.system;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [showChanges, setShowChanges] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const needle = query.toLowerCase().trim();
  const selectedKey = context.selected && resourceKey(context.selected);
  const selectedActivity = context.activityId ? activity.get(context.activityId) : undefined;
  const relatedKey = selectedActivity?.resource && resourceKey(selectedActivity.resource.ref);
  const usage = new Map<string, number>();
  for (const keys of edges.values()) for (const key of keys) usage.set(key, (usage.get(key) || 0) + 1);
  const shared = [...resources.values()].filter(resource => (usage.get(resourceKey(resource.ref)) || 0) > 1)
    .sort((a, b) => (usage.get(resourceKey(b.ref)) || 0) - (usage.get(resourceKey(a.ref)) || 0));
  const agents = props.agents.filter(agent => {
    const state = states.get(agent.id);
    if (filter === "working" && !state?.live || filter === "attention" && !state?.attention && !props.attachments[agent.id]?.error) return false;
    return !needle || [resources.get(`agent:${agent.id}`), ...(edges.get(agent.id) || []).map(key => resources.get(key))].some(resource => resource?.name.toLowerCase().includes(needle));
  });
  const available = [...resources.values()].filter(resource => resource.ref.type !== "agent" && !usage.has(resourceKey(resource.ref)) && (!needle || resource.name.toLowerCase().includes(needle)));
  const activeCount = [...states.values()].filter(state => state.live).length;
  return <WidgetSection title="System map" description={`${props.agents.length} agents · ${activeCount} working · Select a node to explore.`} action={<button type="button" className={widgetButton} onClick={props.refresh}>Refresh</button>}>
    <div className="min-h-0 max-h-[680px] flex-1 overflow-auto p-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <input aria-label="Search system" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an agent or capability…" className={`${widgetInput} w-40 flex-1 px-3`} />
        <select aria-label="System state" value={filter} onChange={e => setFilter(e.target.value)} className={widgetInput}><option value="all">All agents</option><option value="working">Working now</option><option value="attention">Needs attention</option></select>
        {changes.length > 0 && <button className={widgetButton} aria-expanded={showChanges} onClick={() => setShowChanges(!showChanges)}>Changes ({changes.length})</button>}
      </div>
      <p role="status" aria-live="polite" className="sr-only">{changes[0] ? `${changes[0].name}: ${changes[0].detail}` : ""}</p>
      {showChanges && <div className="mb-3 space-y-1 rounded-lg border border-accent/30 p-3"><p className="mb-2 text-[10px] text-text-dim">Changes observed while this page is open</p>{changes.slice(0, 8).map(change => <div key={`${change.key}:${change.at}`} className="text-xs"><span className="font-semibold">{change.kind} · {change.name}</span><span className="ml-2 text-text-muted">{change.detail}</span></div>)}</div>}
      {shared.length > 0 && <div className="mb-3 rounded-lg border border-border bg-bg">
        <button type="button" aria-expanded={showShared} onClick={() => setShowShared(value => !value)} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs text-text-muted">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-accent"><rect x="2" y="3" width="5" height="5" rx="1"/><rect x="2" y="16" width="5" height="5" rx="1"/><rect x="17" y="9" width="5" height="6" rx="1"/><path d="M7 5.5h5V12h5M7 18.5h5V12"/></svg>
          <span className="flex-1">Shared capabilities <span className="text-text-dim">· {shared.length}</span></span><span className="shrink-0 text-[10px]">{showShared ? "Hide" : "Explore →"}</span>
        </button>
        {showShared && <div className="max-h-52 overflow-auto border-t border-border p-2"><p className="mb-2 px-1 text-[10px] text-text-dim">Attached to more than one agent. Select one to highlight its connections.</p><div className="grid gap-2 @lg:grid-cols-2">{shared.map(resource => {
          const owners = props.agents.filter(agent => edges.get(agent.id)?.includes(resourceKey(resource.ref)));
          return <ResourceButton key={resourceKey(resource.ref)} resource={resource} selected={context.selected} onSelect={actions.select} detail={owners.map(agent => agent.name).join(" · ")} />;
        })}</div></div>}
      </div>}
      <div className="space-y-3">{agents.map(agent => {
        const resource = resources.get(`agent:${agent.id}`)!;
        const state = states.get(agent.id)!;
        const keys = edges.get(agent.id) || [];
        const capabilities = keys.map(key => resources.get(key)).filter(resource => !!resource);
        const matching = needle && !agent.name.toLowerCase().includes(needle) ? capabilities.filter(resource => resource.name.toLowerCase().includes(needle)) : capabilities;
        const priority = relatedKey || (selectedKey !== `agent:${agent.id}` ? selectedKey : undefined) || (state.resource && resourceKey(state.resource.ref));
        const recentKeys = [...activity.values()].reverse().filter(row => row.item.raw.instance_id === agent.id && row.resource).map(row => resourceKey(row.resource!.ref));
        const score = (key: string) => key === priority ? 1000 : recentKeys.includes(key) ? 100 - Math.min(80, recentKeys.indexOf(key)) : usage.get(key) === 1 ? 10 : 0;
        const ordered = [...matching].sort((a, b) => score(resourceKey(b.ref)) - score(resourceKey(a.ref)));
        const shown = expanded.has(agent.id) || needle ? ordered : ordered.slice(0, 4);
        const selected = selectedKey === `agent:${agent.id}` || !!selectedKey && keys.includes(selectedKey);
        const change = highlighted.get(`agent:${agent.id}`);
        const last = [...activity.values()].reverse().find(row => row.item.raw.instance_id === agent.id && isResultActivity(row.item));
        return <article key={agent.id} aria-label={agent.name} className="relative">
          <div className="grid min-w-0 gap-0 @2xl:grid-cols-[minmax(160px,0.85fr)_36px_minmax(0,1.5fr)]">
            <div className={`min-w-0 self-start space-y-2 rounded-lg border p-3 transition-colors ${selected ? "border-accent bg-accent/5" : change ? "border-accent/60" : "border-border bg-bg"}`}>
              <button type="button" aria-pressed={selectedKey === `agent:${agent.id}`} onClick={() => actions.select(resource.ref)} className="flex w-full min-w-0 items-center gap-3 rounded-lg p-1 text-left hover:bg-bg-hover"><ResourceMark resource={resource} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold" title={agent.name}>{agent.name}</span><span className="block text-[10px] capitalize text-text-dim">{props.allProjects ? props.projectNames.get(agent.project_id || "") || "Global" : agent.mode || "Agent"}</span></span></button>
              <div className="flex flex-wrap items-center justify-between gap-2"><StateBadge label={state.label} live={state.live} attention={state.attention} />{change && <span className="self-center text-[10px] font-semibold text-accent">{change.kind}</span>}{last && <button type="button" title={last.summary} className="min-h-8 max-w-full truncate text-left text-[10px] font-semibold text-accent" onClick={() => actions.dispatch({ type: "select_activity", id: activityID(last.item), resource: resource.ref })}>Latest result →</button>}</div>
              {(state.live || state.attention) && <p className="line-clamp-2 text-[11px] leading-relaxed text-text-muted">{state.detail}</p>}
            </div>
            <div aria-hidden="true" className={`relative ml-6 h-5 border-l-2 @2xl:ml-0 @2xl:h-auto @2xl:border-l-0 ${selected || state.live ? "border-accent text-accent" : "border-border text-text-dim"}`}><svg className="absolute top-6 hidden w-full @2xl:block" height="20" viewBox="0 0 36 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M0 10h32m-5-4 5 4-5 4" /></svg></div>
            <div className={`relative min-w-0 rounded-lg border p-2.5 ${selected || state.live ? "border-accent/50" : "border-border"}`}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-dim">Can use · {keys.length} <span className="font-normal normal-case tracking-normal">attached</span></p>
              <div className="grid grid-cols-2 gap-2">{shown.map(capability => {
                const key = resourceKey(capability.ref);
                const hot = key === relatedKey || state.live && key === resourceKey(state.resource?.ref || { type: "mcp", id: "" });
                const changed = highlighted.get(key);
                return <button key={key} type="button" aria-pressed={selectedKey === key} title={`${capability.name} · ${capability.status}${(usage.get(key) || 0) > 1 ? ` · Shared by ${usage.get(key)} agents` : ""}`} onClick={() => actions.select(capability.ref)} className={`flex min-h-12 min-w-0 items-center gap-2 rounded-md border p-2 text-left transition-colors ${selectedKey === key || hot ? "border-accent bg-accent/5" : changed ? "border-accent/50" : "border-border hover:border-accent/50"}`}>
                  <span className={hot && state.live ? "motion-safe:animate-pulse" : undefined}><ResourceMark resource={capability} /></span><span className="min-w-0"><span className="block truncate text-[11px] font-semibold">{capability.name}</span><span className="block truncate text-[9px] capitalize text-text-dim">{changed?.kind || ((usage.get(key) || 0) > 1 ? `Shared · ${usage.get(key)} agents` : capability.ref.type)}</span></span>
                </button>;
              })}</div>
              {!props.attachments[agent.id] ? <p className="text-xs text-text-muted">Loading capabilities…</p> : keys.length === 0 && <p className="text-xs text-text-muted">No attached capabilities.</p>}
              {props.attachments[agent.id]?.error && <p className="mt-2 text-xs text-yellow">{props.attachments[agent.id].error}</p>}
              {!needle && matching.length > 4 && <button type="button" aria-expanded={expanded.has(agent.id)} className="mt-1 min-h-9 text-xs font-semibold text-accent" onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(agent.id)) next.delete(agent.id); else next.add(agent.id); return next; })}>{expanded.has(agent.id) ? "Show fewer" : `All ${matching.length} capabilities →`}</button>}
            </div>
          </div>
        </article>;
      })}</div>
      {agents.length === 0 && (props.agents.length ? <EmptyWidget title="No matching agents" detail="Try another name or state filter."><button className={widgetButton} onClick={() => { setQuery(""); setFilter("all"); }}>Reset filters</button></EmptyWidget> : <EmptyWidget title="Start with an idea" detail="Add an agent, then attach apps and integrations to give it capabilities."><button className={widgetButton} onClick={() => actions.dispatch({ type: "ask_helper", prompt: "Help me turn an idea into an agent system in this project. First help me clarify what I want to achieve." })}>Plan with Helper</button><Link className={widgetButton} to="/agents/new">Add an agent</Link></EmptyWidget>)}
      {available.length > 0 && <details className="mt-3"><summary className="min-h-9 cursor-pointer py-2 text-xs text-text-muted">Available to attach · {available.length}</summary><div className="grid gap-2 @lg:grid-cols-2">{available.map(resource => <ResourceButton key={resourceKey(resource.ref)} resource={resource} selected={context.selected} onSelect={actions.select} />)}</div></details>}
    </div>
  </WidgetSection>;
}
