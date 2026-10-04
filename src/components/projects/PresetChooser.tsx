import { PresetSetupSteps } from "./PresetSetupSteps";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AppIcon } from "@apteva/ui-kit";
import { apps, type ProjectPreset, type ProjectPresetAgent } from "../../api";
import { AgentMark } from "../AgentMark";
import { PresetMark } from "./PresetMark";
import { Modal } from "../Modal";
import { PresetLayoutPreview, presetCountSummary } from "./ProjectPresetSetup";

const categories = ["", "personal", "business", "work", "development"] as const;
type AppVisual = { name: string; icon?: string; icon_style?: "image" | "monochrome"; display_name?: string };
const secondary = "min-h-10 rounded-lg border border-border px-3 text-sm text-text-muted hover:border-accent hover:text-text focus-visible:outline-accent disabled:opacity-40";

function includedApps(preset: ProjectPreset) {
  const widgets = [...(preset.layouts?.home || preset.dashboard_layout || []), ...Object.values(preset.layouts?.agent_overview || {}).flat()];
  return [...new Set([
    ...preset.agents.flatMap((agent) => agent.apps || []),
    ...widgets.map((widget) => widget.component.split(":")[0]!).filter((name) => name !== "native"),
    ...(preset.connections || []).map((step) => step.app),
    ...(preset.setup || []).map((step) => step.app),
  ])];
}

// Keep the first role sentence consistent between the overview and full team tab.
function agentRoleSummary(agent: ProjectPresetAgent) {
  return agent.directive
    .replace(/Use this project description as your operating context: \{\{description\}\}\.\s*/i, "")
    .replace(/\{\{description\}\}/g, "your goals")
    .trim().split(/(?<=[.!?])\s/)[0] || "Customize this agent’s role in the next step.";
}

// Show the apps that distinguish this preset before common workspace utilities.
function mainPresetApps(names: string[]) {
  const shared = new Set(["tasks", "a2a", "conversations"]);
  return [...names.filter((name) => !shared.has(name)), ...names.filter((name) => shared.has(name))];
}

