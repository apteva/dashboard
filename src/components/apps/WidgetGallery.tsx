import { useId, useMemo, useState } from "react";
import { Modal } from "../Modal";
import { WidgetIcon } from "./WidgetIcon";
import type { WidgetDefinition } from "./WidgetCanvas";
import type { WidgetInstance } from "./contributions";

type Group = { id: string; label: string; builtin: boolean; definitions: WidgetDefinition[] };
const control = "min-h-10 rounded-lg border border-border bg-bg-input px-3 text-xs text-text outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent";
const commonWidgets = ["native:workspace-summary", "native:agents", "native:apps", "native:agent-activity", "native:integrations", "native:usage"];
function browseOrder(definition: WidgetDefinition) {
  const index = commonWidgets.indexOf(definition.key);
  return index < 0 ? commonWidgets.length : index;
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function searchScore(definition: WidgetDefinition, query: string, provider: string) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const title = normalize(definition.label);
  const owner = normalize(`${provider} ${definition.providerKey || ""}`);
  const description = normalize(definition.description || "");
  let score = title === terms.join(" ") ? 1000 : 0;
  for (const term of terms) {
    const strength = title === term ? 100 : title.startsWith(term) ? 80 : title.includes(term) ? 60 : owner.includes(term) ? 40 : description.includes(term) ? 10 : 0;
    if (!strength) return 0;
    score += strength;
  }
  return score;
}

export function WidgetGallery({ definitions, configured, onAdd, onClose }: {
  definitions: WidgetDefinition[];
  configured: WidgetInstance[];
  onAdd: (definition: WidgetDefinition) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["builtin"]));
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => {
    const grouped = new Map<string, Group>();
    for (const definition of definitions) {
      const builtin = definition.kind === "builtin" || definition.key.startsWith("native:");
      const provider = definition.providerKey || definition.key.split(":")[0];
      const id = builtin ? "builtin" : `app:${provider}`;
      const group = grouped.get(id) || { id, label: builtin ? "Apteva" : definition.providerLabel || provider, builtin, definitions: [] };
      group.definitions.push(definition);
      grouped.set(id, group);
    }
    return [...grouped.values()].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.label.localeCompare(b.label));
  }, [definitions]);
  const results = groups.filter(group => source === "all" || group.id === source).map(group => {
    const matches = group.definitions.map(definition => ({ definition, score: searchScore(definition, query, group.label) }))
      .filter(item => item.score > 0 && (!suggestedOnly || item.definition.suggested))
      .sort((a, b) => b.score - a.score || Number(!!b.definition.required) - Number(!!a.definition.required) || Number(!!b.definition.suggested) - Number(!!a.definition.suggested) || browseOrder(a.definition) - browseOrder(b.definition) || a.definition.label.localeCompare(b.definition.label));
    return { ...group, score: matches[0]?.score || 0, definitions: matches.map(item => item.definition) };
  }).filter(group => group.definitions.length).sort((a, b) => query.trim() ? b.score - a.score : 0);
  const total = results.reduce((sum, group) => sum + group.definitions.length, 0);
  const filtered = !!query.trim() || source !== "all" || suggestedOnly;
  const toggle = (set: typeof setExpanded, id: string) => set(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <div className="relative z-[110]"><Modal open onClose={onClose} ariaLabel="Add a widget" width="max-w-3xl">
    <div className="flex max-h-[85dvh] w-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border p-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-text">Add a widget</h2><p className="mt-1 text-xs text-text-muted">Browse Apteva and your installed apps.</p></div>
          <button type="button" onClick={onClose} aria-label="Close widget picker" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl text-text-muted hover:bg-bg-hover hover:text-text">×</button>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-text-dim" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>
            <input aria-label="Search widgets or apps" type="search" inputMode="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search widgets or apps…" className={`${control} w-full pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none`} />
            {query && <button type="button" aria-label="Clear widget search" onClick={() => setQuery("")} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-text-muted hover:bg-bg-hover">×</button>}
          </div>
          <select aria-label="Filter widgets by app" value={source} onChange={event => setSource(event.target.value)} className={`${control} w-full sm:w-48`}>
            <option value="all">All sources</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.label} ({group.definitions.length})</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span role="status" aria-live="polite" className="text-xs text-text-dim">{total} widget{total === 1 ? "" : "s"}{filtered ? " found" : " available"}</span>
          {definitions.some(definition => definition.suggested) && <button type="button" aria-pressed={suggestedOnly} onClick={() => setSuggestedOnly(value => !value)} className={`min-h-8 rounded-md border px-2.5 text-[11px] font-medium ${suggestedOnly ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-text-muted hover:text-accent"}`}>Recommended</button>}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {results.map(group => <WidgetGalleryGroup key={group.id} group={group} configured={configured} onAdd={onAdd}
          open={filtered || expanded.has(group.id)} onToggle={() => toggle(setExpanded, group.id)}
          showAll={filtered || showAll.has(group.id)} onShowAll={() => toggle(setShowAll, group.id)} forcedOpen={filtered} />)}
        {total === 0 && <div className="py-10 text-center"><p className="text-sm font-semibold text-text">No matching widgets</p><p className="mt-2 text-xs text-text-muted">Try another name or choose a different app.</p>{filtered && <button type="button" onClick={() => { setQuery(""); setSource("all"); setSuggestedOnly(false); }} className="mt-4 min-h-10 rounded-lg border border-border px-4 text-xs font-semibold text-accent hover:bg-bg-hover">Clear filters</button>}</div>}
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-3 text-[11px] text-text-dim sm:px-5">Use the widget controls to move, resize, or configure it after adding.</footer>
    </div>
  </Modal></div>;
}

