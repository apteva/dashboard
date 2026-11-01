import { useEffect, useState } from "react";
import {
  mcpServers,
  projectGrants,
  type Agent,
  type AgentProjectGrant,
  type AgentProjectGrants as GrantsResponse,
  type MCPServer,
  type MCPServerConfig,
} from "../api";
import { Modal } from "./Modal";

// AgentProjectGrants lets a globally installed app (or the Apteva Server
// tools) run in other projects. The default, with no grant, keeps the agent in
// its own project; the server also stops at projects with their own install of
// the app, and where the agent's owner, or the person who set the grant,
// cannot edit.

const PLATFORM_TARGET = "apteva-server";

interface GrantTarget {
  target: string;
  label: string;
  row?: MCPServer;
}

export function grantTargets(attached: MCPServerConfig[], inventory: MCPServer[], label: (row: MCPServer) => string): GrantTarget[] {
  const out: GrantTarget[] = [];
  for (const capability of attached) {
    if (capability.name === PLATFORM_TARGET) {
      out.push({ target: PLATFORM_TARGET, label: "Apteva Server", row: inventory.find((row) => row.source === "builtin") });
      continue;
    }
    const row = inventory.find((candidate) => candidate.source === "app" && (candidate.proxy_config?.name || candidate.name) === capability.name);
    if (row) out.push({ target: capability.name, label: label(row), row });
  }
  return out;
}

export function grantSummary(grant: AgentProjectGrant | undefined, projects: { id: string; name: string }[]): string {
  if (!grant) return "This project only";
  const where = grant.all_projects
    ? "All projects you can edit"
    : grant.project_ids.map((id) => projects.find((p) => p.id === id)?.name || id).join(", ");
  return grant.tools.length ? `${where} · ${grant.tools.length} ${grant.tools.length === 1 ? "tool" : "tools"}` : where;
}

