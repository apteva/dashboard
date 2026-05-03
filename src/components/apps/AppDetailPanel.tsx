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

import { useEffect, useMemo } from "react";
import type { AppRow, AppSurfaces, AppUIComponent, MarketplaceEntry } from "../../api";
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
        className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-bg-card border-l border-border z-50 flex flex-col shadow-xl"
        role="dialog"
        aria-label={`${view.display_name} details`}
      >
        {/* Header — pinned, always visible. */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border flex-shrink-0">
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

        {/* Body — scrolls. */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {view.description && (
            <section>
              <p className="text-text-dim text-sm leading-relaxed whitespace-pre-line">
                {view.description}
              </p>
            </section>
          )}

          {s && (
            <section>
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                Surfaces
              </h3>
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
                  <li key={t} className="text-text-dim">
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {s?.http_routes && s.http_routes.length > 0 && (
            <section>
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                HTTP routes
              </h3>
              <ul className="space-y-1 text-sm font-mono">
                {s.http_routes.map((r) => (
                  <li key={r} className="text-text-dim">
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {s?.channel_names && s.channel_names.length > 0 && (
            <section>
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                Channels
              </h3>
              <ul className="space-y-1 text-sm font-mono">
                {s.channel_names.map((c) => (
                  <li key={c} className="text-text-dim">
                    {c}
                  </li>
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

          {s?.required_apps && s.required_apps.length > 0 && (
            <section>
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                Dependencies
              </h3>
              <ul className="space-y-1.5 text-sm">
                {s.required_apps.map((d) => {
                  const status = d.installed
                    ? "installed"
                    : d.optional
                      ? "optional"
                      : "missing";
                  const cls = d.installed
                    ? "text-green"
                    : d.optional
                      ? "text-text-muted"
                      : "text-red";
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
                        {d.reason && (
                          <p className="text-text-dim text-xs mt-0.5">{d.reason}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {s.required_apps.some((d) => !d.installed && !d.optional) && (
                <p className="text-text-dim text-[11px] mt-2">
                  Missing required apps will be installed automatically alongside this one.
                </p>
              )}
            </section>
          )}

          {s?.permissions && s.permissions.length > 0 && (
            <section>
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                Permissions required
              </h3>
              <ul className="space-y-1 text-sm font-mono">
                {s.permissions.map((p) => (
                  <li key={p} className="text-amber-200">
                    {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Installed mode: live editable settings form. Read from
              GET /api/apps/installs/<id>/config which returns the schema
              + current values; saves via PUT to the same path. The
              read-only "Configuration" list (config_keys) only shows up
              for marketplace previews, where there's no install yet. */}
          {props.mode === "installed" && view.installId !== undefined ? (
            <SettingsSection installId={view.installId} />
          ) : (
            s?.config_keys && s.config_keys.length > 0 && (
              <section>
                <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                  Configuration
                </h3>
                <p className="text-text-dim text-xs mb-1">
                  Asks for these at install time:
                </p>
                <ul className="space-y-1 text-sm font-mono">
                  {s.config_keys.map((k) => (
                    <li key={k} className="text-text-dim">
                      {k}
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}

          {(view.tags && view.tags.length > 0) && (
            <section>
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                Tags
              </h3>
              <div className="flex flex-wrap gap-1">
                {view.tags.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}

          {(view.repo || view.manifestUrl) && (
            <section className="border-t border-border pt-4">
              <h3 className="text-text-muted text-xs uppercase tracking-wide mb-2">
                Links
              </h3>
              <ul className="space-y-1 text-sm">
                {view.repo && (
                  <li>
                    <a
                      href={view.repo}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Repository ↗
                    </a>
                  </li>
                )}
                {view.manifestUrl && (
                  <li>
                    <a
                      href={view.manifestUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Manifest ↗
                    </a>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>

        {/* Footer — primary actions. */}
        <div className="border-t border-border px-5 py-3 flex-shrink-0 flex gap-2">
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
          {props.mode === "installed" && (
            <button
              onClick={props.onUninstall}
              className="flex-1 px-3 py-2 border border-red text-red rounded font-bold text-sm hover:bg-red/10"
            >
              Uninstall
            </button>
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