function WidgetGalleryGroup({ group, configured, onAdd, open, onToggle, showAll, onShowAll, forcedOpen }: {
  group: Group; configured: WidgetInstance[]; onAdd: (definition: WidgetDefinition) => void;
  open: boolean; onToggle: () => void; showAll: boolean; onShowAll: () => void; forcedOpen: boolean;
}) {
  const id = useId();
  const visible = showAll ? group.definitions : group.definitions.slice(0, 6);
  const identity = group.builtin ? { key: "native:helper", label: "Apteva" } : group.definitions[0];
  return <section className="overflow-hidden rounded-xl border border-border">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} disabled={forcedOpen}
      className={`flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left sm:px-4 ${forcedOpen ? "cursor-default" : "hover:bg-bg-hover"}`}>
      <WidgetIcon definition={identity} />
      <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-text">{group.label}</h3><p className="mt-0.5 text-[11px] text-text-dim">{group.builtin ? "Built-in widgets" : "App widgets"} · {group.definitions.length}</p></div>
      {!forcedOpen && <svg aria-hidden="true" className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6"/></svg>}
    </button>
    <div id={id} hidden={!open}>
      <div className="divide-y divide-border border-t border-border">
        {visible.map(definition => {
          const count = configured.filter(item => item.component === definition.key).length;
          const required = !!definition.required && count > 0;
          return <article key={definition.key} className="flex min-h-20 items-center gap-3 px-3 py-3 sm:px-4">
            <WidgetIcon definition={definition} />
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-semibold leading-5 text-text">{definition.label}</h4>
              <p className="line-clamp-2 text-[11px] leading-4 text-text-muted">{definition.description || "Add this widget to your view."}</p>
              {(count > 0 || definition.suggested) && <p className="mt-1 text-[10px] text-text-dim">{required ? "Always shown" : count ? `${count} already added` : "Recommended"}{count > 0 && definition.suggested && !required ? " · Recommended" : ""}</p>}
            </div>
            <button type="button" disabled={required} aria-label={required ? `${definition.label} is always shown` : `${count ? "Add another" : "Add"} ${definition.label}`} onClick={() => onAdd(definition)}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent/40 px-2.5 text-xs font-semibold text-accent hover:border-accent hover:bg-accent/10 disabled:cursor-default disabled:border-border disabled:text-text-dim sm:px-3">
              {required ? "Added" : <><span aria-hidden="true" className="text-base">+</span><span>Add</span></>}
            </button>
          </article>;
        })}
      </div>
      {!showAll && group.definitions.length > visible.length && <button type="button" onClick={onShowAll} className="min-h-11 w-full border-t border-border px-4 text-left text-xs font-semibold text-accent hover:bg-bg-hover">Show all {group.definitions.length} widgets</button>}
    </div>
  </section>;
}
