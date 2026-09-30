import { useEffect, useState } from "react";
import { ChatComponentMount } from "../apps/chatComponents";
import { formatToolPayload } from "../../utils/runtimePayload";
import { activityState, isResultActivity } from "./workspaceActivityModel";
import { activityID } from "./useWorkspaceActivity";
import { contextFor, EmptyWidget, ResourceButton, ResourceMark, StateBadge, WidgetSection, widgetButton, type SystemWidgetProps } from "./WorkspaceWidgetUI";

function RecentResults(props: SystemWidgetProps) {
  const { context, actions } = contextFor(props);
  const rows = [...props.system.activity.values()].reverse().filter(row => isResultActivity(row.item)).slice(0, 12);
  return rows.length ? <div className="space-y-2"><p className="text-[11px] text-text-muted">Recent responses and tool outputs. Select one to inspect or refine.</p>{rows.map(row => {
    const agent = props.agents.find(agent => agent.id === row.item.raw.instance_id);
    const mark = row.resource || props.system.resources.get(`agent:${row.item.raw.instance_id}`);
    return <button type="button" key={activityID(row.item)} aria-pressed={context.activityId === activityID(row.item)} onClick={() => actions.dispatch({ type: "select_activity", id: activityID(row.item), resource: { type: "agent", id: row.item.raw.instance_id, label: agent?.name, projectId: agent?.project_id } })} className="flex min-h-20 w-full min-w-0 items-center gap-3 rounded-lg border border-border p-3 text-left hover:border-accent/60 hover:bg-bg-hover">
      {mark && <ResourceMark resource={mark} />}<span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{row.title}</span><span className="block truncate text-[11px] text-text-muted">{row.summary}</span><span className="block truncate text-[10px] text-text-dim">{agent?.name || `Agent ${row.item.raw.instance_id}`} · {new Date(row.item.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></span><span aria-hidden="true" className="text-accent">→</span>
    </button>;
  })}</div> : <EmptyWidget title="Your outputs will appear here" detail="Run a task with Helper or an agent, then return here to inspect recorded responses and tool outputs." />;
}

export function ResultPreviewWidget(props: SystemWidgetProps) {
  const { context, actions } = contextFor(props);
  const selected = context.activityId ? props.system.activity.get(context.activityId) : undefined;
  const item = selected?.item;
  const preview = context.preview;
  const [view, setView] = useState("output");
  const [copyState, setCopyState] = useState("");
  useEffect(() => { setView("output"); setCopyState(""); }, [context.activityId, preview]);
  const output: Array<[string, string]> = [];
  if (item) {
    if (item.responseDetail) output.push(["Response", item.responseDetail]);
    if (item.reasoningDetail) output.push(["Thought", item.reasoningDetail]);
    if (item.toolResult) output.push(["Tool result", item.toolResult]);
    if (!output.length && item.kind !== "tool" && item.kind !== "thought") output.push(["Details", item.detail || item.label]);
  } else if (preview) {
    const content = preview.text || (preview.data === undefined ? "" : formatToolPayload(preview.data, 20000));
    if (content) output.push(["Output", content]);
  }
  const component = preview?.component;
  const app = component && props.apps.find(app => app.install_id === component.installId && app.name === component.app && (app.status === "running" || app.serving) && (context.scope === "global" ? !app.project_id : !app.project_id || app.project_id === context.projectId));
  const allowed = app && component && app.ui_components?.some(spec => spec.name === component.name && spec.slots?.includes("chat.message_attachment") && (context.scope !== "global" || spec.dashboard_scopes?.includes("global")));
  const text = output.map(([label, value]) => `${label}\n${value}`).join("\n\n");
  const title = preview?.title || selected?.title || "Result / preview";
  const agent = item && props.agents.find(agent => agent.id === item.raw.instance_id);
  const state = item && activityState(item, props.system.now, props.system.connection === "open", props.activity.rows);
  const ask = () => {
    const excerpt = text.slice(0, 4000);
    actions.dispatch({ type: "ask_helper", prompt: `I'd like to adjust this output: ${title}.${agent ? ` Agent: ${agent.name} (ID ${agent.id}).` : ""}${item ? ` Activity: ${context.activityId}; recorded ${item.time}${item.threadId ? `; thread ${item.threadId}` : ""}.` : ""}${preview?.resource ? ` Resource: ${preview.resource.type} ${preview.resource.id}.` : ""}\nPlease help me decide and apply the changes.\n${excerpt ? `\nOutput excerpt:\n${excerpt}${text.length > 4000 ? "\n[Excerpt shortened; full recorded output is in the preview.]" : ""}` : "\nThis preview has no text excerpt. Ask me which part I want to change."}` });
  };
  return <WidgetSection title={item || preview ? "Result / preview" : "Results"} description={item || preview ? title : "What your system has produced."}>
    <div className="min-h-0 max-h-[640px] flex-1 space-y-4 overflow-auto p-4">
      {!item && !preview ? <>{context.activityId && <p className="text-xs text-text-muted">The selected activity is outside the recent window. Choose another output below.</p>}<RecentResults {...props} /></> : <>
        <div className="flex flex-wrap items-center gap-2">{state && <StateBadge label={state} live={state === "In progress"} attention={state === "Failed"} />}{agent && <button className="min-h-9 text-xs text-accent" onClick={() => actions.select({ type: "agent", id: agent.id, label: agent.name, projectId: agent.project_id })}>{agent.name} →</button>}</div>
        <div className="flex flex-wrap gap-2"><button className={`${widgetButton} border-accent/50 text-accent`} onClick={ask} disabled={!context.projectId}>Ask Helper to adjust this</button>{text && <button className={widgetButton} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopyState("Copied"); } catch { setCopyState("Copy unavailable. Select the output to copy it manually."); } }}>Copy output</button>}</div>
        {!context.projectId && <p className="text-xs text-text-dim">Open a project workspace to discuss this with Helper.</p>}
        {copyState && <p role="status" className="text-xs text-text-muted">{copyState}</p>}
        {item && <div className="flex gap-1 border-b border-border pb-2" aria-label="Preview sections">{["output", ...(item.toolArgs ? ["input"] : []), "details"].map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)} className={`min-h-9 rounded-md px-3 text-xs font-semibold capitalize ${view === tab ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-bg-hover"}`}>{tab}</button>)}</div>}
        {view === "output" && <>
          {allowed && component && app && <ChatComponentMount comp={{ app: component.app, name: component.name, props: component.props }} apps={[app]} projectId={context.projectId} dashboardScope={context.scope} slot="chat.message_attachment" widgetContext={context} widgetActions={actions} />}
          {component && !allowed && <p role="status" className="text-xs text-yellow">This app renderer is unavailable in the current scope. Any recorded text is shown below.</p>}
          {output.map(([label, value]) => <section key={label}><h3 className="mb-2 text-[10px] font-semibold uppercase text-text-dim">{label}</h3><pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-text">{value}</pre></section>)}
          {!output.length && !allowed && <p className="text-xs text-text-muted">{state === "In progress" ? "Waiting for output…" : item?.kind === "thought" ? "This step completed without recorded thought or response text." : "No output text was recorded."}</p>}
        </>}
        {view === "input" && item?.toolArgs && <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">{item.toolArgs}</pre>}
        {view === "details" && item && <dl className="space-y-3 text-xs">{[["Action", item.toolName || item.label], ["Recorded", new Date(item.time).toLocaleString()], ["Thread", item.threadId], ["Duration", item.durationMs !== undefined ? `${(item.durationMs / 1000).toFixed(1)}s` : undefined], ["Event", item.raw.type]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-text-dim">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>}
        {selected?.resource && <div className="border-t border-border pt-3"><p className="mb-2 text-[10px] text-text-dim">Capability used</p><ResourceButton resource={selected.resource} selected={context.selected} onSelect={actions.select} /></div>}
        <details className="border-t border-border pt-2"><summary className="min-h-9 cursor-pointer py-2 text-xs font-semibold text-accent">Browse recent results</summary><RecentResults {...props} /></details>
      </>}
    </div>
  </WidgetSection>;
}