export function PresetChooser({ catalog, selectedId, category, query, projectId, busy, error, scrollPosition, onScrollPosition, onSelect, onCategory, onQuery, onUse, onBack }: {
  catalog: ProjectPreset[]; selectedId: string; category: string; query: string; projectId: string;
  busy: boolean; error: string; scrollPosition: number; onScrollPosition: (value: number) => void;
  onSelect: (preset: ProjectPreset | null) => void; onCategory: (category: typeof categories[number]) => void;
  onQuery: (query: string) => void; onUse: () => void; onBack: () => void;
}) {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [visuals, setVisuals] = useState<Record<string, AppVisual>>({});
  const catalogScroll = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(scrollPosition);
  useLayoutEffect(() => { if (catalogScroll.current) catalogScroll.current.scrollTop = initialScroll.current; }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => { setWide(media.matches); if (media.matches) setSheetOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const add = (rows: AppVisual[], preferExisting = false) => {
      if (cancelled) return;
      setVisuals((current) => {
        const next = { ...current };
        for (const row of rows) if (!preferExisting || !next[row.name]) next[row.name] = row;
        return next;
      });
    };
    void apps.list(projectId).then((rows) => add(rows)).catch(() => {});
    void (async () => {
      const first = await apps.marketplace(projectId, undefined, { pageSize: 100 });
      add(first.apps, true);
      const pageSize = first.page_size || 100;
      for (let page = 2; !cancelled && page <= Math.ceil((first.total || first.apps.length) / pageSize); page++) {
        const next = await apps.marketplace(projectId, undefined, { pageSize, page });
        add(next.apps, true);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const selected = catalog.find((preset) => preset.id === selectedId) || null;
  const search = query.trim().toLocaleLowerCase();
  const visible = catalog.filter((preset) => (search || !category || preset.category === category) && (!search ||
    `${preset.name} ${preset.description} ${(preset.highlights || []).join(" ")} ${preset.agents.map((agent) => agent.name).join(" ")} ${includedApps(preset).join(" ")}`.toLocaleLowerCase().includes(search)));
  const select = (preset: ProjectPreset | null) => { onSelect(preset); if (!wide) setSheetOpen(true); };
  const footer = <div className="shrink-0 border-t border-border bg-bg p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
    {error && <p role="alert" className="mb-3 text-sm text-red">{error}</p>}
    <button type="button" disabled={busy || (!!selectedId && !selected)} onClick={onUse} className="min-h-11 w-full rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg hover:bg-accent-hover focus-visible:outline-accent disabled:opacity-40">
      {busy ? "Preparing your summary…" : selected ? "Use this preset" : "Start from scratch"}
    </button>
    <p className="mt-2 text-center text-[11px] leading-relaxed text-text-dim">{selected ? "Personalize and confirm next. Nothing is installed yet." : "Review your summary next. Add agents and apps later."}</p>
  </div>;

  return <section className="flex min-h-0 w-full flex-1 flex-col [@media(max-height:550px)]:overflow-y-auto">
    <header className="mb-4 shrink-0 sm:mb-5">
      <button type="button" disabled={busy} onClick={onBack} className="mb-3 min-h-9 text-sm text-text-muted hover:text-text disabled:opacity-40">← Setup options</button>
      <h1 className="text-2xl font-semibold sm:text-3xl">Choose your starting point</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">A preset brings together agents, apps, and page layouts for a particular purpose. Explore what’s included, then make it yours.</p>
    </header>
    {!wide && !sheetOpen && error && <p role="alert" className="mb-3 shrink-0 text-sm text-red">{error}</p>}
    <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,1.15fr)] xl:gap-7 [@media(max-height:550px)]:min-h-[420px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="shrink-0 space-y-3 pb-4">
          <input type="search" disabled={busy} aria-label="Search presets" placeholder="Search by purpose or app…" value={query} onChange={(event) => { onQuery(event.target.value); catalogScroll.current?.scrollTo({ top: 0 }); }} className="min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 text-sm text-text focus:border-accent focus:outline-none" />
          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Preset categories">{categories.map((value) => <button type="button" key={value} disabled={busy} aria-pressed={category === value} onClick={() => { onCategory(value); catalogScroll.current?.scrollTo({ top: 0 }); }} className={`min-h-9 shrink-0 rounded-full border px-3 text-xs capitalize focus-visible:outline-accent ${category === value ? "border-accent text-accent" : "border-border text-text-muted hover:text-text"}`}>{value || "All"}</button>)}</div>
          <button type="button" disabled={busy} aria-pressed={!selectedId} onClick={() => select(null)} className={`flex min-h-16 w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-accent ${!selectedId ? "border-accent" : "border-border hover:border-accent/50"}`}>
            <PresetMark />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Start from scratch</span><span className="mt-1 block text-xs text-text-muted">An empty workspace to make your own.</span></span><span className="text-text-muted" aria-hidden="true">→</span>
          </button>
          <p role="status" className="text-[11px] text-text-dim">{visible.length} preset{visible.length === 1 ? "" : "s"}{selected && !visible.includes(selected) ? ` · Previewing ${selected.name}` : ""}</p>
        </div>
        <div ref={catalogScroll} onScroll={(event) => onScrollPosition(event.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-5 pr-1 [scrollbar-gutter:stable]">
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((preset) => {
              const appNames = includedApps(preset);
              return <button type="button" key={preset.id} disabled={busy} aria-pressed={selectedId === preset.id} onClick={() => select(preset)} className={`flex min-w-0 flex-col rounded-xl border p-4 text-left transition-colors focus-visible:outline-accent disabled:opacity-50 ${selectedId === preset.id ? "border-accent bg-accent/5" : "border-border hover:border-accent/50 hover:bg-bg-hover"}`}>
                <div className="mb-3 flex w-full items-center gap-2"><PresetMark preset={preset} /><span className="min-w-0 flex-1 text-[10px] uppercase tracking-wide text-text-dim">{preset.category}</span>{selectedId === preset.id && <span className="text-xs text-accent" aria-label="Selected">✓</span>}</div>
                <h2 className="text-sm font-semibold">{preset.name}</h2>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">{preset.description}</p>
                <div className="mt-auto pt-4"><div className="flex items-center gap-1.5" aria-label="Included apps">{appNames.slice(0, 5).map((name) => <span key={name} title={visuals[name]?.display_name || name}><AppIcon src={visuals[name]?.icon} iconStyle={visuals[name]?.icon_style} name={name} size="xs" /></span>)}{appNames.length > 5 && <span className="ml-1 text-[10px] text-text-dim">+{appNames.length - 5}</span>}</div><p className="mt-2 text-[10px] leading-4 text-text-dim">{presetCountSummary(preset)}</p></div>
              </button>;
            })}
          </div>
          {visible.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center"><p className="text-sm text-text-muted">No presets match these filters.</p><button type="button" onClick={() => { onQuery(""); onCategory(""); }} className={`${secondary} mt-3`}>Clear filters</button></div>}
        </div>
      </div>
      {wide && <aside aria-label="Preset preview" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
        <PresetPreview key={selectedId} preset={selected} visuals={visuals} />
        {footer}
      </aside>}
    </div>
    {!wide && <Modal open={sheetOpen} onClose={() => { if (!busy) setSheetOpen(false); }} fullScreen ariaLabel={selected ? `${selected.name} preview` : "Start from scratch preview"}>
      <div className="shrink-0 border-b border-border px-4 py-3"><button type="button" disabled={busy} onClick={() => setSheetOpen(false)} className={secondary}>← Back to presets</button></div>
      <PresetPreview key={selectedId} preset={selected} visuals={visuals} />
      {footer}
    </Modal>}
  </section>;
}

const previewTabs = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "apps", label: "Apps" },
  { id: "layout", label: "Layout" },
] as const;
type PreviewTab = typeof previewTabs[number]["id"];

function PresetPreview({ preset, visuals }: { preset: ProjectPreset | null; visuals: Record<string, AppVisual> }) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("overview");
  const id = useId();
  const content = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  useLayoutEffect(() => { content.current?.scrollTo({ top: 0 }); }, [activeTab]);

  if (!preset) return <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5"><PresetMark size="md" /><div><p className="text-xs font-medium text-accent">Your own starting point</p><h2 className="mt-2 text-2xl font-semibold">Start from scratch</h2><p className="mt-3 text-sm leading-relaxed text-text-muted">Start with an empty workspace and add what you need, whenever you need it.</p></div><div className="rounded-lg border border-dashed border-border p-5"><p className="text-sm font-medium">No preset agents or apps</p><p className="mt-2 text-xs leading-relaxed text-text-muted">You can create agents, install apps, connect accounts, and arrange widgets later. The next step is your workspace summary.</p></div></div>;
  const appNames = includedApps(preset);
  const appLabel = (name: string) => visuals[name]?.display_name || ({ crm: "CRM", a2a: "Agent to Agent" } as Record<string, string>)[name] || name.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const mainApps = mainPresetApps(appNames).slice(0, 6);
  const showTab = (tab: PreviewTab) => { setActiveTab(tab); tabButtons.current[previewTabs.findIndex((item) => item.id === tab)]?.focus(); };
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header className="shrink-0 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
      <div className="flex items-center gap-3"><PresetMark preset={preset} size="md" /><div className="min-w-0"><p className="text-[10px] font-medium capitalize text-accent">{preset.category} workspace</p><h2 className="mt-1 break-words text-lg font-semibold sm:text-xl">{preset.name}</h2></div></div>
    </header>
    <div role="tablist" aria-label="Preset details" className="grid shrink-0 grid-cols-4 border-b border-border px-2 sm:px-3">
      {previewTabs.map((tab, index) => <button
        key={tab.id} ref={(node) => { tabButtons.current[index] = node; }}
        type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
        aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
        onClick={() => setActiveTab(tab.id)}
        onKeyDown={(event) => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % previewTabs.length;
          else if (event.key === "ArrowLeft") next = (index + previewTabs.length - 1) % previewTabs.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = previewTabs.length - 1;
          else return;
          event.preventDefault();
          setActiveTab(previewTabs[next]!.id);
          tabButtons.current[next]?.focus();
        }}
        className={`min-h-11 min-w-0 border-b-2 px-1 text-xs font-medium focus-visible:outline focus-visible:outline-accent focus-visible:-outline-offset-4 ${activeTab === tab.id ? "border-accent text-accent" : "border-transparent text-text-muted hover:text-text"}`}
      >{tab.label}</button>)}
    </div>
    <div ref={content} className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 [scrollbar-gutter:stable]">
      {previewTabs.map((tab) => <div key={tab.id} role="tabpanel" id={`${id}-panel-${tab.id}`} aria-labelledby={`${id}-tab-${tab.id}`} hidden={activeTab !== tab.id} tabIndex={0} className="space-y-5 focus-visible:outline-accent">
        {tab.id === "overview" && <>
          <p className="text-sm leading-relaxed text-text-muted">{preset.description}</p>
          <div className="grid items-start gap-5 @[36rem]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section aria-label="Included agents" className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">Your team <span className="ml-1 font-normal text-text-dim">{preset.agents.length}</span></h3>
                <button type="button" onClick={() => showTab("agents")} className="min-h-8 shrink-0 text-xs text-accent hover:underline focus-visible:outline-accent" aria-label="View all agent details">Details →</button>
              </div>
              <ul className="space-y-3">
                {preset.agents.map((agent) => <li key={agent.key} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
                  <AgentMark icon={agent.icon} size="sm" />
                  <div className="min-w-0 flex-1">
                    <h4 className="break-words text-xs font-semibold leading-5 text-text">{agent.name}</h4>
                    <p className="mt-0.5 break-words text-xs leading-5 text-text-muted">{agentRoleSummary(agent)}</p>
                  </div>
                </li>)}
              </ul>
            </section>
            <section aria-label="Main included apps" className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">Main apps</h3>
                <button type="button" onClick={() => showTab("apps")} className="min-h-8 shrink-0 text-xs text-accent hover:underline focus-visible:outline-accent">All {appNames.length} →</button>
              </div>
              <ul className="grid grid-cols-2 gap-2 @[36rem]:grid-cols-1">
                {mainApps.map((name) => <li key={name} className="flex min-w-0 items-center gap-2 rounded-lg border border-border px-2.5 py-2.5">
                  <span className="shrink-0"><AppIcon src={visuals[name]?.icon} iconStyle={visuals[name]?.icon_style} name={appLabel(name)} size="xs" /></span>
                  <span className="min-w-0 break-words text-xs font-medium leading-5 text-text">{appLabel(name)}</span>
                </li>)}
              </ul>
              {appNames.length > mainApps.length && <button type="button" onClick={() => showTab("apps")} className="mt-2 min-h-8 text-left text-[11px] text-text-muted hover:text-accent focus-visible:outline-accent">+{appNames.length - mainApps.length} more apps included →</button>}
              {!appNames.length && <p className="text-xs text-text-muted">Add apps to this workspace later.</p>}
            </section>
          </div>
          <PresetSetupSteps steps={preset.setup} />
          {!!preset.highlights?.length && <section><h3 className="mb-3 text-xs font-semibold">What this workspace does</h3><ul className="space-y-3">{preset.highlights.map((text) => <li key={text} className="flex gap-2 text-xs leading-5 text-text-muted"><span className="text-accent" aria-hidden="true">✓</span>{text}</li>)}</ul></section>}
          <p className="text-xs leading-5 text-text-dim">You can customize the agents before creating your workspace, then connect accounts and arrange widgets afterwards.</p>
        </>}
        {tab.id === "agents" && <section><h3 className="mb-3 text-xs font-semibold">Your agents · {preset.agents.length}</h3><div className="space-y-2">{preset.agents.map((agent) => <div key={agent.key} className="flex gap-3 rounded-lg border border-border p-3"><AgentMark icon={agent.icon} size="sm" /><div className="min-w-0"><h4 className="break-words text-sm font-medium">{agent.name}</h4><p className="mt-1 text-xs leading-5 text-text-muted">{agentRoleSummary(agent)}</p><p className="mt-2 text-[10px] capitalize text-text-dim">{agent.mode} · {(agent.apps || []).length} apps</p><div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Apps for ${agent.name}`}>{(agent.apps || []).map((name) => <span key={name} title={appLabel(name)}><AppIcon src={visuals[name]?.icon} iconStyle={visuals[name]?.icon_style} name={appLabel(name)} size="xs" /></span>)}</div></div></div>)}</div></section>}
        {tab.id === "apps" && <>
          <section><h3 className="mb-3 text-xs font-semibold">Included apps · {appNames.length}</h3><div className="grid grid-cols-2 gap-2">{appNames.map((name) => <div key={name} className="flex min-w-0 items-center gap-2 rounded-lg border border-border p-2"><AppIcon src={visuals[name]?.icon} iconStyle={visuals[name]?.icon_style} name={name} size="xs" /><span className="min-w-0 break-words text-xs text-text-muted">{appLabel(name)}</span></div>)}</div></section>
          {!!preset.connections?.length && <section className="border-t border-border pt-4"><h3 className="text-xs font-semibold">Accounts and setup</h3><p className="mt-1 text-[11px] leading-5 text-text-dim">Connect accounts after installation, or come back later.</p><ul className="mt-3 space-y-3">{preset.connections.map((step) => <li key={`${step.app}:${step.title}`}><p className="text-xs font-medium">{step.title}{step.required ? " · Required for this workflow" : ""}</p><p className="mt-1 text-xs leading-5 text-text-muted">{step.description}</p></li>)}</ul></section>}
        </>}
        {tab.id === "layout" && <PresetLayoutPreview preset={preset} standalone />}
      </div>)}
    </div>
  </div>;
}
