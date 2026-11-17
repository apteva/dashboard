import { useState } from "react";
import { AgentActivityIcon } from "../AgentActivityIcon";
import { buildToolVisualRegistry } from "../chat/toolVisuals";
import { activityID } from "./useWorkspaceActivity";
import { activityState, resourceActivity, isRoutineActivity, isResultActivity } from "./workspaceActivityModel";
import { resourceKey } from "./workspaceModel";
import { contextFor, EmptyWidget, WidgetSection, widgetButton, widgetInput, type SystemWidgetProps } from "./WorkspaceWidgetUI";

export function WorkspaceActivityWidget(props: SystemWidgetProps) {
  const { context, actions } = contextFor(props);
  const [kind, setKind] = useState("all");
  const [agentId, setAgentId] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [query, setQuery] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [followSelection, setFollowSelection] = useState(false);
  const [limit, setLimit] = useState(40);
  const [view, setView] = useState<"work" | "results">("work");
  const [showRoutine, setShowRoutine] = useState(false);
  const { activity, resources, edges, connection, now } = props.system;
  const selected = context.selected && resources.get(resourceKey(context.selected));
  const needle = query.trim().toLowerCase();
  const registryFor = (id: number) => {
    const project = props.agents.find(agent => agent.id === id)?.project_id;
    return buildToolVisualRegistry(props.apps.filter(app => !app.project_id || app.project_id === project), props.connections.filter(c => !c.project_id || c.project_id === project), props.inventory.filter(row => !row.project_id || row.project_id === project));
  };
  const matching = [...activity.values()].reverse().filter(row => {
    const { item, resource, title, summary } = row;
    const state = activityState(item, now, connection === "open", props.activity.rows);
    const category = ["thread", "channel"].includes(item.kind) ? "event" : item.kind;
    return (agentId === "all" || String(item.raw.instance_id) === agentId)
      && (kind === "all" || category === kind)
      && (outcome === "all" || (outcome === "running" ? state === "In progress" : outcome === "error" ? item.status === "error" : state === "Finished"))
      && (!followSelection || resourceActivity(item, selected, resource, edges))
      && (!needle || [title, summary, resource?.name, item.toolName, props.agents.find(agent => agent.id === item.raw.instance_id)?.name].some(text => text?.toLowerCase().includes(needle)));
  });
  const routineCount = matching.filter(row => isRoutineActivity(row.item)).length;
  const results = matching.filter(row => isResultActivity(row.item));
  // Explicit thought/search filters reveal all matching records automatically.
  const foldRoutine = !showRoutine && kind === "all" && !needle && outcome === "all";
  const rows = view === "results" ? results : matching.filter(row => !foldRoutine || !isRoutineActivity(row.item));
  const clear = () => { setKind("all"); setAgentId("all"); setOutcome("all"); setQuery(""); setFollowSelection(false); setLimit(40); };
  const filtered = kind !== "all" || agentId !== "all" || outcome !== "all" || !!query || followSelection;
  return <WidgetSection title="Activity" description={`${connection === "open" ? "Live updates" : connection === "reconnecting" ? "Reconnecting · recorded activity" : "Recorded activity"} · ${rows.length} entries`} action={<button className={widgetButton} onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>{filtered ? "Filters active" : "Filter"}</button>}>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border px-3 py-1">
      <div className="flex gap-1" role="group" aria-label="Activity view">{([ ["work", "Work"], ["results", `Results (${results.length})`] ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => { setView(key); setLimit(40); }} className={`min-h-9 rounded px-2 text-xs font-semibold ${view === key ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-bg-hover"}`}>{label}</button>)}</div>
      {view === "work" && routineCount > 0 && kind === "all" && !needle && outcome === "all" && <button type="button" aria-pressed={showRoutine} onClick={() => setShowRoutine(value => !value)} className="min-h-9 text-[10px] text-text-muted hover:text-accent">{showRoutine ? "Hide" : "Show"} routine ({routineCount})</button>}
      {view === "results" && <span className="text-[10px] text-text-dim">Responses & tool outputs</span>}
    </div>
    <div className="min-h-0 max-h-[560px] flex-1 overflow-auto">
      {moreFilters && <div className="space-y-2 border-b border-border p-3">
        <div className="flex flex-wrap gap-2"><select aria-label="Activity agent" value={agentId} onChange={e => { setAgentId(e.target.value); setLimit(40); }} className={`${widgetInput} flex-1`}><option value="all">All agents</option>{props.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><select aria-label="Activity type" value={kind} onChange={e => { setKind(e.target.value); setLimit(40); }} className={widgetInput}><option value="all">All activity</option><option value="thought">Thoughts</option><option value="tool">Tools</option><option value="event">Events</option><option value="error">Errors</option></select><select aria-label="Activity outcome" value={outcome} onChange={e => setOutcome(e.target.value)} className={widgetInput}><option value="all">Any outcome</option><option value="running">In progress</option><option value="success">Finished</option><option value="error">Failed</option></select></div>
        <input className={`${widgetInput} w-full`} aria-label="Search activity" placeholder="Search actions, agents, or apps…" value={query} onChange={e => { setQuery(e.target.value); setLimit(40); }} />
        <div className="flex flex-wrap items-center gap-3"><label className="flex min-h-9 items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={followSelection} onChange={e => setFollowSelection(e.target.checked)} />Follow selection{selected ? `: ${selected.name}` : ""}</label>{filtered && <button className="min-h-9 text-xs text-accent" onClick={clear}>Reset filters</button>}</div>
      </div>}
      {props.activity.error && <p role="status" className="p-3 text-xs text-yellow">{props.activity.error}</p>}
      <div className="divide-y divide-border">{rows.slice(0, limit).map(({ item, resource, title, summary }) => {
        const agent = props.agents.find(agent => agent.id === item.raw.instance_id);
        const state = activityState(item, now, connection === "open", props.activity.rows);
        const date = new Date(item.time);
        return <button key={activityID(item)} type="button" aria-pressed={context.activityId === activityID(item)} onClick={() => actions.dispatch({ type: "select_activity", id: activityID(item), resource: { type: "agent", id: item.raw.instance_id, label: agent?.name, projectId: agent?.project_id } })} className={`flex h-[76px] w-full min-w-0 items-center gap-3 px-3 text-left transition-colors hover:bg-bg-hover ${context.activityId === activityID(item) ? "bg-accent/5 shadow-[inset_2px_0_0_var(--accent)]" : ""}`}>
          <AgentActivityIcon event={item.status === "running" && state !== "In progress" ? { ...item, status: "info" } : item} registry={registryFor(item.raw.instance_id)} />
          <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span title={item.toolName || title} className="truncate text-xs font-semibold">{title}</span><span className={`shrink-0 text-[9px] ${state === "Failed" ? "text-error" : state === "In progress" ? "text-accent" : "text-text-dim"}`}>{state}</span></span><span className="block truncate text-[11px] text-text-muted">{summary}</span><span className="block truncate text-[10px] text-text-dim">{agent?.name || `Agent ${item.raw.instance_id}`}{resource ? ` · ${resource.name}` : ""}</span></span>
          {Number.isFinite(date.getTime()) && <time dateTime={item.time} title={date.toLocaleString()} className="shrink-0 text-[10px] text-text-dim">{date.toLocaleDateString() === new Date(now).toLocaleDateString() ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" })}</time>}
        </button>;
      })}</div>
      {rows.length > limit && <button className="min-h-10 w-full text-xs font-semibold text-accent" onClick={() => setLimit(value => value + 40)}>Show more ({rows.length - limit})</button>}
      {rows.length === 0 && <EmptyWidget title={props.activity.loading ? "Loading activity…" : filtered ? "No matching activity" : view === "results" ? "No recorded outputs yet" : routineCount ? "All quiet for now" : "Your system’s activity appears here"} detail={filtered ? "Try another filter or clear the selection filter." : view === "results" ? "Recorded responses and tool outputs appear here as work completes." : routineCount ? "Routine waiting updates are folded away. Show routine to see them." : "Thoughts, tool actions, and events will appear as your agents work."}>{filtered && <button className={widgetButton} onClick={clear}>Reset filters</button>}</EmptyWidget>}
    </div>
  </WidgetSection>;
}
