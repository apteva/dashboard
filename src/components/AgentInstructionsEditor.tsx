import { useId, useMemo, useState } from "react";
import {
  addDirectiveSection, directiveSectionBody, moveDirectiveSection, parseDirectiveSections,
  removeDirectiveSection, renameDirectiveSection, structureDirectiveDraft, updateDirectiveSection,
} from "../utils/directiveMarkdown";
import { renderSafeMarkdown } from "../utils/safeMarkdown";

const SECTION_OPTIONS = [
  { title: "Role", description: "Who this agent is and what it is responsible for.", placeholder: "You are a support specialist. Help customers understand and resolve their issues." },
  { title: "Goals", description: "Optional standing objectives. Leave this out for an agent that responds to requests.", placeholder: "Improve response quality and help the team resolve customer issues." },
  { title: "Working instructions", description: "How the agent should approach requests and carry out its work.", placeholder: "Read the request, gather relevant context, and explain the next useful action." },
  { title: "Context", description: "Background information the agent needs to understand its work.", placeholder: "Describe your project, customers, or operating context." },
  { title: "Collaboration", description: "How the agent should delegate work and collaborate with available agents.", placeholder: "Explain when to involve another agent and what to include in a handoff." },
  { title: "Expected outputs", description: "What useful results should look like.", placeholder: "Describe the format, evidence, or deliverables you expect." },
  { title: "Boundaries and escalation", description: "Limits specific to this role and when to involve you.", placeholder: "Describe scope limits and situations that need your input." },
  { title: "Communication style", description: "How the agent should communicate with you and others.", placeholder: "Use clear, concise explanations. Match the language of the request." },
] as const;

function sectionOption(title: string) {
  const normalized = title.toLowerCase();
  const aliases: Record<string, string> = { goal: "goals", instructions: "working instructions", "operating rules": "working instructions", tone: "communication style", "escalation and safety": "boundaries and escalation", delegation: "collaboration" };
  return SECTION_OPTIONS.find((option) => option.title.toLowerCase() === (aliases[normalized] || normalized));
}

const smallButton = "inline-flex min-h-9 items-center justify-center rounded-md border border-border px-2.5 text-xs text-text-muted transition-colors hover:bg-bg-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-35";
const textInput = "w-full min-w-0 rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:outline-none focus:border-accent";

interface Props {
  value: string;
  onChange: (value: string) => void;
  agentName?: string;
}

