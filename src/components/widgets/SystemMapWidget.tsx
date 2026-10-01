import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "../Modal";
import { resourceKey } from "./workspaceModel";
import { activityID } from "./useWorkspaceActivity";
import { isResultActivity } from "./workspaceActivityModel";
import { contextFor, EmptyWidget, ResourceButton, ResourceMark, StateBadge, WidgetSection, widgetButton, widgetInput, type SystemWidgetProps } from "./WorkspaceWidgetUI";

const CARD_HEIGHT = 184;
const GAP = 12;

export function SystemMapWidget(props: SystemWidgetProps) {
  const { context, actions } = contextFor(props);
  const { resources, edges, states, highlighted, changes, activity } = props.system;
  const workspace = context.presentation === "workspace";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [columns, setColumns] = useState(1);
  const [rows, setRows] = useState(2);
  const [iconCount, setIconCount] = useState(3);
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT);
  const viewport = useRef<HTMLDivElement>(null);
  const [capabilityAgent, setCapabilityAgent] = useState<number | null>(null);
  const [capabilityQuery, setCapabilityQuery] = useState("");
  const [capabilityPage, setCapabilityPage] = useState(0);
  const [showChanges, setShowChanges] = useState(false);

  // Workspace panes have a fixed height. Fit whole cards into that space;
  // ordinary dashboard widgets use two rows and grow with the page.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      const box = element.getBoundingClientRect();
      if (!box.width) return;
      const count = Math.max(1, Math.min(3, Math.floor((box.width + GAP) / (280 + GAP))));
      setColumns(count);
      const cardWidth = (box.width - (count - 1) * GAP) / count;
      setIconCount(cardWidth >= 310 ? 4 : cardWidth >= 260 ? 3 : 2);
      setRows(workspace ? Math.max(1, Math.min(3, Math.floor((box.height + GAP) / (CARD_HEIGHT + GAP)))) : 2);
      setCardHeight(workspace ? Math.max(112, Math.min(CARD_HEIGHT, Math.floor(box.height))) : CARD_HEIGHT);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspace]);

  const needle = query.toLowerCase().trim();
  const selectedKey = context.selected && resourceKey(context.selected);
  const selectedActivity = context.activityId ? activity.get(context.activityId) : undefined;
  const relatedKey = selectedActivity?.resource && resourceKey(selectedActivity.resource.ref);
  const recentActivity = [...activity.values()].reverse();
  const agents = props.agents.filter(agent => {
    const state = states.get(agent.id);
    if ((filter === "working" && !state?.live) || (filter === "attention" && !state?.attention && !props.attachments[agent.id]?.error)) return false;
    return !needle || [resources.get(`agent:${agent.id}`), ...(edges.get(agent.id) || []).map(key => resources.get(key))].some(resource => resource?.name.toLowerCase().includes(needle));
  });
  const pageSize = columns * rows;
  const pageCount = Math.max(1, Math.ceil(agents.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleAgents = agents.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const activeCount = [...states.values()].filter(state => state.live).length;
  const openCapabilities = (id: number) => { setCapabilityAgent(id); setCapabilityQuery(""); setCapabilityPage(0); };
  const inspectedAgent = props.agents.find(agent => agent.id === capabilityAgent);
  const capabilityList = (capabilityAgent === null ? [] : edges.get(capabilityAgent) || [])
    .map(key => resources.get(key)).filter(resource => !!resource)
    .filter(resource => resource.name.toLowerCase().includes(capabilityQuery.trim().toLowerCase()));
  const capabilityPages = Math.max(1, Math.ceil(capabilityList.length / 8));
  const currentCapabilityPage = Math.min(capabilityPage, capabilityPages - 1);

  return <><WidgetSection title="Agents" description={`${props.agents.length} agents · ${activeCount} working`} action={<Link to="/agents" className={widgetButton}>View all ↗</Link>}>
    <div className={`system-map-body flex min-h-0 flex-1 flex-col gap-3 p-3 ${workspace ? "overflow-hidden" : ""}`}>
      <div className="flex shrink-0 flex-wrap gap-2">
        <input aria-label="Search agents and capabilities" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Find an agent or capability…" className={`${widgetInput} w-36 flex-1 px-3`} />
        <select aria-label="Agent state" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} className={widgetInput}><option value="all">All agents</option><option value="working">Working now</option><option value="attention">Needs attention</option></select>
        <button type="button" className={widgetButton} onClick={props.refresh} aria-label="Refresh agents" title="Refresh">↻</button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{changes[0] ? `${changes[0].name}: ${changes[0].detail}` : ""}</p>
      <div ref={viewport} className={`min-w-0 ${workspace ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {visibleAgents.map(agent => {
            const resource = resources.get(`agent:${agent.id}`)!;
            const state = states.get(agent.id)!;
            const keys = edges.get(agent.id) || [];
            const capabilities = keys.map(key => resources.get(key)).filter(resource => !!resource);
            const priority = relatedKey || (selectedKey !== `agent:${agent.id}` ? selectedKey : undefined) || (state.resource && resourceKey(state.resource.ref));
            const ordered = [...capabilities].sort((a, b) => {
              const score = (key: string, name: string) => key === priority ? 2 : needle && name.toLowerCase().includes(needle) ? 1 : 0;
              return score(resourceKey(b.ref), b.name) - score(resourceKey(a.ref), a.name);
            });
            const selected = selectedKey === `agent:${agent.id}` || !!selectedKey && keys.includes(selectedKey);
            const change = highlighted.get(`agent:${agent.id}`);
            const last = recentActivity.find(row => row.item.raw.instance_id === agent.id && isResultActivity(row.item));
            const attachment = props.attachments[agent.id];
            return <article key={agent.id} aria-label={agent.name} style={{ height: cardHeight }} className={`flex min-w-0 flex-col gap-2 rounded-lg border bg-bg p-3 transition-colors ${selected ? "border-accent" : change ? "border-accent/60" : "border-border"}`}>
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" aria-pressed={selectedKey === `agent:${agent.id}`} onClick={() => actions.select(resource.ref)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-accent">
                  <ResourceMark resource={resource} /><span className="min-w-0"><span className="block truncate text-sm font-semibold" title={agent.name}>{agent.name}</span><span className="block truncate text-[10px] capitalize text-text-dim">{props.allProjects ? props.projectNames.get(agent.project_id || "") || "Global" : agent.mode || "Agent"}</span></span>
                </button>
                <StateBadge label={state.label} live={state.live} attention={state.attention} />
              </div>
              {cardHeight >= 176 && <p className={`truncate text-[11px] ${attachment?.error ? "text-yellow" : "text-text-muted"}`} title={attachment?.error || state.detail}>{attachment?.error || state.detail}</p>}
              <div className="mt-auto flex min-w-0 items-center gap-2 border-t border-border pt-2">
                <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-dim">Capabilities</span>
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  {ordered.slice(0, iconCount).map(capability => {
                    const key = resourceKey(capability.ref);
                    const hot = state.live && state.resource && key === resourceKey(state.resource.ref);
                    return <button key={key} type="button" aria-label={`Inspect ${capability.name}`} aria-pressed={selectedKey === key} title={`${capability.name} · ${capability.ref.type}`} onClick={() => actions.select(capability.ref)} className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-accent focus-visible:outline-accent ${selectedKey === key || hot ? "border-accent bg-accent/5" : "border-border hover:border-accent/50"} ${hot ? "motion-safe:animate-pulse" : ""}`}><ResourceMark resource={capability} /></button>;
                  })}
                  {ordered.length > iconCount && <button type="button" aria-label={`View all ${ordered.length} capabilities for ${agent.name}`} title={`View all ${ordered.length} capabilities`} className="min-h-8 shrink-0 rounded-md border border-border px-1.5 text-[10px] font-semibold text-text-muted hover:border-accent hover:text-accent" onClick={() => openCapabilities(agent.id)}>+{ordered.length - iconCount}</button>}
                  {!attachment ? <span className="truncate text-[10px] text-text-dim">Loading…</span> : !keys.length && <span className="truncate text-[10px] text-text-dim">{attachment.error ? "Unavailable" : "None attached"}</span>}
                </div>
              </div>
              {cardHeight >= 144 && <div className="flex items-center justify-between gap-2 text-[10px]">
                {last ? <button type="button" title={last.summary} className="min-h-6 truncate font-semibold text-accent" onClick={() => actions.dispatch({ type: "select_activity", id: activityID(last.item), resource: resource.ref })}>Latest result →</button> : <span className="truncate text-text-dim">{change ? `${change.kind} just now` : ""}</span>}
                <Link to={`/agents/${agent.id}`} className="min-h-6 shrink-0 py-1 text-text-muted hover:text-accent" aria-label={`Open ${agent.name}`}>Open agent ↗</Link>
              </div>}
            </article>;
          })}
        </div>
        {agents.length === 0 && (props.agents.length ? <EmptyWidget title="No matching agents" detail="Try another name or state filter."><button className={widgetButton} onClick={() => { setQuery(""); setFilter("all"); setPage(0); }}>Reset filters</button></EmptyWidget> : <EmptyWidget title="Start with an idea" detail="Add an agent and give it apps and integrations."><button className={widgetButton} onClick={() => actions.dispatch({ type: "ask_helper", prompt: "Help me turn an idea into an agent system in this project. First help me clarify what I want to achieve." })}>Plan with Helper</button><Link className={widgetButton} to="/agents/new">Add an agent</Link></EmptyWidget>)}
      </div>
      <footer className="flex min-h-9 shrink-0 items-center justify-between gap-2 text-[10px] text-text-dim">
        <span>{agents.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, agents.length)} of ${agents.length}` : "0 agents"}{changes.length > 0 && <button type="button" className="ml-2 min-h-9 text-accent" onClick={() => setShowChanges(true)}>Changes ({changes.length})</button>}</span>
        {pageCount > 1 && <nav aria-label="Agent pages" className="flex gap-1"><button type="button" className={widgetButton} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button type="button" className={widgetButton} disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
      </footer>
    </div>
  </WidgetSection>
    <Modal open={!!inspectedAgent} onClose={() => setCapabilityAgent(null)} ariaLabel={`${inspectedAgent?.name || "Agent"} capabilities`} width="max-w-xl">
      <div className="flex max-h-[80dvh] flex-col p-4">
        <header className="mb-3 flex items-center justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{inspectedAgent?.name}</h3><p className="text-xs text-text-muted">Apps, integrations, and other capabilities</p></div><button type="button" className={widgetButton} onClick={() => setCapabilityAgent(null)}>Close</button></header>
        <input aria-label="Search agent capabilities" placeholder="Find a capability…" value={capabilityQuery} onChange={event => { setCapabilityQuery(event.target.value); setCapabilityPage(0); }} className={`${widgetInput} mb-3 shrink-0 px-3`} />
        <div className="grid min-h-0 gap-2 overflow-y-auto sm:grid-cols-2">{capabilityList.slice(currentCapabilityPage * 8, (currentCapabilityPage + 1) * 8).map(resource => <ResourceButton key={resourceKey(resource.ref)} resource={resource} selected={context.selected} onSelect={ref => { setCapabilityAgent(null); actions.select(ref); }} />)}{!capabilityList.length && <p className="py-4 text-xs text-text-muted">No matching capabilities.</p>}</div>
        <footer className="mt-3 flex shrink-0 items-center justify-between gap-2 text-xs text-text-muted"><span>{capabilityList.length} capabilities</span>{capabilityPages > 1 && <nav aria-label="Capability pages" className="flex gap-1"><button type="button" className={widgetButton} disabled={!currentCapabilityPage} onClick={() => setCapabilityPage(currentCapabilityPage - 1)}>Previous</button><button type="button" className={widgetButton} disabled={currentCapabilityPage === capabilityPages - 1} onClick={() => setCapabilityPage(currentCapabilityPage + 1)}>Next</button></nav>}</footer>
      </div>
    </Modal>
    <Modal open={showChanges} onClose={() => setShowChanges(false)} ariaLabel="System changes" width="max-w-lg"><div className="max-h-[75dvh] overflow-y-auto p-4"><header className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Recent changes</h3><button className={widgetButton} onClick={() => setShowChanges(false)}>Close</button></header><p className="mb-3 text-xs text-text-dim">Observed while this page is open.</p>{changes.map(change => <div key={`${change.key}:${change.at}`} className="border-b border-border py-2 text-xs"><p className="font-semibold">{change.kind} · {change.name}</p><p className="mt-1 text-text-muted">{change.detail}</p></div>)}</div></Modal>
  </>;
}