export function AgentProjectGrants({ instance, attached, inventory, label }: {
  instance: Agent;
  attached: MCPServerConfig[];
  inventory: MCPServer[];
  label: (row: MCPServer) => string;
}) {
  const [data, setData] = useState<GrantsResponse | null>(null);
  const [editing, setEditing] = useState<GrantTarget | null>(null);
  const [error, setError] = useState("");
  const scoped = !!instance.project_id && instance.kind !== "platform_helper";

  useEffect(() => {
    if (!scoped) return;
    setData(null);
    projectGrants.get(instance.id).then(setData).catch((err) => setError(err?.message || "Failed to load project access"));
  }, [instance.id, scoped]);

  if (!scoped) return null;
  if (!data) return error ? <p className="mt-6 text-xs text-red">{error}</p> : null;
  // Apps attached through a project install are left out; a grant left over
  // from an earlier install stays listed so it can be removed.
  const targets = grantTargets(attached, inventory, label)
    .filter((item) => item.target in data.targets || data.grants.some((g) => g.target === item.target));
  if (targets.length === 0) return null;

  return (
    <section className="mt-6 space-y-2" aria-label="Use in other projects">
      <div>
        <h2 className="text-sm font-semibold text-text">Use in other projects</h2>
        <p className="mt-1 text-xs text-text-muted">
          By default this agent works only in its own project. Allow a globally installed app here to let the agent run its tools in other projects you can edit.
        </p>
      </div>
      {data.warning && <p className="text-xs text-text-muted">{data.warning}</p>}
      <div className="divide-y divide-border rounded-lg border border-border">
        {targets.map((item) => {
          const grant = data.grants.find((g) => g.target === item.target);
          return (
            <div key={item.target} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-text">{item.label}</span>
                <span className={`mt-0.5 block truncate text-[11px] ${grant ? "text-accent" : "text-text-muted"}`}>
                  {grantSummary(grant, data.projects)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setEditing(item)}
                className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent hover:text-text"
              >
                Change
              </button>
            </div>
          );
        })}
      </div>
      {editing && (
        <GrantEditor
          agentId={instance.id}
          item={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={(next) => { setData(next); setEditing(null); }}
        />
      )}
    </section>
  );
}

function GrantEditor({ agentId, item, data, onClose, onSaved }: {
  agentId: number;
  item: GrantTarget;
  data: GrantsResponse;
  onClose: () => void;
  onSaved: (next: GrantsResponse) => void;
}) {
  const current = data.grants.find((g) => g.target === item.target);
  const [scope, setScope] = useState<"home" | "all" | "some">(!current ? "home" : current.all_projects ? "all" : "some");
  const [chosen, setChosen] = useState<Set<string>>(new Set(current?.project_ids || []));
  const [limitTools, setLimitTools] = useState(!!current?.tools.length);
  const [tools, setTools] = useState<Set<string>>(new Set(current?.tools || []));
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = item.row?.id;
    if (!id) return;
    mcpServers.tools(id)
      .then((res) => {
        setToolNames((res.tools || []).map((t) => t.name).sort());
        setReadOnly(new Set((res.tools || []).filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name)));
      })
      .catch(() => setToolNames((item.row?.allowed_tools || []).slice().sort()));
  }, [item.row?.id]);

  // Only projects this install reaches are offered. Projects already named in
  // the grant stay visible so they can be removed; saving them is refused by
  // the server.
  const reachable = data.targets[item.target] || [];
  const offered = data.projects.filter((p) => reachable.includes(p.id));
  const projects = [
    ...offered,
    ...(current?.project_ids || []).filter((id) => !offered.some((p) => p.id === id))
      .map((id) => ({ id, name: data.projects.find((p) => p.id === id)?.name || id })),
  ];
  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };
  const invalid = (scope === "some" && chosen.size === 0) || (scope !== "home" && limitTools && tools.size === 0);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const next = await projectGrants.set(agentId, {
        target: item.target,
        all_projects: scope === "all",
        project_ids: scope === "some" ? [...chosen] : [],
        tools: scope !== "home" && limitTools ? [...tools] : [],
      });
      onSaved(next);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
      setSaving(false);
    }
  };

  const option = (value: typeof scope, title: string, detail: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2 hover:border-accent/60">
      <input type="radio" name="grant-scope" className="mt-0.5" checked={scope === value} onChange={() => setScope(value)} />
      <span>
        <span className="block text-sm text-text">{title}</span>
        <span className="block text-xs text-text-muted">{detail}</span>
      </span>
    </label>
  );

  return (
    <Modal open onClose={onClose} width="max-w-lg" ariaLabel={`${item.label} in other projects`}>
      <div className="flex max-h-[80vh] flex-col p-4 sm:p-6">
        <div className="shrink-0">
          <h3 className="text-base font-bold text-text">{item.label} in other projects</h3>
          <p className="mt-1 text-sm text-text-muted">
            The agent names the project on each call. It can never do more there than you, or the agent's owner, could.
          </p>
        </div>
        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {option("home", "This project only", "Default. Every call runs in the agent's own project.")}
          {option("all", "All projects you can edit", item.target === PLATFORM_TARGET
            ? "Includes projects created later."
            : "Includes projects created later, except ones with their own install of this app.")}
          {option("some", "Chosen projects", "Only the projects you tick.")}
          {scope === "some" && (
            <div className="ml-6 space-y-1">
              {projects.length === 0 && <p className="text-xs text-text-dim">No other project you can edit uses this install.</p>}
              {projects.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={() => setChosen((set) => toggle(set, p.id))} />
                  {p.name}
                </label>
              ))}
            </div>
          )}
          {scope !== "home" && (
            <div className="border-t border-border pt-3">
              {item.target !== PLATFORM_TARGET && readOnly.size > 0 && (
                <p className="mb-2 text-xs text-text-muted">
                  Tools marked read-only can also run in every project at once, with one combined reply.
                </p>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={limitTools} onChange={(e) => setLimitTools(e.target.checked)} />
                Only some tools
              </label>
              {limitTools && (
                <div className="ml-6 mt-2 grid gap-1 sm:grid-cols-2">
                  {toolNames.length === 0 && <p className="text-xs text-text-dim">Tool list unavailable.</p>}
                  {toolNames.map((name) => (
                    <label key={name} className="flex min-w-0 cursor-pointer items-center gap-2 text-xs text-text">
                      <input type="checkbox" checked={tools.has(name)} onChange={() => setTools((set) => toggle(set, name))} />
                      <span className="truncate font-mono">{name}</span>
                      {item.target !== PLATFORM_TARGET && readOnly.has(name) && (
                        <span className="shrink-0 rounded border border-border px-1 text-[10px] text-text-muted">read-only</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-red">{error}</p>}
        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:text-text">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || invalid}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-bg transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
