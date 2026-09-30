import { Link } from "react-router-dom";
import { resourceKey } from "./workspaceModel";
import { contextFor, EmptyWidget, WidgetSection, type SystemWidgetProps } from "./WorkspaceWidgetUI";

export function QuickActionsWidget(props: SystemWidgetProps) {
  const { context, actions } = contextFor(props);
  const selected = context.selected && props.system.resources.get(resourceKey(context.selected));
  const issues = [...props.system.states.values()].filter(state => state.attention).length + props.apps.filter(app => app.status === "error").length + props.connections.filter(connection => ["error", "expired", "failed"].includes(connection.status)).length;
  const unattached = props.agents.filter(agent => props.attachments[agent.id] && !props.attachments[agent.id].error && !(props.system.edges.get(agent.id) || []).length);
  const empty = !props.agents.length;
  const suggestions = selected ? [
    { title: `Explain ${selected.name}`, detail: "Understand its role and connections.", prompt: `Explain ${selected.ref.type} “${selected.name}” (ID ${selected.ref.id}), what it does and how it connects to the rest of this project.` },
    { title: "Help me change this", detail: "Discuss a change before applying it.", prompt: `I want to improve ${selected.ref.type} “${selected.name}” (ID ${selected.ref.id}). Help me clarify the change and what it affects.` },
  ] : empty ? [
    { title: "Turn an idea into a system", detail: "Start with what you want to achieve.", prompt: "Help me build an agent system in this project. Start by asking what I want to achieve, then suggest the agents and existing apps that would help." },
  ] : [
    { title: "Explain my system", detail: "Understand the agents and how their capabilities fit together.", prompt: "Explain the agents and attached capabilities in this project. Describe what is configured, what is running, and any gaps you can confirm." },
    ...(issues ? [{ title: "Investigate reported issues", detail: `${issues} resources need attention.`, prompt: "Help me investigate the reported agent, app, or integration issues in this project. Check their current state before suggesting changes." }] : [{ title: "Try a small task", detail: "Choose a useful first run for this setup.", prompt: "Suggest a small useful task for this project's existing agents and apps. Help me choose the input and describe what a successful result would look like." }]),
    ...(unattached.length ? [{ title: "Give agents capabilities", detail: `${unattached.length} agents have no confirmed attachments.`, prompt: `Help me choose useful apps, integrations, or skills for these agents: ${unattached.map(agent => `${agent.name} (ID ${agent.id})`).join(", ")}.` }] : []),
  ];
  const card = "min-w-0 rounded-lg border border-border p-3 text-left transition-colors hover:border-accent/60 hover:bg-bg-hover";
  const editor = context.pageId ? `/settings?tab=pages&page=${encodeURIComponent(context.pageId)}&${context.scope === "global" ? "scope=global" : `project=${encodeURIComponent(context.projectId || "")}`}` : "/settings?tab=pages";
  return <WidgetSection title="Quick actions" description={selected ? `Continue with ${selected.name}.` : empty ? "Start building from an idea." : "Useful next steps for this workspace."}>
    <div className="min-h-0 max-h-[640px] flex-1 overflow-auto p-3">
      {props.loading ? <EmptyWidget title="Loading your workspace…" detail="Suggestions will reflect the agents and capabilities available here." /> : <>
        <div className="grid gap-2 @lg:grid-cols-2">{suggestions.map(suggestion => <button key={suggestion.title} type="button" disabled={!context.projectId} onClick={() => actions.dispatch({ type: "ask_helper", prompt: suggestion.prompt })} className={`${card} border-accent/30 disabled:opacity-50`}><span className="block text-xs font-semibold text-accent">{suggestion.title} →</span><span className="mt-1 block text-[11px] leading-relaxed text-text-muted">{suggestion.detail}</span></button>)}</div>
        <p className="mt-2 text-[10px] text-text-dim">{context.projectId ? "Opens a suggestion for Helper. You decide what to send." : "Choose a project to use Helper suggestions."}</p>
        <div className="mt-4 grid gap-2 @lg:grid-cols-2">
          {selected && <button className={card} onClick={() => actions.dispatch({ type: "configure", resource: selected.ref })}><span className="block text-xs font-semibold">Manage selection</span><span className="mt-1 block text-[11px] text-text-muted">Open the existing management screen.</span></button>}
          <Link className={card} to="/agents/new"><span className="block text-xs font-semibold">{empty ? "Create your first agent" : "Add an agent"}</span><span className="mt-1 block text-[11px] text-text-muted">Define its role and capabilities.</span></Link>
          <Link className={card} to="/apps"><span className="block text-xs font-semibold">Browse apps</span><span className="mt-1 block text-[11px] text-text-muted">Add tools and views to the workspace.</span></Link>
          <Link className={card} to="/integrations"><span className="block text-xs font-semibold">Connect a service</span><span className="mt-1 block text-[11px] text-text-muted">Use your existing services and accounts.</span></Link>
          <Link className={card} to={editor}><span className="block text-xs font-semibold">{context.pageId ? "Edit this page" : "Manage pages"}</span><span className="mt-1 block text-[11px] text-text-muted">Arrange the widgets around your work.</span></Link>
        </div>
      </>}
    </div>
  </WidgetSection>;
}
