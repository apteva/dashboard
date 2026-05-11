// Side panel that slides in from the right when a marketplace or
// installed app card is clicked. Single component for both contexts —
// `mode` decides which actions surface ("install" vs "uninstall"). The
// data shape is unified: from the marketplace we get a MarketplaceEntry
// (with a server-resolved `surfaces` block); from the installed list we
// pass an AppRow. Both have the fields we render here.
//
// Closes via ESC, the X button, or backdrop click. Backdrop is a thin
// dim overlay rather than a full opaque scrim — the page underneath
// stays readable so the user keeps context.

import { useEffect, useMemo, useState } from "react";
import type { AppRow, AppSurfaces, AppUIComponent, MarketplaceEntry } from "../../api";
import { apps } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { AppSurfaceBadges } from "./AppSurfaceBadges";
import { ChatComponentMount, type InstalledAppRow } from "./chatComponents";
import { SettingsSection } from "./SettingsSection";

type Mode = "marketplace" | "installed";

interface Props {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  entry?: MarketplaceEntry;
  install?: AppRow;
  onInstall?: () => void;
  onUninstall?: () => void;
  /** Fired after a scope change succeeds so the parent can refresh
   *  the app list (the row's project_id just changed). */
  onScopeChanged?: () => void;
}

interface View {
  name: string;
  display_name: string;
  description: string;
  version: string;
  icon: string;
  repo: string;
  manifestUrl?: string;
  surfaces?: AppSurfaces;
  installed: boolean;
  category?: string;
  tags?: string[];
  status?: string;
  installId?: number;
  components?: AppUIComponent[];
}

function viewFromProps(p: Props): View | null {
  if (p.mode === "marketplace" && p.entry) {
    const e = p.entry;
    return {
      name: e.name,
      display_name: e.display_name,
      description: e.description,
      version: e.version,
      icon: e.icon,
      repo: e.repo,
      manifestUrl: e.manifest_url,
      surfaces: e.surfaces,
      installed: e.installed,
      category: e.category,
      tags: e.tags,
    };
  }
  if (p.mode === "installed" && p.install) {
    const i = p.install;
    return {
      name: i.name,
      display_name: i.display_name || i.name,
      description: i.description,
      version: i.version,
      icon: i.icon,
      repo: "",
      surfaces: i.surfaces,
      installed: true,
      status: i.status,
      installId: i.install_id,
      components: i.ui_components,
    };
  }
  return null;
}

