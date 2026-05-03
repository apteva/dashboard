// Skills — list + manage all skills available in the current project.
//
// Three sources merged into one list:
//   - app:     shipped by an installed app (read-only, badge shows app)
//   - user:    operator-authored (editable inline)
//   - builtin: shipped by apteva (read-only)
//
// Filter pills + search at the top, list below, side panel for one
// skill open on click. "+ New skill" opens the same panel in create
// mode. The agent runtime integration is a separate task — for now
// this page is purely a management surface.

import { useEffect, useMemo, useState } from "react";
import { skills as skillsApi, type Skill } from "../api";
import { useProjects } from "../hooks/useProjects";

type SourceFilter = "all" | "user" | "app" | "builtin";

export function Skills() {
  const { currentProject } = useProjects();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [openSkill, setOpenSkill] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    setLoading(true);
    skillsApi
      .list(currentProject?.id)
      .then((rows) => {
        setSkills(rows);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((sk) => {
      if (filter !== "all" && sk.source !== filter) return false;
      if (!q) return true;
      return (
        sk.name.toLowerCase().includes(q) ||
        sk.description.toLowerCase().includes(q) ||
        (sk.command || "").toLowerCase().includes(q) ||
        (sk.app_name || "").toLowerCase().includes(q)
      );
    });
  }, [skills, filter, search]);

  const counts = useMemo(() => {
    const c = { all: skills.length, user: 0, app: 0, builtin: 0 };
    for (const sk of skills) c[sk.source]++;
    return c;
  }, [skills]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <h1 className="text-text font-medium">Skills</h1>
        <span className="text-text-dim text-xs">
          {filtered.length}/{skills.length}
        </span>
        <div className="flex gap-1 ml-2">
          {(["all", "user", "app", "builtin"] as SourceFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-xs rounded border ${
                filter === f
                  ? "border-accent text-accent bg-accent/10"
                  : "border-border text-text-muted hover:bg-bg-input"
              }`}
            >
              {f === "all" ? "All" : f === "user" ? "My skills" : f === "app" ? "From apps" : "Built-in"}
              <span className="ml-1 text-text-dim">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, description, command…"
          className="ml-auto bg-bg-input border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent w-64"
        />
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-3 py-1 text-sm rounded bg-accent text-bg font-medium"
        >
          + New skill
        </button>
      </header>

      <main className="flex-1 overflow-auto">
        {error && <div className="p-4 text-error text-sm">{error}</div>}
        {loading ? (
          <div className="p-6 text-text-dim text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-text-muted text-sm">
            {skills.length === 0
              ? "No skills yet. Install apps to ship skills, or create your own."
              : "No skills match the current filters."}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((sk) => (
              <SkillRow key={sk.id} skill={sk} onOpen={() => setOpenSkill(sk)} onChanged={refresh} />
            ))}
          </ul>
        )}
      </main>

      {openSkill && (
        <SkillPanel
          skill={openSkill}
          onClose={() => setOpenSkill(null)}
          onChanged={() => {
            setOpenSkill(null);
            refresh();
          }}
        />
      )}
      {creating && currentProject && (
        <SkillPanel
          createForProject={currentProject.id}
          onClose={() => setCreating(false)}
          onChanged={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// --- Row ----------------------------------------------------------------

function SkillRow({
  skill,
  onOpen,
  onChanged,
}: {
  skill: Skill;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const toggleEnabled = (e: React.MouseEvent) => {
    e.stopPropagation();
    skillsApi.setEnabled(skill.id, !skill.enabled).then(onChanged);
  };
  const icon = (skill.metadata?.icon as string) || sourceIcon(skill.source);
  return (
    <li
      onClick={onOpen}
      className="px-6 py-3 flex items-start gap-3 cursor-pointer hover:bg-bg-hover"
    >
      <span className="text-xl leading-none mt-0.5" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text text-sm font-medium">{skill.name}</span>
          {skill.command && (
            <span className="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
              {skill.command}
            </span>
          )}
          <SourceBadge skill={skill} />
          {!skill.enabled && (
            <span className="text-[10px] uppercase tracking-wide text-text-dim">disabled</span>
          )}
        </div>
        <p className="text-text-muted text-xs mt-0.5 line-clamp-2">{skill.description}</p>
      </div>
      <button
        type="button"
        onClick={toggleEnabled}
        className={`text-xs px-2 py-1 rounded border ${
          skill.enabled
            ? "border-success text-success"
            : "border-border text-text-dim"
        }`}
      >
        {skill.enabled ? "Enabled" : "Disabled"}
      </button>
    </li>
  );
}

function SourceBadge({ skill }: { skill: Skill }) {
  if (skill.source === "user") {
    return <span className="text-[10px] uppercase tracking-wide text-text-dim">My skill</span>;
  }
  if (skill.source === "app") {
    return (
      <span className="text-[10px] text-text-dim">
        From <span className="text-text-muted font-medium">{skill.app_name || "app"}</span>
      </span>
    );
  }
  return <span className="text-[10px] uppercase tracking-wide text-text-dim">Built-in</span>;
}

function sourceIcon(source: string): string {
  if (source === "user") return "🧠";
  if (source === "app") return "📦";
  return "⚙️";
}

// --- Side panel (view + edit + create) ---------------------------------

function SkillPanel({
  skill,
  createForProject,
  onClose,
  onChanged,
}: {
  skill?: Skill;
  createForProject?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isCreate = !skill;
  const editable = isCreate || skill?.source === "user";
  const [name, setName] = useState(skill?.name || "");
  const [description, setDescription] = useState(skill?.description || "");
  const [body, setBody] = useState(skill?.body || "");
  const [command, setCommand] = useState(skill?.command || "");
  const [editing, setEditing] = useState(isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const promise = isCreate
      ? skillsApi.create({
          name,
          description,
          body,
          command: command || undefined,
          project_id: createForProject || "",
        })
      : skillsApi.update(skill!.id, { name, description, body, command });
    promise
      .then(() => onChanged())
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const remove = () => {
    if (!skill || !confirm(`Delete skill "${skill.name}"?`)) return;
    skillsApi
      .remove(skill.id)
      .then(() => onChanged())
      .catch((e: Error) => setError(e.message));
  };

  return (
    <>
      <div className="fixed inset-0 bg-bg-overlay z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 h-full w-[640px] max-w-[95vw] bg-bg-card border-l border-border z-50 flex flex-col shadow-xl">
        <header className="px-5 py-3 border-b border-border flex items-center gap-3">
          <h2 className="text-text font-medium flex-1">
            {isCreate ? "New skill" : skill!.name}
          </h2>
          {!isCreate && skill && skill.source === "app" && (
            <span className="text-[10px] text-text-dim">
              From <span className="text-text-muted font-medium">{skill.app_name}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text text-xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 flex flex-col gap-4">
          {!editable && (
            <p className="text-text-dim text-xs italic">
              This skill is managed by the platform — uninstall the owning app to remove it.
            </p>
          )}

          <Field label="Name" disabled={!editable}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editing}
              placeholder="lowercase-slug-name"
              className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text disabled:opacity-60"
            />
          </Field>
          <Field label="Description (the trigger)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!editing}
              rows={3}
              placeholder="When the user wants to X — covers cases A, B, C. Triggers on: 'phrase 1', 'phrase 2'…"
              className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text disabled:opacity-60"
            />
          </Field>
          <Field label="Slash command (optional)">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={!editing}
              placeholder="/storage"
              className="bg-bg-input border border-border rounded px-2 py-1 text-sm text-text font-mono disabled:opacity-60"
            />
          </Field>
          <Field label="Body (markdown)">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!editing}
              rows={20}
              placeholder="# How to do X\n\nDetailed instructions, examples, do's-and-don'ts…"
              className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text font-mono disabled:opacity-60 leading-relaxed"
            />
          </Field>
          {error && <div className="text-error text-xs">{error}</div>}
        </div>

        <footer className="px-5 py-3 border-t border-border flex items-center gap-2">
          {editable ? (
            editing ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !name || !description}
                  className="px-3 py-1 text-sm rounded bg-accent text-bg font-medium disabled:opacity-40"
                >
                  {saving ? "Saving…" : isCreate ? "Create" : "Save"}
                </button>
                {!isCreate && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setName(skill!.name);
                      setDescription(skill!.description);
                      setBody(skill!.body);
                      setCommand(skill!.command || "");
                    }}
                    className="px-3 py-1 text-sm rounded text-text-muted"
                  >
                    Cancel
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="px-3 py-1 text-sm rounded border border-border text-text"
              >
                Edit
              </button>
            )
          ) : null}
          {!isCreate && skill?.source === "user" && (
            <button
              type="button"
              onClick={remove}
              className="ml-auto px-3 py-1 text-sm text-error"
            >
              Delete
            </button>
          )}
        </footer>
      </aside>
    </>
  );
}

function Field({
  label,
  children,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${disabled ? "opacity-80" : ""}`}>
      <span className="text-text-dim text-[11px] uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}
