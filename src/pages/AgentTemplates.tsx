import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  agentTemplates,
  type AgentTemplate,
  type AgentTemplateDetail,
  type AgentTemplateVersionContent,
} from "../api";
import { AgentMark, suggestedAgentIcon } from "../components/AgentMark";
import { templateSourceLabel } from "../components/AgentTemplate";
import { usePageTitle } from "../hooks/usePageTitle";

// Agent templates: the definitions agents are created from. Each template
// keeps its saved versions; agents follow the latest or stay on one.

const sourceOrder: AgentTemplate["source"][] = ["user", "builtin", "app"];
const sourceHeading: Record<AgentTemplate["source"], string> = {
  user: "Your templates",
  builtin: "Built-in",
  app: "From apps",
};

export function AgentTemplates() {
  usePageTitle(["Agent templates"]);
  const [templates, setTemplates] = useState<AgentTemplate[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    agentTemplates
      .list()
      .then((list) => setTemplates(list.filter((template) => template.id !== "empty")))
      .catch((err) => {
        setError(err?.message || "Could not load templates");
        setTemplates([]);
      });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/agents" className="text-xs text-text-muted hover:text-text">← Agents</Link>
        <h1 className="mt-1 text-lg font-bold text-text">Agent templates</h1>
        <p className="mt-0.5 text-xs text-text-muted sm:text-sm">
          The definitions agents are created from. Each saved change is a new version.
        </p>
      </div>
      <div className="page-safe-bottom flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        {templates === null ? null : templates.length === 0 ? (
          <p className="text-sm text-text-muted">No templates yet. Open an agent and choose Template to save it as one.</p>
        ) : (
          sourceOrder.map((source) => {
            const group = templates.filter((template) => template.source === source);
            if (!group.length) return null;
            return (
              <section key={source} aria-label={sourceHeading[source]}>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">{sourceHeading[source]}</h2>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {group.map((template) => (
                    <li key={template.id}>
                      <Link to={`/agent-templates/${encodeURIComponent(template.id)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover">
                        <AgentMark icon={suggestedAgentIcon(template.icon)} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text">{template.name}</span>
                          <span className="block truncate text-xs text-text-muted">{template.description}</span>
                        </span>
                        <span className="shrink-0 text-xs text-text-muted">Version {template.version || 1}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Line diff of two texts by longest common subsequence. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Very long instructions fall back to "all removed, all added".
  if (a.length * b.length > 250_000) {
    return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  }
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i++]! });
    } else {
      out.push({ kind: "added", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) out.push({ kind: "added", text: b[j++]! });
  return out;
}

function templateApps(content: AgentTemplateVersionContent): string[] {
  const apps = new Set(content.recommended_apps || []);
  for (const requirement of content.requirements || []) {
    if (requirement.kind === "app" && requirement.slug) apps.add(requirement.slug);
  }
  return [...apps];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const sectionTitle = "mb-2 text-xs font-bold uppercase tracking-wide text-text-muted";
const field = "w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none";
const secondaryButton = "min-h-9 rounded-lg border border-border px-3 text-xs text-text-muted hover:text-text disabled:opacity-50";

export function AgentTemplateDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AgentTemplateDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [contents, setContents] = useState<Record<number, AgentTemplateVersionContent>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [showChanges, setShowChanges] = useState(true);
  const [editing, setEditing] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  usePageTitle(["Agent templates", detail?.name || id]);

  const load = useCallback(() => {
    agentTemplates
      .get(id)
      .then((next) => {
        setDetail(next);
        setLoadError("");
      })
      .catch((err) => setLoadError(err?.message || "Template not found"));
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setContents({});
    setOpen(null);
    setEditing(false);
    setSavedNotice("");
    load();
  }, [load]);

  const loadVersion = useCallback(async (version: number) => {
    if (contents[version]) return;
    const { content } = await agentTemplates.version(id, version);
    setContents((current) => ({ ...current, [version]: content }));
  }, [contents, id]);

  const toggle = async (version: number) => {
    if (open === version) {
      setOpen(null);
      return;
    }
    setOpen(version);
    try {
      await Promise.all([loadVersion(version), version > 1 ? loadVersion(version - 1) : Promise.resolve()]);
    } catch {
      // The row shows "Loading…" until a later attempt succeeds.
    }
  };

  if (loadError && !detail) {
    return (
      <div className="p-6">
        <Link to="/agent-templates" className="text-xs text-text-muted hover:text-text">← Templates</Link>
        <p className="mt-4 text-sm text-text-muted">{loadError}</p>
      </div>
    );
  }
  if (!detail) return null;

  const versions = [...detail.versions].sort((a, b) => b.version - a.version);
  const latest = detail.version || versions[0]?.version || 1;
  const editable = detail.source === "user";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <Link to="/agent-templates" className="text-xs text-text-muted hover:text-text">← Templates</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <AgentMark icon={suggestedAgentIcon(detail.icon)} size="sm" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-text">{detail.name}</h1>
            <p className="text-xs text-text-muted">{templateSourceLabel[detail.source] || "Template"} · Version {latest}</p>
          </div>
          {editable && !editing && (
            <button type="button" onClick={() => { setEditing(true); setSavedNotice(""); }} className="min-h-9 rounded-lg bg-accent px-3 text-xs font-bold text-bg hover:bg-accent-hover">
              Edit
            </button>
          )}
        </div>
        {detail.description && <p className="mt-2 max-w-3xl text-sm text-text-muted">{detail.description}</p>}
        {!editable && (
          <p className="mt-2 text-xs text-text-muted">
            {detail.source === "builtin" ? "Built-in templates change with platform updates." : "App templates change when their app is updated."}
            {" "}Agents created from them stay on their version unless you move them.
          </p>
        )}
      </div>

      <div className="page-safe-bottom flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {savedNotice && <p role="status" className="text-sm text-green">{savedNotice}</p>}
        {editing && (
          <TemplateEditor
            template={detail}
            onCancel={() => setEditing(false)}
            onSaved={(next, message) => {
              setDetail(next);
              setContents({});
              setOpen(null);
              setEditing(false);
              setSavedNotice(message);
            }}
            onReload={() => {
              setEditing(false);
              load();
            }}
          />
        )}

        <section aria-label="Agents">
          <h2 className={sectionTitle}>Agents ({detail.agents.length})</h2>
          {detail.agents.length === 0 ? (
            <p className="text-sm text-text-muted">No agents are linked to this template.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {detail.agents.map((agent) => (
                <li key={agent.agent_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <Link to={`/agents/${agent.agent_id}`} className="min-w-0 basis-full truncate font-semibold text-text hover:text-accent sm:flex-1 sm:basis-0">{agent.name}</Link>
                  <span className="text-xs text-text-muted">Version {agent.version}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${agent.follow_latest ? "bg-accent/10 text-accent" : "bg-bg-hover text-text-muted"}`}>
                    {agent.follow_latest ? "Follows new versions" : "Stays on its version"}
                  </span>
                  {agent.changed_locally && <span className="rounded bg-yellow/10 px-1.5 py-0.5 text-[11px] text-yellow">Changed on the agent</span>}
                  {agent.last_error && <span className="w-full text-xs text-red">Last update failed: {agent.last_error}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Versions">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className={`${sectionTitle} mb-0`}>Versions</h2>
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} className="accent-accent" />
              Show changes from the previous version
            </label>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {versions.map((version) => {
              const expanded = open === version.version;
              const content = contents[version.version];
              const previous = version.version > 1 ? contents[version.version - 1] : undefined;
              const followers = detail.agents.filter((agent) => agent.version === version.version).length;
              return (
                <li key={version.version}>
                  <button type="button" aria-expanded={expanded} onClick={() => void toggle(version.version)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-bg-hover">
                    <span className="text-sm font-semibold text-text">Version {version.version}</span>
                    {version.version === latest && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">Latest</span>}
                    <span className="order-last basis-full whitespace-nowrap text-xs text-text-muted sm:order-none sm:basis-auto">{formatDate(version.created_at)}</span>
                    <span className="ml-auto flex items-center gap-3 text-xs text-text-muted">
                      {followers > 0 && <span>{followers} agent{followers === 1 ? "" : "s"}</span>}
                      <span aria-hidden="true">{expanded ? "Hide" : "View"}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border px-4 py-3">
                      {!content ? (
                        <p className="text-xs text-text-muted">Loading…</p>
                      ) : (
                        <VersionContent content={content} previous={showChanges ? previous : undefined} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function VersionContent({ content, previous }: { content: AgentTemplateVersionContent; previous?: AgentTemplateVersionContent }) {
  const apps = templateApps(content).join(", ") || "None";
  const previousApps = previous ? templateApps(previous).join(", ") || "None" : apps;
  const lines = useMemo(() => (previous ? diffLines(previous.directive, content.directive) : null), [previous, content.directive]);
  const changed = (now: string, before: string) => (previous && now !== before ? <span className="ml-2 text-[11px] text-yellow">changed from {before}</span> : null);
  return (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="text-xs text-text-muted">Mode</dt>
        <dd className="text-text">{content.mode}{changed(content.mode, previous?.mode || "")}</dd>
        <dt className="text-xs text-text-muted">Background memory</dt>
        <dd className="text-text">
          {content.unconscious ? "On" : "Off"}
          {changed(content.unconscious ? "On" : "Off", previous?.unconscious ? "On" : "Off")}
        </dd>
        <dt className="text-xs text-text-muted">Apps</dt>
        <dd className="text-text">{apps}{changed(apps, previousApps)}</dd>
      </dl>
      <div>
        <div className="mb-1 text-xs text-text-muted">Instructions{lines ? " (changes from the previous version)" : ""}</div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-input p-3 font-mono text-xs leading-relaxed text-text">
          {lines
            ? lines.map((line, index) => (
                <div
                  key={index}
                  className={line.kind === "added" ? "bg-green/10 text-green" : line.kind === "removed" ? "bg-red/10 text-red line-through" : undefined}
                >
                  <span aria-hidden="true" className="select-none opacity-60">{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}</span>
                  <span className="sr-only">{line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}</span>
                  {line.text || " "}
                </div>
              ))
            : content.directive}
        </pre>
      </div>
    </div>
  );
}

function TemplateEditor({ template, onCancel, onSaved, onReload }: {
  template: AgentTemplateDetail;
  onCancel: () => void;
  onSaved: (next: AgentTemplateDetail, message: string) => void;
  onReload: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [directive, setDirective] = useState(template.directive);
  const [mode, setMode] = useState(template.mode);
  const [unconscious, setUnconscious] = useState(template.unconscious);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const save = async () => {
    setBusy(true);
    setError("");
    const { versions: _versions, agents: _agents, ...rest } = template;
    try {
      const next = await agentTemplates.update(
        template.id,
        { ...rest, name: name.trim(), description: description.trim(), directive, mode, unconscious },
        template.version,
      );
      const newVersion = (next.version || 0) > (template.version || 0);
      const following = next.agents.filter((agent) => agent.follow_latest).length;
      onSaved(next, newVersion
        ? `Saved version ${next.version}.${following ? ` ${following} following agent${following === 1 ? " gets" : "s get"} it within a minute, unless changed on the agent itself.` : ""}`
        : "Saved. Name and description changes don't make a new version.");
    } catch (err: any) {
      if (err?.status === 409) setConflict(true);
      else setError(err?.message || "Could not save the template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Edit template" className="space-y-4 rounded-lg border border-border p-4">
      <h2 className={sectionTitle}>Edit template</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="template-edit-name" className="mb-1 block text-xs text-text-muted">Name</label>
          <input id="template-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} />
        </div>
        <div>
          <label htmlFor="template-edit-mode" className="mb-1 block text-xs text-text-muted">Mode</label>
          <select id="template-edit-mode" value={mode} onChange={(e) => setMode(e.target.value as AgentTemplate["mode"])} className={field}>
            <option value="learn">learn</option>
            <option value="cautious">cautious</option>
            <option value="autonomous">autonomous</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="template-edit-description" className="mb-1 block text-xs text-text-muted">Description</label>
        <textarea id="template-edit-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={field} />
      </div>
      <div>
        <label htmlFor="template-edit-directive" className="mb-1 block text-xs text-text-muted">Instructions</label>
        <textarea id="template-edit-directive" value={directive} onChange={(e) => setDirective(e.target.value)} rows={12} className={`${field} font-mono text-xs leading-relaxed`} />
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={unconscious} onChange={(e) => setUnconscious(e.target.checked)} className="accent-accent" />
        Background memory
      </label>
      <p className="text-xs text-text-muted">
        Changing the instructions, mode or background memory saves a new version. Agents that follow this template get it; agents changed on the agent itself keep their changes.
      </p>
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow/40 bg-yellow/5 px-3 py-2 text-xs text-text">
          <span className="flex-1">A newer version was saved since you opened this. Reload to see it before saving.</span>
          <button type="button" onClick={onReload} className={secondaryButton}>Reload</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || conflict || !name.trim() || !directive.trim()} onClick={save} className="min-h-9 rounded-lg bg-accent px-3 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={secondaryButton}>Cancel</button>
      </div>
    </section>
  );
}
