import { useEffect, useMemo, useState } from "react";
import {
  projectPresets,
  projects,
  type Project,
  type ProjectPreset,
} from "../../api";

const CATEGORIES = [
  { id: "personal", label: "Personal" },
  { id: "work", label: "Work" },
  { id: "development", label: "Development" },
  { id: "business", label: "Business" },
] as const;

type PresetCategory = (typeof CATEGORIES)[number]["id"];
const DEFAULT_CATEGORY: PresetCategory = CATEGORIES[0].id;

const DASHBOARD_LABELS: Record<string, string> = {
  "native:usage": "Usage summary",
  "native:inbox": "Inbox",
  "native:activity": "Recent activity",
  "tasks:task-overview": "Tasks",
};

function presetCountSummary(preset: ProjectPreset) {
  const agents = preset.agents.length;
  const apps = new Set(preset.agents.flatMap((agent) => agent.apps || [])).size;
  const widgets = preset.dashboard?.length || 0;
  return `${agents} agent${agents === 1 ? "" : "s"} · ${apps} app${apps === 1 ? "" : "s"} · ${widgets} widget${widgets === 1 ? "" : "s"}`;
}

function dashboardLabel(component: string) {
  if (DASHBOARD_LABELS[component]) return DASHBOARD_LABELS[component];
  const value = component.includes(":") ? component.split(":").pop() || component : component;
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ProjectPresetSetup({
  projectId,
  onApplied,
}: {
  projectId?: string;
  onApplied?: (result: {
    created: number;
    existing: number;
    createdAgents: Array<{ id: number; name: string; status: string }>;
  }) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [catalog, setCatalog] = useState<ProjectPreset[]>([]);
  const [category, setCategory] = useState<PresetCategory>(DEFAULT_CATEGORY);
  const [presetId, setPresetId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([projectPresets.list(), projects.list()])
      .then(([catalogResponse, availableProjects]) => {
        if (!active) return;
        setCatalog(catalogResponse.presets);
        const initialCategory = catalogResponse.presets.some((preset) => preset.category === DEFAULT_CATEGORY)
          ? DEFAULT_CATEGORY
          : catalogResponse.presets[0]?.category || DEFAULT_CATEGORY;
        const initialPreset = catalogResponse.presets.find((preset) => preset.category === initialCategory);
        setCategory(initialCategory);
        setPresetId(initialPreset?.id || "");
        const selected = projectId
          ? availableProjects.find((item) => item.id === projectId) || null
          : availableProjects[0] || null;
        setProject(selected);
        setDescription(selected?.description || "");
      })
      .catch((err) => active && setError(err?.message || "Could not load project setup options"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId]);

  const selectedPreset = useMemo(
    () => catalog.find((preset) => preset.id === presetId) || null,
    [catalog, presetId],
  );
  const visiblePresets = catalog.filter((preset) => preset.category === category);

  const chooseCategory = (nextCategory: PresetCategory) => {
    setCategory(nextCategory);
    setPresetId(catalog.find((preset) => preset.category === nextCategory)?.id || "");
    setApplied("");
    setError("");
  };

  const apply = async () => {
    if (!project || !selectedPreset) {
      setError("Choose a preset to continue.");
      return;
    }
    if (!description.trim()) {
      setError("Describe what these agents should help with.");
      return;
    }
    setApplying(true);
    setError("");
    setApplied("");
    try {
      const result = await projectPresets.apply(project.id, {
        preset_id: selectedPreset.id,
        description: description.trim(),
      });
      const created = result.created_agents.length;
      const existing = result.existing_agents.length;
      const warnings = result.warnings.length
        ? ` ${result.warnings.length} app or widget${result.warnings.length === 1 ? "" : "s"} still need attention.`
        : "";
      setApplied(`Setup created. ${created} agent${created === 1 ? "" : "s"} created${existing ? `, ${existing} already present` : ""}.${warnings}`);
      onApplied?.({ created, existing, createdAgents: result.created_agents });
    } catch (err: any) {
      setError(err?.message || "Could not create this setup");
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <p className="text-text-muted text-sm">Loading setup options…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-text text-lg font-bold">Set up your project</h2>
        <p className="text-text-muted text-sm mt-1">
          Describe the work, choose a starting point, and Apteva creates its predefined agents with the right available apps.
        </p>
      </div>

      <div>
        <label htmlFor="project-preset-description" className="block text-text-muted text-sm mb-2">
          What should these agents help with?
        </label>
        <textarea
          id="project-preset-description"
          value={description}
          onChange={(event) => {
            setDescription((event.target as HTMLTextAreaElement).value);
            setApplied("");
          }}
          rows={3}
          className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent resize-none"
          placeholder="For example: qualify leads for medical clinics, keep the CRM current, and prepare outreach for review"
        />
      </div>

      <div>
        <div className="text-text-muted text-sm mb-2">Choose a preset</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {CATEGORIES.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => chooseCategory(item.id)}
              className={`px-3 py-1.5 border rounded text-xs transition-colors ${
                category === item.id
                  ? "border-accent text-accent bg-accent/5"
                  : "border-border text-text-muted hover:text-text hover:border-text-dim"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visiblePresets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              onClick={() => {
                setPresetId(preset.id);
                setApplied("");
                setError("");
              }}
              className={`text-left border rounded-lg p-3 transition-colors ${
                presetId === preset.id
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-text-dim"
              }`}
            >
              <div className="text-text text-sm font-bold">{preset.name}</div>
              <div className="text-text-muted text-xs mt-1 leading-relaxed">{preset.description}</div>
              <div className="text-text-dim text-[11px] mt-2">{presetCountSummary(preset)}</div>
            </button>
          ))}
        </div>
      </div>

      {selectedPreset && <PresetContentsSummary preset={selectedPreset} />}

      <button
        type="button"
        onClick={apply}
        disabled={applying || !selectedPreset}
        className="px-5 py-2 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover disabled:opacity-50"
      >
        {applying ? "Creating setup…" : "Create setup"}
      </button>

      {error && <div className="text-red text-sm">{error}</div>}
      {applied && <div className="border border-green/40 bg-green/5 text-green rounded-lg p-4 text-sm">{applied}</div>}
    </div>
  );
}

function PresetContentsSummary({ preset }: { preset: ProjectPreset }) {
  return (
    <section className="border border-accent/35 bg-accent/5 rounded-lg p-4" aria-label="What this setup includes">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-text text-sm font-bold">What this setup creates</h3>
          <p className="text-text-muted text-xs mt-1">Each agent receives the available apps listed beneath it.</p>
        </div>
        <span className="text-text-dim text-[11px]">{presetCountSummary(preset)}</span>
      </div>

      <div className="space-y-3 mt-4">
        {preset.agents.map((agent) => (
          <div key={agent.key} className="border border-border rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-text text-xs font-bold">{agent.name}</div>
              <div className="text-text-dim text-[10px] uppercase tracking-wide">{agent.mode}</div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(agent.apps || []).map((app) => (
                <span key={app} className="border border-border rounded px-2 py-0.5 text-text-muted text-[11px]">{app}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {(preset.dashboard?.length || 0) > 0 && (
        <div className="mt-4">
          <div className="text-text-dim text-[10px] uppercase tracking-wide mb-2">Home dashboard</div>
          <div className="flex flex-wrap gap-1.5">
            {(preset.dashboard || []).map((component) => (
              <span key={component} className="border border-border rounded px-2 py-0.5 text-text-muted text-[11px]">
                {dashboardLabel(component)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
