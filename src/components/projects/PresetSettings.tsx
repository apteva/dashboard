import { useEffect, useMemo, useState } from "react";
import {
  presets as presetsAPI,
  projects as projectsAPI,
  type Preset,
  type Project,
  type ProjectSetupPresetDefinition,
} from "../../api";
import { Modal } from "../Modal";

const CATEGORIES: Array<{ id: ProjectSetupPresetDefinition["category"]; label: string }> = [
  { id: "personal", label: "Personal" },
  { id: "work", label: "Work" },
  { id: "development", label: "Development" },
  { id: "business", label: "Business" },
];

function widgetCount(preset: Preset) {
  return preset.definition.dashboard_layout?.length || preset.definition.dashboard?.length || 0;
}

function presetSummary(preset: Preset) {
  const apps = new Set(preset.definition.agents.flatMap((agent) => agent.apps || [])).size;
  const agents = preset.definition.agents.length;
  const widgets = widgetCount(preset);
  return `${agents} agent${agents === 1 ? "" : "s"} · ${apps} app${apps === 1 ? "" : "s"} · ${widgets} widget${widgets === 1 ? "" : "s"}`;
}

export function PresetSettings() {
  const [catalog, setCatalog] = useState<Preset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [editing, setEditing] = useState<Preset | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [targetProjectId, setTargetProjectId] = useState("");

  const load = async () => {
    setError("");
    try {
      const [presetResult, projectResult] = await Promise.all([presetsAPI.list(), projectsAPI.list()]);
      setCatalog(presetResult.presets);
      setProjects(projectResult);
      setTargetProjectId((current) => current || projectResult[0]?.id || "");
    } catch (err: any) {
      setError(err?.message || "Could not load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => {
    const projectGroups = projects.map((project) => ({
      key: project.id,
      title: project.name,
      description: "Reusable by members of this project.",
      presets: catalog.filter((preset) => preset.scope === "project" && preset.owner_project_id === project.id),
    }));
    const legacy = catalog.filter((preset) => preset.scope === "personal" || preset.scope === "shared");
    return [
      ...projectGroups,
      ...(legacy.length ? [{ key: "legacy", title: "Unassigned legacy templates", description: "Older templates kept for compatibility; new templates always belong to a project.", presets: legacy }] : []),
      { key: "system", title: "Built-in templates", description: "Read-only starting points shipped with Apteva.", presets: catalog.filter((preset) => preset.scope === "system") },
    ];
  }, [catalog, projects]);

  const duplicate = async (preset: Preset) => {
    if (!targetProjectId) { setError("Choose a destination project first."); return; }
    setError("");
    try {
      await presetsAPI.createForProject(targetProjectId, {
        name: `Copy of ${preset.name}`,
        description: preset.description,
        definition: preset.definition,
      });
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not duplicate template");
    }
  };

  const remove = async (preset: Preset) => {
    if (!window.confirm(`Delete “${preset.name}”? Projects already created from it are unchanged.`)) return;
    try {
      await presetsAPI.delete(preset.id);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not delete template");
    }
  };

  return (
    <div className="max-w-4xl space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-text">Templates</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            Save a project’s agents, app assignments, and Home widgets as a reusable project-owned setup. Project data and credentials are never included.
          </p>
        </div>
        <button type="button" onClick={() => setCaptureOpen(true)} disabled={projects.length === 0}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-bg hover:bg-accent-hover disabled:opacity-50">
          Save project as template
        </button>
      </div>

      {error && <p className="rounded-lg border border-red/40 bg-red/5 p-3 text-sm text-red" role="alert">{error}</p>}
      {!loading && projects.length > 0 && <Field label="Destination for duplicates"><select value={targetProjectId} onChange={(event) => setTargetProjectId(event.target.value)} className={inputClass}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}
      {loading ? <p className="text-sm text-text-muted">Loading templates…</p> : groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-text">{group.title}</h3>
            <p className="text-xs text-text-dim">{group.description}</p>
          </div>
          {group.presets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-xs text-text-dim">No {group.title.toLowerCase()} yet.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {group.presets.map((preset) => {
                const owned = preset.source === "user";
                return (
                  <article key={preset.id} className="rounded-lg border border-border bg-bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-bold text-text">{preset.name}</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">{preset.description || "No description"}</p>
                        <p className="mt-2 text-[11px] text-text-dim">{presetSummary(preset)}</p>
                      </div>
                      <span className="rounded border border-border px-2 py-0.5 text-[10px] uppercase text-text-dim">{preset.definition.category}</span>
                    </div>
                    {expanded === preset.id && <PresetDetails preset={preset} />}
                    <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-3 text-xs">
                      <button type="button" onClick={() => setExpanded(expanded === preset.id ? null : preset.id)} className="text-text-muted hover:text-text">
                        {expanded === preset.id ? "Hide details" : "Preview"}
                      </button>
                      <button type="button" onClick={() => void duplicate(preset)} className="text-text-muted hover:text-text">Duplicate</button>
                      {owned && <button type="button" onClick={() => setEditing(preset)} className="text-text-muted hover:text-text">Edit</button>}
                      {owned && <button type="button" onClick={() => void remove(preset)} className="text-text-muted hover:text-red">Delete</button>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ))}

      <CapturePresetModal open={captureOpen} projects={projects} onClose={() => setCaptureOpen(false)} onSaved={load} />
      {editing && <EditPresetModal preset={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function PresetDetails({ preset }: { preset: Preset }) {
  const widgets = preset.definition.dashboard_layout?.map((widget) => widget.component) || preset.definition.dashboard || [];
  return (
    <div className="mt-4 space-y-3 rounded-lg bg-bg-input p-3 text-xs">
      {preset.definition.agents.map((agent) => (
        <div key={agent.key}>
          <div className="font-semibold text-text">{agent.name} <span className="font-normal text-text-dim">· {agent.mode}</span></div>
          {agent.apps?.length ? <div className="mt-1 text-text-muted">Apps: {agent.apps.join(", ")}</div> : null}
        </div>
      ))}
      {widgets.length > 0 && <div className="text-text-muted">Home: {widgets.join(", ")}</div>}
    </div>
  );
}

function CapturePresetModal({ open, projects, onClose, onSaved }: {
  open: boolean; projects: Project[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ProjectSetupPresetDefinition["category"]>("work");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open && !projectId) setProjectId(projects[0]?.id || ""); }, [open, projectId, projects]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !name.trim()) return;
    setBusy(true); setError("");
    try {
      await presetsAPI.capture({ project_id: projectId, name: name.trim(), description: description.trim(), category });
      await onSaved();
      setName(""); setDescription(""); onClose();
    } catch (err: any) { setError(err?.message || "Could not save template"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} ariaLabel="Save project as template">
      <form onSubmit={submit} className="space-y-4 p-6">
        <h3 className="text-base font-bold text-text">Save project as template</h3>
        <p className="text-xs leading-relaxed text-text-muted">Captures agent names, directives, modes, app assignments, and your Home layout. It excludes credentials, connections, memory, conversations, tasks, and runtime state.</p>
        <Field label="Project"><select value={projectId} onChange={(event) => setProjectId(event.target.value)} className={inputClass}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
        <Field label="Name"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="My project setup" /></Field>
        <Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} rows={2} /></Field>
        <Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className={inputClass}>{CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
        {error && <p className="text-xs text-red" role="alert">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted">Cancel</button><button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-bg disabled:opacity-50">{busy ? "Saving…" : "Save template"}</button></div>
      </form>
    </Modal>
  );
}

function EditPresetModal({ preset, onClose, onSaved }: { preset: Preset; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(preset.name);
  const [description, setDescription] = useState(preset.description);
  const [category, setCategory] = useState(preset.definition.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await presetsAPI.update(preset.id, { name: name.trim(), description: description.trim(), definition: { ...preset.definition, category } });
      await onSaved(); onClose();
    } catch (err: any) { setError(err?.message || "Could not update template"); }
    finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} ariaLabel="Edit template"><form onSubmit={submit} className="space-y-4 p-6"><h3 className="text-base font-bold text-text">Edit template</h3><Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field><Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} rows={3} /></Field><Field label="Category"><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className={inputClass}>{CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>{error && <p className="text-xs text-red">{error}</p>}<div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted">Cancel</button><button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-bg disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button></div></form></Modal>;
}

const inputClass = "mt-1.5 w-full rounded-lg border border-border bg-bg-input px-3 py-2.5 text-sm text-text focus:border-accent focus:outline-none";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-semibold text-text-muted">{label}</span>{children}</label>;
}