// Both modes operate on one authored directive. Section edits replace only the
// selected source slice; displaying/switching modes never serializes the text.
export function AgentInstructionsEditor({ value, onChange, agentName }: Props) {
  const id = useId();
  const [mode, setMode] = useState<"sections" | "manual">("sections");
  const [selected, setSelected] = useState(0);
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [emptySection, setEmptySection] = useState("Role");
  const [showAdd, setShowAdd] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [organize, setOrganize] = useState(false);
  const [undo, setUndo] = useState<{ value: string; selected: number; title: string; after: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [sectionError, setSectionError] = useState("");
  const sections = useMemo(() => parseDirectiveSections(value), [value]);
  const index = Math.min(selected, Math.max(sections.length - 1, 0));
  const active = sections[index];
  const displayed = sections.length ? sections.map((section) => section.title || "Untitled section") : ["Role", "Working instructions"];
  const displayedIndex = sections.length ? index : emptySection === "Role" ? 0 : 1;
  const sectionKey = (position: number) => `${displayed[position]}:${displayed.slice(0, position).filter((name) => name === displayed[position]).length}`;
  const title = active?.title || (active ? "Untitled section" : emptySection);
  const option = sectionOption(title);
  const hasGoals = sections.some((section) => /^goals?$/i.test(section.title));
  const plain = sections.length > 0 && sections.every((section) => section.style === "plain");
  const organizeDraft = organize ? structureDirectiveDraft(value, agentName) : "";
  const previewHTML = useMemo(() => showPreview ? renderSafeMarkdown(value) : "", [value, showPreview]);

  const change = (next: string) => { setUndo(null); setSectionError(""); onChange(next); };
  const select = (next: number) => { setSelected(next); setRenaming(false); setMobileCollapsed(false); };
  const selectDisplayed = (position: number) => {
    if (sections.length) select(position);
    else { setEmptySection(displayed[position]); setMobileCollapsed(false); }
  };
  const add = (name: string) => {
    const next = addDirectiveSection(value, name);
    const nextSections = parseDirectiveSections(next);
    if (nextSections.length <= sections.length) {
      setSectionError("Close any unfinished Markdown code fence in Full text before adding a section.");
      return;
    }
    change(next);
    select(nextSections.length - 1);
    setShowAdd(false);
    setCustomTitle("");
    setRenaming(false);
  };
  const remove = () => {
    if (!active) return;
    const next = removeDirectiveSection(value, active);
    setUndo({ value, selected: index, title, after: next });
    onChange(next);
    setSelected(Math.max(index - 1, 0));
    setRenaming(false);
  };
  const move = (direction: -1 | 1) => {
    const next = moveDirectiveSection(value, index, direction);
    if (next !== value) { change(next); select(index + direction); }
  };

  const editor = (variant: "desktop" | "mobile") => <div id={`${id}-${variant}-editor`} role="region" aria-label={`${title} instructions`} className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={`${id}-${variant}-section-body`} className="text-sm font-semibold text-text">{title}</label>
      {active && <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => { setRenaming(!renaming); setRenameTitle(title); }} className={smallButton} aria-expanded={renaming}>Rename</button>
        <button type="button" onClick={() => move(-1)} disabled={!active.level || !sections[index - 1]?.level} className={smallButton} aria-label={`Move ${title} up`} title="Move section up">↑</button>
        <button type="button" onClick={() => move(1)} disabled={!active.level || !sections[index + 1]?.level} className={smallButton} aria-label={`Move ${title} down`} title="Move section down">↓</button>
        <button type="button" onClick={remove} className={smallButton} aria-label={`Remove ${title}`}>Remove</button>
      </div>}
    </div>
    {renaming && <div className="flex items-center gap-2">
      <input className={textInput} aria-label="Section name" value={renameTitle} maxLength={160} onChange={(event) => setRenameTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (active && renameTitle.trim()) { change(renameDirectiveSection(value, active, renameTitle)); setRenaming(false); } } }} />
      <button type="button" className={smallButton} disabled={!renameTitle.trim()} onClick={() => { if (active) change(renameDirectiveSection(value, active, renameTitle)); setRenaming(false); }}>Apply</button>
    </div>}
    <p id={`${id}-${variant}-section-hint`} className="text-xs leading-relaxed text-text-muted">{option?.description || (active?.style === "plain" && sections.length > 1 ? "Introductory text before your sections. It is preserved in the full directive." : "Your own instructions. Markdown and nested headings are supported.")}</p>
    <textarea id={`${id}-${variant}-section-body`} value={active ? directiveSectionBody(value, active) : ""} rows={7}
      onChange={(event) => {
        if (active) change(updateDirectiveSection(value, active, event.target.value));
        else { change(addDirectiveSection(value, emptySection, event.target.value)); setSelected(0); }
      }} aria-describedby={`${id}-${variant}-section-hint`}
      placeholder={option?.placeholder || "Write instructions for this section…"}
      className={`${textInput} min-h-40 resize-y leading-relaxed`} />
    <p className="text-[11px] text-text-dim">Only this section is edited. Custom instructions stay in the full directive.</p>
  </div>;

  return <section className="@container min-w-0 space-y-3" aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-text">Instructions</h3>
      <div className="inline-flex rounded-lg border border-border bg-bg-input p-0.5" role="group" aria-label="Instructions editing mode">
        {([['sections', 'Sections'], ['manual', 'Full text']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key}
          onClick={() => { setMode(key); setShowAdd(false); setOrganize(false); setRenaming(false); }}
          className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${mode === key ? "bg-accent/10 text-accent" : "text-text-muted hover:text-text"}`}>{label}</button>)}
      </div>
    </div>

    {mode === "manual" ? <div className="space-y-2">
      <label htmlFor={`${id}-full-text`} className="block text-xs text-text-muted">Edit the entire authored directive</label>
      <textarea id={`${id}-full-text`} rows={14} value={value} onChange={(event) => change(event.target.value)} spellCheck={false}
        placeholder={"# Role\nYou are…\n\n# Working instructions\nDescribe how to handle requests."}
        className={`${textInput} min-h-64 resize-y font-mono leading-relaxed`} />
      <p className="text-xs leading-relaxed text-text-dim">Use any Markdown or custom headings. Returning to Sections preserves your text. Goals are optional.</p>
    </div> : <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        {hasGoals ? <span className="text-xs text-text-muted">Goals section · optional</span> : <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="text-text-muted">No standing goals</span><button type="button" onClick={() => add("Goals")} className="min-h-9 text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Add goals</button></div>}
        <button type="button" onClick={() => setShowAdd(!showAdd)} className={smallButton} aria-expanded={showAdd} aria-controls={`${id}-add`}>+ Add section</button>
      </div>
      {showAdd && <div id={`${id}-add`} className="space-y-3 border-b border-border p-3">
        <div className="grid grid-cols-2 gap-2 @[32rem]:grid-cols-3">
          {SECTION_OPTIONS.filter((option) => !sections.some((section) => sectionOption(section.title)?.title === option.title)).map((option) => <button key={option.title} type="button" onClick={() => add(option.title)} className={`${smallButton} justify-start text-left`}>{option.title}</button>)}
        </div>
        <div className="flex items-center gap-2">
          <input className={textInput} value={customTitle} maxLength={160} onChange={(event) => setCustomTitle(event.target.value)} aria-label="Custom section name" placeholder="Custom section name"
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (customTitle.trim()) add(customTitle); } }} />
          <button type="button" className={smallButton} onClick={() => add(customTitle)} disabled={!customTitle.trim()}>Add</button>
        </div>
      </div>}
      {plain && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs text-text-muted">Your existing instructions are kept together.</p>
        <button type="button" onClick={() => setOrganize(!organize)} className={smallButton} aria-expanded={organize}>Organize into sections</button>
      </div>}
      {organize && plain && <div className="space-y-3 border-b border-border p-3">
        <p className="text-xs leading-relaxed text-text-muted">Preview: add a Role section and keep your existing text in Working instructions.</p>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-input p-3 text-xs text-text">{organizeDraft}</pre>
        <div className="flex gap-2"><button type="button" className={smallButton} onClick={() => { change(organizeDraft); setSelected(0); setOrganize(false); }}>Use these sections</button><button type="button" className={smallButton} onClick={() => setOrganize(false)}>Keep current text</button></div>
      </div>}
      <div className="hidden @[32rem]:grid @[32rem]:grid-cols-[150px_minmax(0,1fr)]">
        <nav className="space-y-1 border-r border-border p-2" aria-label="Instruction sections">
          {displayed.map((name, position) => <button type="button" key={sectionKey(position)} aria-pressed={displayedIndex === position} aria-controls={`${id}-desktop-editor`} onClick={() => selectDisplayed(position)}
            className={`min-h-10 w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${displayedIndex === position ? "bg-accent/10 text-accent font-semibold" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}>{name}</button>)}
        </nav>
        <div className="min-w-0 p-3">{editor("desktop")}</div>
      </div>
      <div className="@[32rem]:hidden">
        {displayed.map((name, position) => <div key={sectionKey(position)} className="border-b border-border last:border-b-0">
          <button type="button" aria-expanded={displayedIndex === position && !mobileCollapsed} aria-controls={`${id}-mobile-${position}`} onClick={() => { if (displayedIndex === position) setMobileCollapsed(!mobileCollapsed); else selectDisplayed(position); }}
            className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${displayedIndex === position ? "text-accent font-medium" : "text-text-muted"}`}><span className="min-w-0 break-words">{name}</span><span aria-hidden="true" className="shrink-0 text-xs">{displayedIndex === position && !mobileCollapsed ? "−" : "+"}</span></button>
          {displayedIndex === position && !mobileCollapsed && <div id={`${id}-mobile-${position}`} className="min-w-0 px-3 pb-3">{editor("mobile")}</div>}
        </div>)}
      </div>
    </div>}
    {sectionError && <p role="alert" className="text-xs text-error">{sectionError}</p>}
    {undo && value === undo.after && <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" role="status"><span>Removed {undo.title}.</span><button type="button" onClick={() => { onChange(undo.value); setSelected(undo.selected); setUndo(null); }} className="min-h-9 text-accent hover:underline">Undo</button></div>}
    <div>
      <button type="button" onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview} aria-controls={`${id}-preview`} className="min-h-9 text-xs text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{showPreview ? "Hide preview" : "Preview instructions"}</button>
      {showPreview && <div id={`${id}-preview`} className="mt-1 max-h-80 overflow-auto rounded-lg border border-border bg-bg-input p-4">
        {value.trim() ? <div className="chat-md break-words text-sm leading-relaxed text-text" dangerouslySetInnerHTML={{ __html: previewHTML }} /> : <p className="text-xs text-text-muted">No authored instructions yet. You can add them whenever needed.</p>}
      </div>}
    </div>
  </section>;
}