export function AppDetailPanel(props: Props) {
  const view = viewFromProps(props);
  // ESC to close. Re-bind on each open so the listener doesn't leak.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open || !view) return null;
  const s = view.surfaces;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 h-full w-full sm:w-[720px] bg-bg-card border-l border-border z-50 flex flex-col shadow-xl"
        role="dialog"
        aria-label={`${view.display_name} details`}
      >
        {/* Header — pinned, always visible. */}
        <div className="flex items-start gap-3 px-6 py-5 border-b border-border flex-shrink-0">
          {view.icon && (
            <img
              src={view.icon}
              alt=""
              className="w-10 h-10 rounded bg-bg-input p-0.5 flex-shrink-0"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-text text-base font-bold truncate">
              {view.display_name}
            </h2>
            <p className="text-text-muted text-xs mt-0.5 font-mono">
              {view.name} · v{view.version}
              {view.status && (
                <span className="ml-2 px-1.5 py-0.5 rounded bg-bg-hover">{view.status}</span>
              )}
            </p>
          </div>
          <button
            onClick={props.onClose}
            className="text-text-muted hover:text-text text-xl leading-none flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body — tabbed for installed mode (lots to show: bindings,
            settings, tools, deps), flat for marketplace previews. */}
        <PanelBody view={view} props={props} />

        {/* Footer — primary actions. */}
        <div className="border-t border-border px-6 py-4 flex-shrink-0 flex gap-2">
          {props.mode === "marketplace" && !view.installed && (
            <button
              onClick={props.onInstall}
              className="flex-1 px-3 py-2 bg-accent text-bg rounded font-bold text-sm hover:opacity-80"
            >
              Install
            </button>
          )}
          {props.mode === "marketplace" && view.installed && (
            <div className="flex-1 px-3 py-2 bg-bg-hover text-text-muted rounded text-sm text-center">
              Already installed
            </div>
          )}
          {props.mode === "installed" && props.install && (
            <>
              <ScopeButton install={props.install} onChanged={props.onScopeChanged} />
              <button
                onClick={props.onUninstall}
                className="flex-1 px-3 py-2 border border-red text-red rounded font-bold text-sm hover:bg-red/10"
              >
                Uninstall
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ComponentsSection lists every UIComponent the app declares and
// renders a live preview using the manifest's preview_props (when
// declared). Components without preview_props show the metadata
// only — name + slot + entry — so operators can still see what's
// declared without a render.
//
// The preview mounts via the same ChatComponentMount used by the
// actual chat panel, so what you see here is exactly what the
// agent's respond(components=…) call will surface.
function ComponentsSection({
  appName,
  version,
  installId,
  components,
}: {
  appName: string;
  version: string;
  installId: number;
  components: AppUIComponent[];
}) {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id ?? "";

  // ChatComponentMount expects the apps array (it looks up app by
  // name + reads ui_components). Build a single-entry array from the
  // current app — enough for the mount to resolve our component
  // entries correctly.
  const apps: InstalledAppRow[] = useMemo(
    () => [{ install_id: installId, name: appName, version, ui_components: components }],
    [installId, appName, version, components],
  );

  return (
    <section>
      <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
        Components ({components.length})
      </h3>
      <div className="space-y-4">
        {components.map((c) => (
          <div
            key={c.name}
            className="border border-border rounded p-3 space-y-2"
          >
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-mono text-text">{c.name}</span>
              <span className="text-text-dim">·</span>
              {(c.slots ?? []).map((slot) => (
                <span
                  key={slot}
                  className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted text-[10px] font-mono"
                >
                  {slot}
                </span>
              ))}
              <span className="text-text-dim ml-auto font-mono text-[10px]">
                {c.entry}
              </span>
            </div>
            {c.preview_props ? (
              <div className="bg-bg-input/40 rounded p-3">
                <div className="text-[10px] text-text-dim uppercase tracking-wide mb-2">
                  Preview
                </div>
                <ChatComponentMount
                  comp={{ app: appName, name: c.name, props: c.preview_props }}
                  apps={apps}
                  projectId={projectId}
                  // Use whichever slot the component declared first —
                  // most components today declare exactly one. Slot
                  // gating on the mount catches mismatches.
                  slot={(c.slots ?? [])[0] ?? "chat.message_attachment"}
                />
              </div>
            ) : (
              <div className="text-text-dim text-xs italic">
                No preview_props declared — manifest entry only.
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// PanelBody chooses between a flat (marketplace) and tabbed (installed)
// render. Tabs only matter when there's a lot to surface — settings,
// bindings, tools list — and they keep the panel scannable instead of
// turning into a kilometer-long scroll. Marketplace previews don't
// have settings or bindings to edit, so they stay flat.
function PanelBody({ view, props }: { view: View; props: Props }) {
  const s = view.surfaces;
  if (props.mode !== "installed") {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7">
        <FlatBody view={view} />
      </div>
    );
  }
  return <TabbedBody view={view} />;

  // helper kept inside scope so it can read s; same reading pattern as
  // before, just inlined for readability when bodies diverge.
  // (Not used directly here; FlatBody is the marketplace path.)
  void s;
}

// FlatBody — the original linear render, used for marketplace previews
// where there's nothing editable and operators just want to scan.
function FlatBody({ view }: { view: View }) {
  const s = view.surfaces;
  return (
    <>
      {view.description && (
        <section>
          <p className="text-text-dim text-sm leading-relaxed whitespace-pre-line">
            {view.description}
          </p>
        </section>
      )}
      {s && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Surfaces</h3>
          <AppSurfaceBadges surfaces={s} />
        </section>
      )}
      {s?.mcp_tool_names && s.mcp_tool_names.length > 0 && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
            MCP tools ({s.mcp_tool_names.length})
          </h3>
          <ul className="space-y-1 text-sm font-mono">
            {s.mcp_tool_names.map((t) => (
              <li key={t} className="text-text-dim">{t}</li>
            ))}
          </ul>
        </section>
      )}
      {s?.required_apps && s.required_apps.length > 0 && (
        <DependenciesList deps={s.required_apps} />
      )}
      {s?.permissions && s.permissions.length > 0 && (
        <PermissionsList perms={s.permissions} />
      )}
      {s?.config_keys && s.config_keys.length > 0 && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Configuration</h3>
          <p className="text-text-dim text-xs mb-1">Asks for these at install time:</p>
          <ul className="space-y-1 text-sm font-mono">
            {s.config_keys.map((k) => (
              <li key={k} className="text-text-dim">{k}</li>
            ))}
          </ul>
        </section>
      )}
      {view.tags && view.tags.length > 0 && <TagsList tags={view.tags} />}
      {(view.repo || view.manifestUrl) && (
        <LinksList repo={view.repo} manifestUrl={view.manifestUrl} />
      )}
    </>
  );
}

type TabKey = "overview" | "bindings" | "settings" | "tools";

// TabbedBody — installed-mode render. Bindings and Settings each get
// their own tab so they can spread out without competing with the
// 50-field config form for screen space. Tabs are visible at all
// times (no hidden state); the active one underlines.
function TabbedBody({ view }: { view: View }) {
  const s = view.surfaces;
  const hasBindings =
    (s?.required_apps && s.required_apps.length > 0) ||
    (s?.permissions && false); // bindings tab is roles+app-deps; show if either exists
  const showBindings = (s?.required_apps && s.required_apps.length > 0) || true;
  const showTools =
    (s?.mcp_tool_names && s.mcp_tool_names.length > 0) ||
    (s?.http_routes && s.http_routes.length > 0) ||
    (s?.channel_names && s.channel_names.length > 0) ||
    (view.components && view.components.length > 0);
  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: "overview", label: "Overview", visible: true },
    { key: "bindings", label: "Bindings", visible: !!showBindings },
    { key: "settings", label: "Settings", visible: view.installId !== undefined },
    { key: "tools", label: "Tools & UI", visible: !!showTools },
  ];
  const visibleTabs = tabs.filter((t) => t.visible);
  const [active, setActive] = useState<TabKey>("overview");
  void hasBindings;

  return (
    <>
      <div className="border-b border-border px-6 flex gap-5 flex-shrink-0">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`py-2.5 text-sm border-b-2 -mb-px transition ${
              active === t.key
                ? "border-accent text-text"
                : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7">
        {active === "overview" && <OverviewTab view={view} />}
        {active === "bindings" && view.installId !== undefined && (
          <BindingsEditor installId={view.installId} />
        )}
        {active === "settings" && view.installId !== undefined && (
          <SettingsSection installId={view.installId} />
        )}
        {active === "tools" && <ToolsTab view={view} />}
      </div>
    </>
  );
}

function OverviewTab({ view }: { view: View }) {
  const s = view.surfaces;
  return (
    <>
      {view.description && (
        <section>
          <p className="text-text-dim text-sm leading-relaxed whitespace-pre-line">
            {view.description}
          </p>
        </section>
      )}
      {s && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Surfaces</h3>
          <AppSurfaceBadges surfaces={s} />
        </section>
      )}
      {s?.required_apps && s.required_apps.length > 0 && (
        <DependenciesList deps={s.required_apps} />
      )}
      {s?.permissions && s.permissions.length > 0 && (
        <PermissionsList perms={s.permissions} />
      )}
      {view.tags && view.tags.length > 0 && <TagsList tags={view.tags} />}
      {(view.repo || view.manifestUrl) && (
        <LinksList repo={view.repo} manifestUrl={view.manifestUrl} />
      )}
    </>
  );
}

function ToolsTab({ view }: { view: View }) {
  const s = view.surfaces;
  return (
    <>
      {s?.mcp_tool_names && s.mcp_tool_names.length > 0 && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
            MCP tools ({s.mcp_tool_names.length})
          </h3>
          <ul className="space-y-1 text-sm font-mono">
            {s.mcp_tool_names.map((t) => (
              <li key={t} className="text-text-dim">{t}</li>
            ))}
          </ul>
        </section>
      )}
      {s?.http_routes && s.http_routes.length > 0 && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">HTTP routes</h3>
          <ul className="space-y-1 text-sm font-mono">
            {s.http_routes.map((r) => (
              <li key={r} className="text-text-dim">{r}</li>
            ))}
          </ul>
        </section>
      )}
      {s?.channel_names && s.channel_names.length > 0 && (
        <section>
          <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Channels</h3>
          <ul className="space-y-1 text-sm font-mono">
            {s.channel_names.map((c) => (
              <li key={c} className="text-text-dim">{c}</li>
            ))}
          </ul>
        </section>
      )}
      {view.components && view.components.length > 0 && view.installId !== undefined && (
        <ComponentsSection
          appName={view.name}
          version={view.version}
          installId={view.installId}
          components={view.components}
        />
      )}
    </>
  );
}

// Small extracted sections used by both flat + tabbed bodies.

function DependenciesList({ deps }: { deps: NonNullable<AppSurfaces["required_apps"]> }) {
  return (
    <section>
      <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Dependencies</h3>
      <ul className="space-y-1.5 text-sm">
        {deps.map((d) => {
          const status = d.installed ? "installed" : d.optional ? "optional" : "missing";
          const cls = d.installed ? "text-green" : d.optional ? "text-text-muted" : "text-red";
          const glyph = d.installed ? "✓" : d.optional ? "~" : "✗";
          return (
            <li key={d.name} className="flex items-start gap-2">
              <span className={`font-mono ${cls}`}>{glyph}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-text font-medium">{d.name}</span>
                  {d.version && (
                    <span className="text-[10px] text-text-dim font-mono">{d.version}</span>
                  )}
                  <span className={`text-[10px] uppercase tracking-wide ${cls}`}>
                    {status}
                  </span>
                </div>
                {d.reason && <p className="text-text-dim text-xs mt-0.5">{d.reason}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {deps.some((d) => !d.installed && !d.optional) && (
        <p className="text-text-dim text-[11px] mt-2">
          Missing required apps will be installed automatically alongside this one.
        </p>
      )}
    </section>
  );
}

function PermissionsList({ perms }: { perms: string[] }) {
  return (
    <section>
      <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
        Permissions required
      </h3>
      <ul className="space-y-1 text-sm font-mono">
        {perms.map((p) => (
          <li key={p} className="text-amber-200">{p}</li>
        ))}
      </ul>
    </section>
  );
}

function TagsList({ tags }: { tags: string[] }) {
  return (
    <section>
      <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Tags</h3>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <span
            key={t}
            className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted"
          >
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}

function LinksList({ repo, manifestUrl }: { repo?: string; manifestUrl?: string }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">Links</h3>
      <ul className="space-y-1 text-sm">
        {repo && (
          <li>
            <a href={repo} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Repository ↗
            </a>
          </li>
        )}
        {manifestUrl && (
          <li>
            <a href={manifestUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Manifest ↗
            </a>
          </li>
        )}
      </ul>
    </section>
  );
}

// BindingsEditor — installed-mode-only section that lets the operator
// rebind integration roles AND requires.apps deps without
// uninstalling. Fetches the same role summaries the install dialog
// uses (GET /apps/installs/<id>/preflight) plus the install's
// current bindings, renders a select per role, and PUTs the change
// to /apps/installs/<id>/bindings on save. The server bounces the
// sidecar so OnMount picks up the new bindings.
//
// Shows a one-line success/error banner after save. "Required" roles
// can't be cleared (server 400s); the UI hides the "—" option for
// those.
function BindingsEditor({ installId }: { installId: number }) {
  const [roles, setRoles] = useState<any[] | null>(null);
  const [current, setCurrent] = useState<Record<string, any>>({});
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const refresh = () => {
    setStatus(null);
    fetch(`/api/apps/installs/${installId}/preflight`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => {
        setRoles(data.roles || []);
        setCurrent(data.current_bindings || {});
        setEdits({});
      })
      .catch((e) => setStatus({ kind: "err", msg: `Load failed: ${e.message}` }));
  };
  useEffect(refresh, [installId]);

  if (roles === null) return null;
  if (roles.length === 0) return null;

  // Selected value = pending edit (if any) || current binding || ""
  const selectedFor = (role: string): string => {
    if (role in edits) {
      const v = edits[role];
      return v === null ? "" : String(v);
    }
    const cur = current[role];
    return cur == null ? "" : String(cur);
  };
  const dirty = Object.keys(edits).length > 0;

  const onSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await apps.setBindings(installId, edits);
      if (res.respawned) {
        setStatus({ kind: "ok", msg: "Bindings updated. Sidecar respawned." });
      } else {
        setStatus({
          kind: "err",
          msg: `Bindings saved but respawn failed: ${res.respawn_err || "unknown"}`,
        });
      }
      // Re-load so current_bindings reflects the saved state.
      refresh();
    } catch (e: any) {
      setStatus({ kind: "err", msg: e.message || "save failed" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-text font-semibold text-base mb-1.5">Bindings</h3>
        <p className="text-text-dim text-sm leading-relaxed">
          Wire integrations and app dependencies. Saving bounces the sidecar so
          new bindings take effect on next boot.
        </p>
      </div>

      <div className="divide-y divide-border border border-border rounded-md">
        {roles.map((r: any) => {
          const cands = r.kind === "integration" ? r.integration_candidates || [] : r.app_candidates || [];
          return (
            <div key={r.role} className="px-4 py-4 space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text font-medium text-sm">{r.label || r.role}</span>
                {r.required ? (
                  <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-red/15 text-red">
                    required
                  </span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted">
                    optional
                  </span>
                )}
                {r.kind && (
                  <span className="text-[10px] uppercase tracking-wide font-mono px-1.5 py-0.5 rounded bg-bg-hover text-text-muted">
                    {r.kind}
                  </span>
                )}
              </div>
              {r.hint && (
                <p className="text-text-dim text-xs leading-relaxed">{r.hint}</p>
              )}
              <select
                className="w-full bg-bg-input border border-border rounded px-3 py-2 text-sm"
                value={selectedFor(r.role)}
                onChange={(ev) => {
                  const v = ev.target.value;
                  setEdits({ ...edits, [r.role]: v === "" ? null : Number(v) });
                }}
              >
                {!r.required && <option value="">— unbound —</option>}
                {cands.length === 0 && (
                  <option value="" disabled>
                    No compatible {r.kind === "integration" ? "connections" : "apps"} in this project
                  </option>
                )}
                {cands.map((c: any) =>
                  r.kind === "integration" ? (
                    <option key={c.connection_id} value={String(c.connection_id)}>
                      {c.name} ({c.app_slug})
                    </option>
                  ) : (
                    <option key={c.install_id} value={String(c.install_id)}>
                      {c.display_name || c.app_name}
                    </option>
                  ),
                )}
              </select>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="px-4 py-2 bg-accent text-bg rounded text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => setEdits({})}
            className="text-sm text-text-muted hover:text-text px-2 py-2"
          >
            Discard
          </button>
        )}
        {status && (
          <span
            className={`text-xs ${status.kind === "ok" ? "text-green" : "text-red"} ml-auto`}
          >
            {status.msg}
          </span>
        )}
      </div>
    </section>
  );
}


// ScopeButton — moves an installed app between project and global
// scope. Two visible states:
//
//   global       → "Move to project" (binds to currently-active project)
//   project      → "Move to global" (visible across every project)
//
// Click → confirmation modal listing what changes + reassurance that
// nothing gets deleted (data dir is keyed by install_id, integration
// bindings reference connection_id not project_id, etc. — see
// server/apps_scope.go for the full contract). Server validates the
// manifest scopes[] and refuses if another install already occupies
// the target slot.
//
// The button is hidden when there is no active project AND the
// install is already global (nowhere to move it to).
function ScopeButton({ install, onChanged }: { install: AppRow; onChanged?: () => void }) {
  const { currentProject } = useProjects();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const isGlobal = !install.project_id;
  const target = isGlobal ? (currentProject?.id ?? "") : "";
  const labelTarget = isGlobal
    ? (currentProject?.name ?? "current project")
    : "global";

  // Suppress when there is nowhere to move to (e.g. global install
  // and no project selected).
  if (isGlobal && !currentProject?.id) return null;

  const doFlip = async () => {
    setBusy(true);
    setErr("");
    try {
      await apps.setScope(install.install_id, target);
      setConfirming(false);
      onChanged?.();
    } catch (e: any) {
      setErr(e?.message || "scope change failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="flex-1 px-3 py-2 border border-border text-text rounded font-bold text-sm hover:bg-bg-hover"
        title={`Currently ${isGlobal ? "global" : "in project " + install.project_id}`}
      >
        Move to {labelTarget}
      </button>
      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            className="bg-bg border border-border rounded-lg shadow-xl max-w-md w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-text text-sm font-bold">
              Move {install.display_name || install.name} to {labelTarget}?
            </h3>
            <div className="text-xs text-text-muted leading-relaxed space-y-2">
              <p>
                This updates the install&rsquo;s scope and any connections it
                owns. The app&rsquo;s data, integration bindings, and runtime
                state are preserved — they&rsquo;re keyed by install id, not
                project.
              </p>
              <p>
                The sidecar will restart so it picks up the new scope. Brief
                interruption only.
              </p>
            </div>
            {err && <div className="text-red text-xs">{err}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="px-3 py-1.5 text-xs border border-border rounded hover:bg-bg-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doFlip}
                disabled={busy}
                className="px-3 py-1.5 text-xs bg-accent text-bg rounded font-bold hover:opacity-80 disabled:opacity-50"
              >
                {busy ? "Moving…" : `Move to ${labelTarget}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

