import { GuidedAppSetup } from "../components/apps/GuidedAppSetup";
import { RolePicker, requiredConfigFields, RequiredConfigFields, hasBindingSelection, addBindingSelection, multiBinding, type RoleIntent } from "../components/apps/SetupFields";
import { useState, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { useAssistantPageDetails } from "../components/chat/pageContext";
import { Link } from "react-router-dom";
import { AppIcon as SharedAppIcon } from "@apteva/ui-kit";
import {
  apps,
  integrations,
  type AppRow,
  type AppPreview,
  type AppPreflight,
  type AppManifestV2,
  type MarketplaceEntry,
  type PreflightRole,
  type PreflightConnectionCandidate,
  type PreflightAppCandidate,
  type AppBindingValue,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { Modal } from "../components/Modal";
import { AppSurfaceBadges } from "../components/apps/AppSurfaceBadges";
import { AppDetailPanel } from "../components/apps/AppDetailPanel";
import { AppStatusAction } from "../components/apps/AppStatusAction";

type Tab = "installed" | "marketplace";
const MARKETPLACE_PAGE_SIZE = 24;

export function marketplaceCategoryNames(
  categoryCounts: Record<string, number>,
): string[] {
  return Object.keys(categoryCounts).sort(
    (a, b) => categoryCounts[b] - categoryCounts[a] || a.localeCompare(b),
  );
}

export function resolveMarketplaceCategory(
  current: string,
  categoryCounts: Record<string, number>,
): string {
  const categories = marketplaceCategoryNames(categoryCounts);
  if (current === "" || current === "all") return "";
  return categories.includes(current) ? current : "";
}

// /api/apps also carries integration components for chat discovery. Those
// rows have no installation and must never enter app management flows.
export function isManagedAppInstall(app: AppRow): boolean {
  return app.source !== "integration" && app.install_id > 0;
}

export function appHasUpdate(app: AppRow): boolean {
  return (
    isManagedAppInstall(app)
    && app.status !== "pending"
    && !app.deprecated
    && !!app.available_version
    && !!app.version
    && app.available_version !== app.version
  );
}

export function projectAppsWithUpdates(
  rows: AppRow[],
  projectId?: string,
): AppRow[] {
  if (!projectId) return [];
  return rows.filter((app) => app.project_id === projectId && appHasUpdate(app));
}

type AppUpgradeRunner = (
  installId: number,
  opts?: { approveNewPermissions?: boolean },
) => Promise<unknown>;

export type AppBatchUpgradeResult = {
  updated: AppRow[];
  permissions: Array<{ app: AppRow; prompt: UpgradePermissionPrompt }>;
  failed: Array<{ app: AppRow; message: string }>;
};

export async function upgradeAppsSequentially(
  targets: AppRow[],
  upgrade: AppUpgradeRunner,
  options?: {
    approveNewPermissions?: boolean;
    onProgress?: (app: AppRow, completed: number, total: number) => void;
  },
): Promise<AppBatchUpgradeResult> {
  targets = targets.filter(isManagedAppInstall);
  const result: AppBatchUpgradeResult = {
    updated: [],
    permissions: [],
    failed: [],
  };

  for (let index = 0; index < targets.length; index += 1) {
    const app = targets[index];
    options?.onProgress?.(app, index, targets.length);
    try {
      await upgrade(app.install_id, {
        approveNewPermissions: options?.approveNewPermissions,
      });
      result.updated.push(app);
    } catch (error: any) {
      const prompt = options?.approveNewPermissions
        ? null
        : upgradePermissionPromptFromError(error);
      if (prompt) {
        result.permissions.push({ app, prompt });
      } else {
        result.failed.push({
          app,
          message: error?.message || "Update failed",
        });
      }
    }
    options?.onProgress?.(app, index + 1, targets.length);
  }

  return result;
}

// AppIcon — renders the manifest icon, falls back to a single-letter
// avatar when the URL is missing or 404s. Both the marketplace card
// and the installed-app card share this so we don't end up with the
// browser's default broken-image glyph.
function AppIcon({
  url,
  name,
  iconStyle,
}: {
  url?: string;
  name: string;
  iconStyle?: "image" | "monochrome";
}) {
  return (
    <SharedAppIcon
      src={url}
      iconStyle={iconStyle}
      name={name}
      size="md"
      className="text-accent"
    />
  );
}

// The Apps tab — sidecar-based v2 Apps. Lists every install visible
// to the current project (own installs + globals), shows surfaces +
// status, and lets the user install a new one from an Apteva manifest or
// Agent Plugins 1.0.0 package URL.
//
// Marketplace + permission consent UI are next iteration; for now the
// install flow is "paste an app URL, fill config, click Install".
export function Apps() {
  const { currentProject } = useProjects();
  const [tab, setTab] = useState<Tab>("installed");
  usePageTitle(["Apps", tab === "marketplace" ? "Marketplace" : "Installed"]);
  const [rows, setRows] = useState<AppRow[]>([]);
  const installedRows = useMemo(() => rows.filter(isManagedAppInstall), [rows]);
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  const [marketplaceTotal, setMarketplaceTotal] = useState(0);
  const [marketplaceCategories, setMarketplaceCategories] = useState<Record<string, number>>({});
  const [installedSearch, setInstalledSearch] = useState("");
  const [marketplaceSearch, setMarketplaceSearch] = useState("");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceCategory, setMarketplaceCategory] = useState<string>("");
  const [marketplacePage, setMarketplacePage] = useState(1);
  const [registryURL, setRegistryURL] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installModal, setInstallModal] = useState<{ manifestUrl?: string } | null>(null);
  const [updateAllOpen, setUpdateAllOpen] = useState(false);
  const [updateAllStage, setUpdateAllStage] = useState<"confirm" | "queueing" | "permissions" | "done">("confirm");
  const [updateAllTargets, setUpdateAllTargets] = useState<AppRow[]>([]);
  const [updateAllCurrent, setUpdateAllCurrent] = useState("");
  const [updateAllCompleted, setUpdateAllCompleted] = useState(0);
  const [updateAllUpdated, setUpdateAllUpdated] = useState<AppRow[]>([]);
  const [updateAllPermissions, setUpdateAllPermissions] = useState<AppBatchUpgradeResult["permissions"]>([]);
  const [updateAllFailures, setUpdateAllFailures] = useState<AppBatchUpgradeResult["failed"]>([]);
  // Side-panel state — single component, two contexts (a marketplace
  // entry vs. an installed app row). Only one is non-null at a time.
  const [detailEntry, setDetailEntry] = useState<MarketplaceEntry | null>(null);
  const [detailInstall, setDetailInstall] = useState<AppRow | null>(null);
  const contextInstall = detailInstall && (!detailInstall.project_id || detailInstall.project_id === currentProject?.id) ? detailInstall : null;
  useAssistantPageDetails(currentProject?.id || "", { app: contextInstall?.name || detailEntry?.name, installation_id: contextInstall?.install_id });

  const refreshInstalled = (showLoading = true) => {
    if (showLoading) setLoading(true);
    apps
      .list(currentProject?.id)
      .then((rows) => {
        // Detect status flips to running so we can ping the Layout
        // sidebar to refresh — a freshly-running app may have a
        // project.page panel that should appear in the nav now.
        // Cheap to fire on every refresh; Layout debounces via
        // refreshAppNav's natural single-fetch behaviour.
        setRows((prev) => {
          const wasRunning = new Set(prev.filter((r) => r.status === "running").map((r) => r.install_id));
          const nowRunning = rows.filter((r) => r.status === "running").map((r) => r.install_id);
          const changed = nowRunning.some((id) => !wasRunning.has(id))
            || nowRunning.length !== wasRunning.size;
          if (changed) window.dispatchEvent(new CustomEvent("apteva:apps-changed"));
          return rows;
        });
      })
      .catch((e) => setError(e.message || "failed"))
      .finally(() => {
        if (showLoading) setLoading(false);
      });
  };

  const refreshMarketplace = () => {
    setLoading(true);
    apps
      .marketplace(currentProject?.id, undefined, {
        query: marketplaceQuery,
        category: marketplaceCategory,
        page: marketplacePage,
        pageSize: MARKETPLACE_PAGE_SIZE,
      })
      .then((r) => {
        setMarketplace(r.apps);
        setMarketplaceTotal(r.total ?? r.apps.length);
        setMarketplaceCategories(r.categories || {});
        setRegistryURL(r.registry_url);
      })
      .catch((e) => setError(e.message || "failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = window.setTimeout(() => {
      setMarketplaceQuery(marketplaceSearch.trim());
      setMarketplacePage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [marketplaceSearch]);

  // Initial load + reload when tab or project changes. The cancelled
  // flag prevents the older fetch's response from overwriting state
  // when the user flips tabs or switches project mid-flight.
  useEffect(() => {
    let cancelled = false;
    let selectingCategory = false;
    setLoading(true);
    const run = async () => {
      try {
        if (tab === "installed") {
          const next = await apps.list(currentProject?.id);
          if (cancelled) return;
          setRows((prev) => {
            const wasRunning = new Set(prev.filter((r) => r.status === "running").map((r) => r.install_id));
            const nowRunning = next.filter((r) => r.status === "running").map((r) => r.install_id);
            const changed = nowRunning.some((id) => !wasRunning.has(id))
              || nowRunning.length !== wasRunning.size;
            if (changed) window.dispatchEvent(new CustomEvent("apteva:apps-changed"));
            return next;
          });
        } else {
          const r = await apps.marketplace(currentProject?.id, undefined, {
            query: marketplaceQuery,
            category: marketplaceCategory,
            page: marketplacePage,
            pageSize: MARKETPLACE_PAGE_SIZE,
          });
          if (cancelled) return;
          const categoryCounts = r.categories || {};
          const resolvedCategory = resolveMarketplaceCategory(
            marketplaceCategory,
            categoryCounts,
          );
          setMarketplaceCategories(categoryCounts);
          if (resolvedCategory !== marketplaceCategory) {
            selectingCategory = true;
            setMarketplaceCategory(resolvedCategory);
            setMarketplacePage(1);
            return;
          }
          setMarketplace(r.apps);
          setMarketplaceTotal(r.total ?? r.apps.length);
          setRegistryURL(r.registry_url);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "failed");
      } finally {
        if (!cancelled && !selectingCategory) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [tab, currentProject?.id, marketplaceQuery, marketplaceCategory, marketplacePage]);

  // While any install is mid-build, poll every second so the dashboard
  // shows the live phase string ("Cloning…", "Building…", "Starting…")
  // and flips to running/error without a manual refresh.
  //
  // Pins to the projectId in scope at effect-run time. If the user
  // switches projects mid-poll, the cancelled flag stops the in-flight
  // setState; the new effect run starts polling against the new
  // project's pending installs from scratch.
  useEffect(() => {
    if (tab !== "installed") return;
    const anyPending = installedRows.some((r) => r.status === "pending");
    if (!anyPending) return;
    let cancelled = false;
    const projectId = currentProject?.id;
    const id = setInterval(() => {
      apps.list(projectId).then((next) => {
        if (cancelled) return;
        setRows((prev) => {
          const wasRunning = new Set(prev.filter((r) => r.status === "running").map((r) => r.install_id));
          const nowRunning = next.filter((r) => r.status === "running").map((r) => r.install_id);
          if (nowRunning.some((id) => !wasRunning.has(id)) || nowRunning.length !== wasRunning.size) {
            window.dispatchEvent(new CustomEvent("apteva:apps-changed"));
          }
          return next;
        });
      }).catch(() => {});
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tab, installedRows, currentProject?.id]);

  // Keep the installed-app side panel bound to the freshest row. List
  // polling updates `rows`, but the panel stores the row object that was
  // clicked; without this, an upgrade can finish in the list while the
  // open panel still shows the old version until a full page reload.
  useEffect(() => {
    if (!detailInstall) return;
    const fresh = installedRows.find((r) => r.install_id === detailInstall.install_id);
    if (fresh !== detailInstall) {
      setDetailInstall(fresh ?? null);
    }
  }, [installedRows, detailInstall]);

  const filteredInstalled = useMemo(
    () => filterInstalledApps(installedRows, installedSearch),
    [installedRows, installedSearch],
  );
  const projectUpdates = useMemo(
    () => projectAppsWithUpdates(installedRows, currentProject?.id),
    [installedRows, currentProject?.id],
  );

  const openUpdateAll = () => {
    if (projectUpdates.length === 0) return;
    setUpdateAllTargets(projectUpdates);
    setUpdateAllStage("confirm");
    setUpdateAllCurrent("");
    setUpdateAllCompleted(0);
    setUpdateAllUpdated([]);
    setUpdateAllPermissions([]);
    setUpdateAllFailures([]);
    setUpdateAllOpen(true);
  };

  const runUpdateAll = async () => {
    if (updateAllTargets.length === 0) return;
    setUpdateAllStage("queueing");
    setUpdateAllCompleted(0);
    const result = await upgradeAppsSequentially(
      updateAllTargets,
      apps.upgrade,
      {
        onProgress: (app, completed) => {
          setUpdateAllCurrent(app.display_name);
          setUpdateAllCompleted(completed);
        },
      },
    );
    setUpdateAllUpdated(result.updated);
    setUpdateAllPermissions(result.permissions);
    setUpdateAllFailures(result.failed);
    setUpdateAllStage(result.permissions.length > 0 ? "permissions" : "done");
    refreshInstalled(false);
  };

  const approveUpdateAllPermissions = async () => {
    const approvalTargets = updateAllPermissions.map(({ app }) => app);
    if (approvalTargets.length === 0) return;
    setUpdateAllTargets(approvalTargets);
    setUpdateAllStage("queueing");
    setUpdateAllCompleted(0);
    const result = await upgradeAppsSequentially(
      approvalTargets,
      apps.upgrade,
      {
        approveNewPermissions: true,
        onProgress: (app, completed) => {
          setUpdateAllCurrent(app.display_name);
          setUpdateAllCompleted(completed);
        },
      },
    );
    setUpdateAllUpdated((current) => [...current, ...result.updated]);
    setUpdateAllFailures((current) => [...current, ...result.failed]);
    setUpdateAllPermissions([]);
    setUpdateAllStage("done");
    refreshInstalled(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 sm:px-6 sm:py-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-text text-base font-bold">Apps</h2>
          <p className="text-text-muted text-sm mt-1">
            Apteva Apps run as sidecar services and contribute MCP tools,
            HTTP routes, channels, and UI surfaces.
          </p>
        </div>
        <button
          onClick={() => setInstallModal({})}
          className="touch-target px-3 py-1.5 text-xs sm:text-sm bg-accent text-bg rounded-lg font-bold hover:opacity-80 flex-shrink-0"
        >
          <span className="sm:hidden">+ Install</span><span className="hidden sm:inline">+ Install from URL</span>
        </button>
      </div>

      <div className="border-b border-border flex max-w-full gap-0 overflow-x-auto px-4 sm:px-6">
        {(["installed", "marketplace"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`touch-target shrink-0 whitespace-nowrap px-3 py-2 text-xs capitalize transition-colors ${
              tab === t ? "text-accent border-b border-accent -mb-px" : "text-text-muted hover:text-text"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="page-safe-bottom flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {error && <div className="text-red text-sm">{error}</div>}

      {tab === "installed" ? (
        loading ? (
          <div className="text-text-dim text-sm">Loading…</div>
        ) : installedRows.length === 0 ? (
          <div className="border border-border rounded-lg p-8 text-center max-w-2xl mx-auto">
            <p className="text-text-muted text-sm">No apps installed yet.</p>
            <p className="text-text-dim text-xs mt-1">
              Browse the <button onClick={() => setTab("marketplace")} className="text-accent hover:underline">Marketplace</button> tab or click <span className="text-accent">+ Install from URL</span>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-card p-2 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1 sm:max-w-xl">
                <span className="sr-only">Search installed apps</span>
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                >
                  <circle cx="8.5" cy="8.5" r="5" />
                  <path d="m12.25 12.25 4 4" />
                </svg>
                <input
                  type="text"
                  inputMode="search"
                  value={installedSearch}
                  onChange={(e) => setInstalledSearch(e.target.value)}
                  placeholder="Search installed apps…"
                  className="h-10 w-full rounded-md border border-border bg-bg-input pl-9 pr-9 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent"
                />
                {installedSearch && (
                  <button
                    type="button"
                    onClick={() => setInstalledSearch("")}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-sm text-text-dim hover:bg-bg-hover hover:text-text"
                    aria-label="Clear installed app search"
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </label>
              <span className="px-1 text-[11px] tabular-nums text-text-dim sm:ml-auto sm:shrink-0">
                {installedSearch.trim() ? `${filteredInstalled.length} of ${installedRows.length}` : `${installedRows.length}`} installed
              </span>
              <button
                type="button"
                onClick={openUpdateAll}
                disabled={projectUpdates.length === 0}
                className="min-h-10 shrink-0 rounded border border-yellow/60 px-3 py-1.5 text-xs font-medium leading-5 text-yellow transition-colors hover:bg-yellow/10 disabled:border-border disabled:text-text-dim disabled:opacity-70 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px]"
                title={
                  projectUpdates.length > 0
                    ? `Update ${projectUpdates.length} app${projectUpdates.length === 1 ? "" : "s"} installed in ${currentProject?.name || "this project"}`
                    : "All project apps are up to date"
                }
              >
                {projectUpdates.length > 0
                  ? `Update all (${projectUpdates.length})`
                  : "All up to date"}
              </button>
            </div>

            {filteredInstalled.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm text-text-muted">No installed apps match “{installedSearch.trim()}”.</p>
                <button
                  type="button"
                  onClick={() => setInstalledSearch("")}
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              // Installed apps are inventory, not pitch decks — render
              // as compact rows (status-led, actionable) rather than the
              // marketing cards we use on the Marketplace tab.
              <div className="space-y-2 md:space-y-0 md:overflow-visible md:rounded-lg md:border md:border-border md:divide-y md:divide-border">
                {filteredInstalled.map((r) => (
                  <AppListRow
                    key={r.install_id}
                    app={r}
                    onChange={refreshInstalled}
                    onOpenDetails={() => setDetailInstall(r)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <MarketplaceView
          entries={marketplace}
          total={marketplaceTotal}
          page={marketplacePage}
          pageSize={MARKETPLACE_PAGE_SIZE}
          query={marketplaceSearch}
          category={marketplaceCategory}
          categories={marketplaceCategories}
          registryURL={registryURL}
          loading={loading}
          onQueryChange={setMarketplaceSearch}
          onCategoryChange={(next) => {
            setMarketplaceCategory(next);
            setMarketplacePage(1);
          }}
          onPageChange={setMarketplacePage}
          onInstall={(e) => setInstallModal({ manifestUrl: e.manifest_url })}
          onOpenDetails={(e) => setDetailEntry(e)}
        />
      )}

      </div>

      <InstallModal
        open={installModal !== null}
        initialManifestUrl={installModal?.manifestUrl}
        onClose={() => setInstallModal(null)}
        projectId={currentProject?.id}
        onInstalled={() => {
          // Switch to Installed so the user sees the row appear in
          // pending state with live status_message ("Cloning…",
          // "Downloading dependencies…", "Linking…") instead of
          // staring at a Marketplace card that just flipped to
          // "Installed". The poll loop on the Installed tab does the
          // rest.
          setInstallModal(null);
          setTab("installed");
          refreshInstalled();
        }}
      />

      <UpdateAllAppsModal
        open={updateAllOpen}
        projectName={currentProject?.name || "this project"}
        stage={updateAllStage}
        targets={updateAllTargets}
        currentApp={updateAllCurrent}
        completed={updateAllCompleted}
        updated={updateAllUpdated}
        permissions={updateAllPermissions}
        failures={updateAllFailures}
        onClose={() => {
          if (updateAllStage !== "queueing") setUpdateAllOpen(false);
        }}
        onStart={() => void runUpdateAll()}
        onApprovePermissions={() => void approveUpdateAllPermissions()}
        onSkipPermissions={() => setUpdateAllStage("done")}
      />

      <AppDetailPanel
        open={detailEntry !== null}
        mode="marketplace"
        entry={detailEntry ?? undefined}
        onClose={() => setDetailEntry(null)}
        onInstall={() => {
          if (!detailEntry) return;
          setInstallModal({ manifestUrl: detailEntry.manifest_url });
          setDetailEntry(null);
        }}
      />
      <AppDetailPanel
        open={detailInstall !== null}
        mode="installed"
        install={detailInstall ?? undefined}
        onClose={() => setDetailInstall(null)}
        onUninstall={async () => {
          if (!detailInstall || !isManagedAppInstall(detailInstall)) return;
          if (!confirm(`Uninstall ${detailInstall.display_name || detailInstall.name}?`)) return;
          try {
            await apps.uninstall(detailInstall.install_id);
            setDetailInstall(null);
            refreshInstalled();
          } catch (e: any) {
            alert(e.message || "uninstall failed");
          }
        }}
        onScopeChanged={() => {
          // Scope flip succeeded — close the panel (the row's
          // project_id just changed, so re-opening it would show
          // the post-flip state anyway) and refetch the list so
          // the global/project section assignment is correct.
          setDetailInstall(null);
          refreshInstalled();
        }}
        onStatusChanged={(status) => {
          setDetailInstall((current) => current ? { ...current, status } : current);
          refreshInstalled(false);
        }}
        onAgentDefaultChanged={(enabled) => {
          setDetailInstall((current) => current
            ? { ...current, default_for_new_agents: enabled }
            : current);
          refreshInstalled();
        }}
      />
    </div>
  );
}

// Keep these search tiers aligned with marketplaceSearchScore in the server.
// A substring still matches, but a name word outranks a tag or description.
function appSearchMatchStrength(value: string | undefined, term: string): number {
  if (!value) return 0;
  const text = value.toLocaleLowerCase();
  if (text === term) return 5;
  if (text.startsWith(term)) return 4;
  const words = text.split(/[^\p{L}\p{N}]+/u);
  if (words.includes(term)) return 3;
  if (words.some((word) => word.startsWith(term))) return 2;
  return text.includes(term) ? 1 : 0;
}

function installedAppSearchScore(app: AppRow, query: string, terms: string[]): number {
  const name = app.name.toLocaleLowerCase();
  const displayName = (app.display_name || "").toLocaleLowerCase();
  let score = name === query ? 1_000_000
    : displayName === query ? 900_000
    : name.startsWith(query) ? 10_000
    : displayName.startsWith(query) ? 9_000
    : 0;

  const metadata = [
    app.status,
    app.status_message,
    app.error_message,
    app.source,
    app.version,
    app.available_version,
    app.project_id ? "project" : "global",
    ...(app.permissions || []),
  ];
  for (const term of terms) {
    let best = Math.max(
      120 * appSearchMatchStrength(app.name, term),
      120 * appSearchMatchStrength(app.display_name, term),
      20 * appSearchMatchStrength(app.description, term),
    );
    for (const value of metadata) {
      best = Math.max(best, 10 * appSearchMatchStrength(value, term));
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

export function filterInstalledApps(rows: AppRow[], query: string): AppRow[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const installed = rows.filter(isManagedAppInstall);
  if (terms.length === 0) return installed;

  const normalizedQuery = terms.join(" ");
  return installed
    .map((app, index) => ({ app, index, score: installedAppSearchScore(app, normalizedQuery, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ app }) => app);
}

export function MarketplaceView({
  entries,
  total,
  page,
  pageSize,
  query,
  category,
  categories: categoryCounts,
  registryURL,
  loading,
  onQueryChange,
  onCategoryChange,
  onPageChange,
  onInstall,
  onOpenDetails,
}: {
  entries: MarketplaceEntry[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  category: string;
  categories: Record<string, number>;
  registryURL: string;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: string) => void;
  onPageChange: (page: number) => void;
  onInstall: (e: MarketplaceEntry) => void;
  onOpenDetails: (e: MarketplaceEntry) => void;
}) {
  const hasFilters = query.trim() !== "" || category !== "";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(total, (page - 1) * pageSize + entries.length);

  if (loading && entries.length === 0) return <div className="text-text-dim text-sm">Loading marketplace…</div>;
  if (!loading && total === 0 && !hasFilters) {
    return (
      <div className="border border-border rounded-lg p-8 text-center max-w-2xl mx-auto">
        <p className="text-text-muted text-sm">Marketplace is empty.</p>
        <p className="text-text-dim text-xs mt-1">Configured registry: <span className="font-mono">{registryURL}</span></p>
      </div>
    );
  }

  const categories = marketplaceCategoryNames(categoryCounts);

  return (
    <div className="space-y-5">
      {/* Search + category chips */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search apps…"
          className="bg-bg-input border border-border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px] max-w-md"
        />
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            label="all"
            count={Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}
            active={category === ""}
            onClick={() => onCategoryChange("")}
          />
          {categories.map((c) => (
            <CategoryChip
              key={c}
              label={c}
              count={categoryCounts[c]}
              active={category === c}
              onClick={() => onCategoryChange(c)}
            />
          ))}
        </div>
      </div>

      {/* Result grid */}
      {entries.length === 0 ? (
        <div className="text-text-muted text-sm text-center py-12">
          No apps match. Try a different search or category.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {entries.map((e) => (
            <MarketplaceCard
              key={e.name}
              entry={e}
              onInstall={() => onInstall(e)}
              onOpenDetails={() => onOpenDetails(e)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-dim text-[10px]">
          Registry: <span className="font-mono">{registryURL}</span>
          {" · "}
          {pageStart}-{pageEnd} of {total} apps
          {loading ? " · refreshing…" : ""}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1 || loading}
              className="px-2.5 py-1 text-xs border border-border rounded text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-text-dim text-xs">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages || loading}
              className="px-2.5 py-1 text-xs border border-border rounded text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// CategoryChip — the small toggle pills above the grid. Single-line,
// click flips it active. Mirrors how WP, the Notion gallery, and most
// app marketplaces handle category filtering.
function CategoryChip({
  label, count, active, onClick,
}: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-full border transition-colors capitalize ${
        active
          ? "bg-accent text-bg border-accent"
          : "border-border text-text-muted hover:text-text hover:border-accent/40"
      }`}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );
}

function MarketplaceCard({
  entry, onInstall, onOpenDetails,
}: {
  entry: MarketplaceEntry;
  onInstall: () => void;
  onOpenDetails: () => void;
}) {
  // Vertical "tile" card: icon + name on top, badges, description,
  // surfaces + tags, install button at the bottom. Same shape as
  // WordPress plugins / VSCode marketplace cards.
  const topTags = (entry.tags || []).slice(0, 3);
  return (
    <div
      className="border border-border rounded-lg p-4 flex flex-col gap-2 cursor-pointer hover:border-accent/60 transition-colors min-h-[260px]"
      onClick={onOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <BigAppIcon url={entry.icon} name={entry.display_name} iconStyle={entry.icon_style} />
        <div className="flex-1 min-w-0">
          <div className="text-text font-medium truncate">{entry.display_name}</div>
          <div className="text-text-dim text-[11px] mt-0.5 truncate">
            v{entry.version}{entry.author ? ` · ${entry.author}` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {entry.category && (
          <Pill className="bg-accent/10 text-accent capitalize">{entry.category}</Pill>
        )}
        {entry.official && <Pill className="bg-blue/15 text-blue">official</Pill>}
        {entry.builtin && <Pill className="bg-blue/15 text-blue">built-in</Pill>}
        {entry.deprecated && <Pill className="bg-red/15 text-red">deprecated</Pill>}
        {entry.installed && !entry.builtin && <Pill className="bg-green/15 text-green">installed</Pill>}
      </div>
      {entry.deprecated && (
        <p className="text-red text-[11px] leading-snug">
          {entry.deprecation || "This app is deprecated and can no longer be installed."}
        </p>
      )}
      <p className="text-text-muted text-xs line-clamp-3 flex-1">{entry.description}</p>
      <AppSurfaceBadges surfaces={entry.surfaces} className="!gap-1" />
      {topTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {topTags.map((t) => (
            <span key={t} className="text-[10px] text-text-dim">#{t}</span>
          ))}
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onInstall(); }}
        disabled={entry.installed || entry.deprecated}
        title={
          entry.deprecated
            ? entry.deprecation || "Deprecated"
            : entry.builtin
              ? "Bundled into apteva-server — always available"
              : ""
        }
        className="mt-auto w-full px-3 py-1.5 border border-accent rounded text-xs text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {entry.builtin ? "Built-in" : entry.installed ? "Installed" : entry.deprecated ? "Deprecated" : "Install"}
      </button>
    </div>
  );
}

// BigAppIcon — 48px tile icon for the marketplace + installed grids.
// Falls back to a single-letter avatar so missing icons don't leave
// holes (handful of registry entries don't ship icon.png).
function BigAppIcon({
  url,
  name,
  iconStyle,
}: {
  url?: string;
  name: string;
  iconStyle?: "image" | "monochrome";
}) {
  return (
    <SharedAppIcon
      src={url}
      iconStyle={iconStyle}
      name={name}
      size="lg"
      className="text-accent"
    />
  );
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${className || "bg-border text-text-muted"}`}>
      {children}
    </span>
  );
}

type UpgradePermissionPrompt = {
  version?: string;
  message?: string;
  missingPermissions: string[];
};

function upgradePermissionPromptFromError(e: any): UpgradePermissionPrompt | null {
  const body = e?.body;
  const missing = body?.missing_permissions;
  if (e?.status !== 409 || !Array.isArray(missing) || missing.length === 0) {
    return null;
  }
  return {
    version: typeof body.version === "string" ? body.version : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    missingPermissions: missing.filter((p: unknown) => typeof p === "string"),
  };
}

function UpgradePermissionModal({
  appName,
  prompt,
  busy,
  onCancel,
  onConfirm,
}: {
  appName: string;
  prompt: UpgradePermissionPrompt | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={!!prompt} onClose={busy ? () => {} : onCancel} width="max-w-lg">
      <div className="p-4 border-b border-border">
        <div className="text-text font-semibold">New permissions required</div>
        <div className="text-text-muted text-xs mt-1">
          Updating {appName}{prompt?.version ? ` to v${prompt.version}` : ""} will add these platform permissions.
        </div>
      </div>
      <div className="p-4 space-y-3">
        <ul className="space-y-1.5">
          {(prompt?.missingPermissions || []).map((p) => (
            <li key={p} className="flex items-center gap-2 text-xs text-text">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow shrink-0" />
              <span className="font-mono break-all">{p}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          If you continue, Apteva will approve these permissions for this installed app and run the upgrade normally.
        </p>
      </div>
      <div className="p-4 border-t border-border flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 border border-border rounded text-xs text-text-muted hover:text-text disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="px-3 py-1.5 border border-yellow rounded text-xs text-yellow hover:bg-yellow/10 disabled:opacity-50"
        >
          {busy ? "Updating…" : "Approve and update"}
        </button>
      </div>
    </Modal>
  );
}

function UpdateAllAppsModal({
  open,
  projectName,
  stage,
  targets,
  currentApp,
  completed,
  updated,
  permissions,
  failures,
  onClose,
  onStart,
  onApprovePermissions,
  onSkipPermissions,
}: {
  open: boolean;
  projectName: string;
  stage: "confirm" | "queueing" | "permissions" | "done";
  targets: AppRow[];
  currentApp: string;
  completed: number;
  updated: AppRow[];
  permissions: AppBatchUpgradeResult["permissions"];
  failures: AppBatchUpgradeResult["failed"];
  onClose: () => void;
  onStart: () => void;
  onApprovePermissions: () => void;
  onSkipPermissions: () => void;
}) {
  const progress = targets.length === 0
    ? 0
    : Math.min(100, Math.round((completed / targets.length) * 100));

  return (
    <Modal
      open={open}
      onClose={stage === "queueing" ? () => {} : onClose}
      width="max-w-xl"
      ariaLabel="Update all project apps"
    >
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="text-sm font-semibold text-text">
          {stage === "confirm" && `Update ${targets.length} project app${targets.length === 1 ? "" : "s"}`}
          {stage === "queueing" && "Scheduling app updates"}
          {stage === "permissions" && "Review new permissions"}
          {stage === "done" && "Project app updates scheduled"}
        </div>
        <div className="mt-1 text-xs text-text-muted">
          {projectName}
        </div>
      </div>

      {stage === "confirm" && (
        <>
          <div className="max-h-[min(52vh,380px)] overflow-y-auto p-4 sm:p-5">
            <p className="text-xs leading-relaxed text-text-muted">
              This updates only apps installed directly in this project. Shared global apps are not changed.
              Source apps may restart and will build one at a time.
            </p>
            <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {targets.map((app) => (
                <div key={app.install_id} className="flex items-center gap-3 bg-bg px-3 py-2.5">
                  <AppIcon url={app.icon} name={app.display_name} iconStyle={app.icon_style} />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{app.display_name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-dim">
                    v{app.version} <span className="text-yellow">→ v{app.available_version}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 rounded border border-border px-3 py-1.5 text-xs leading-5 text-text-muted hover:text-text sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onStart}
              className="min-h-10 rounded border border-yellow bg-yellow/10 px-3 py-1.5 text-xs font-semibold leading-5 text-yellow hover:bg-yellow/15 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px]"
            >
              Update all
            </button>
          </div>
        </>
      )}

      {stage === "queueing" && (
        <div className="p-5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-text">
              {currentApp ? `Scheduling ${currentApp}` : "Preparing updates…"}
            </span>
            <span className="shrink-0 tabular-nums text-text-dim">
              {completed} / {targets.length}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-yellow transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-[11px] text-text-dim">
            Keep this dialog open while Apteva checks each installed app.
          </p>
        </div>
      )}

      {stage === "permissions" && (
        <>
          <div className="max-h-[min(56vh,420px)] overflow-y-auto p-4 sm:p-5">
            <p className="text-xs leading-relaxed text-text-muted">
              {permissions.length} app{permissions.length === 1 ? "" : "s"} request additional platform access.
              Review the exact permissions before continuing; the other updates have already been scheduled.
            </p>
            <div className="mt-4 space-y-2">
              {permissions.map(({ app, prompt }) => (
                <div key={app.install_id} className="rounded-lg border border-yellow/40 bg-yellow/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text">{app.display_name}</span>
                    {prompt.version && (
                      <span className="shrink-0 text-[11px] text-yellow">v{prompt.version}</span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {prompt.missingPermissions.map((permission) => (
                      <li key={permission} className="flex items-start gap-2 text-[11px] text-text-muted">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow" />
                        <span className="break-all font-mono">{permission}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onSkipPermissions}
              className="min-h-10 rounded border border-border px-3 py-1.5 text-xs leading-5 text-text-muted hover:text-text sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px]"
            >
              Skip these apps
            </button>
            <button
              type="button"
              onClick={onApprovePermissions}
              className="min-h-10 rounded border border-yellow bg-yellow/10 px-3 py-1.5 text-xs font-semibold leading-5 text-yellow hover:bg-yellow/15 sm:min-h-0 sm:px-2.5 sm:py-1 sm:text-[11px]"
            >
              Approve and update {permissions.length}
            </button>
          </div>
        </>
      )}

      {stage === "done" && (
        <>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-green/30 bg-green/5 p-3">
                <div className="text-lg font-semibold tabular-nums text-green">{updated.length}</div>
                <div className="mt-0.5 text-[11px] text-text-muted">scheduled</div>
              </div>
              <div className={`rounded-lg border p-3 ${failures.length > 0 ? "border-red/30 bg-red/5" : "border-border bg-bg"}`}>
                <div className={`text-lg font-semibold tabular-nums ${failures.length > 0 ? "text-red" : "text-text-dim"}`}>
                  {failures.length}
                </div>
                <div className="mt-0.5 text-[11px] text-text-muted">failed</div>
              </div>
            </div>
            {permissions.length > 0 && (
              <p className="rounded-lg border border-yellow/30 bg-yellow/5 px-3 py-2 text-xs text-yellow">
                {permissions.length} app{permissions.length === 1 ? " was" : "s were"} skipped because new permissions were not approved.
              </p>
            )}
            {failures.length > 0 && (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {failures.map(({ app, message }) => (
                  <div key={app.install_id} className="rounded border border-red/30 bg-red/5 px-3 py-2">
                    <div className="text-xs font-medium text-text">{app.display_name}</div>
                    <div className="mt-0.5 text-[11px] text-red">{message}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-text-dim">
              Source app builds continue in the background. Their rows will show queued, building, and running states.
            </p>
          </div>
          <div className="flex justify-end border-t border-border p-4">
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 rounded bg-accent px-4 py-1.5 text-xs font-semibold leading-5 text-bg hover:opacity-90 sm:min-h-0 sm:px-3 sm:py-1 sm:text-[11px]"
            >
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// AppListRow — compact horizontal row for the Installed tab.
// Different mental model from MarketplaceCard: operators are doing
// inventory + lifecycle management here, not browsing. So we lead
// with the status dot, keep the description compressed to a single
// line (or replaced inline with status_message / error_message
// while pending or errored), and surface every applicable action as
// a button on the right.
//
// Lifecycle actions live in the menu; status changes use the same control
// as app cards and the detail panel.
function AppListRow({
  app, onChange, onOpenDetails,
}: {
  app: AppRow;
  onChange: () => void;
  onOpenDetails: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [permissionPrompt, setPermissionPrompt] = useState<UpgradePermissionPrompt | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await apps.uninstall(app.install_id);
      onChange();
    } finally {
      setBusy(false);
    }
  };
  const upgrade = async (approveNewPermissions = false) => {
    setBusy(true);
    try {
      await apps.upgrade(app.install_id, { approveNewPermissions });
      setPermissionPrompt(null);
      onChange();
    } catch (e: any) {
      const prompt = upgradePermissionPromptFromError(e);
      if (prompt && !approveNewPermissions) {
        setPermissionPrompt(prompt);
      } else {
        alert(e.message || "upgrade failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const updateAvailable = appHasUpdate(app);

  // Status dot — green/amber/red/grey. The dot is the row's first
  // visual element so operators eye-scan a column of running/down
  // states quickly without parsing labels.
  const dotColor =
    app.status === "running"
      ? "bg-green"
      : app.status === "error"
        ? "bg-red"
        : app.status === "disabled"
          ? "bg-text-dim"
          : "bg-yellow animate-pulse"; // pending — pulsing amber

  const projectPagePanel = (app.ui_panels || []).find((p) => p.slot === "project.page");
  const staticAppMount =
    app.status === "running" &&
    app.surfaces?.ui_app &&
    app.surfaces?.ui_app_mount
      ? app.surfaces.ui_app_mount
      : null;
  const showOpen = app.status === "running" && (!!projectPagePanel || !!staticAppMount);

  // The "middle text" of the row is context-dependent:
  //   pending → live status_message (Cloning… / Building… / Linking…)
  //   error   → the error_message
  //   else    → static description, truncated to one line
  const middleText =
    app.status === "pending"
      ? app.status_message || "Installing…"
      : app.status === "error" && app.error_message
        ? app.error_message
        : app.description;
  const middleTone =
    app.status === "pending"
      ? "text-accent"
      : app.status === "error"
        ? "text-red"
        : "text-text-muted";

  return (
    <>
    <div
      className="relative rounded-lg border border-border bg-bg-card px-3 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors cursor-pointer md:rounded-none md:border-0 md:bg-transparent md:px-4"
      onClick={onOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpenDetails();
        }
      }}
    >
      {/* Status dot */}
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`}
        title={app.status}
      />

      {/* Icon */}
      <AppIcon url={app.icon} name={app.display_name} iconStyle={app.icon_style} />

      {/* Name + version (left column, takes remaining space, truncates) */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text text-sm font-medium truncate">
            {app.display_name}
          </span>
          {app.status === "disabled" && <span className="shrink-0 text-[10px] text-text-dim">Disabled</span>}
          <span className="text-text-dim text-[11px] shrink-0">
            v{app.version}
            {updateAvailable && (
              <span className="text-yellow"> → v{app.available_version}</span>
            )}
          </span>
        </div>
        <div className={`text-xs truncate mt-0.5 ${middleTone}`} title={middleText}>
          {middleText}
        </div>
      </div>

      {/* Pills */}
      <div className="hidden md:flex items-center gap-1 shrink-0">
        {app.project_id ? (
          <Pill className="bg-accent/10 text-accent">project</Pill>
        ) : (
          <Pill className="bg-border text-text-muted">global</Pill>
        )}
        {app.source === "builtin" && <Pill className="bg-blue/15 text-blue">built-in</Pill>}
        {app.default_for_new_agents && <Pill className="bg-accent/15 text-accent">default</Pill>}
        {app.deprecated && <Pill className="bg-red/15 text-red">deprecated</Pill>}
        {updateAvailable && <Pill className="bg-yellow/15 text-yellow">update</Pill>}
      </div>

      <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setActionMenuOpen((open) => !open)}
          className="flex h-8 w-8 items-center justify-center rounded-md text-lg text-text-dim hover:bg-bg-hover hover:text-text"
          aria-label={`Actions for ${app.display_name}`}
          aria-expanded={actionMenuOpen}
          disabled={busy}
        >
          ⋯
        </button>
        {actionMenuOpen && (
          <div className="absolute right-0 top-9 z-20 min-w-36 rounded-md border border-border bg-bg-card p-1 shadow-xl">
            {showOpen && (
              <Link to={`/apps/${app.name}/page`} onClick={() => setActionMenuOpen(false)} className="block rounded px-3 py-2 text-xs text-text hover:bg-bg-hover">Open</Link>
            )}
            {updateAvailable && <button disabled={busy} type="button" onClick={() => { setActionMenuOpen(false); void upgrade(); }} className="block w-full rounded px-3 py-2 text-left text-xs text-yellow hover:bg-bg-hover">Update</button>}
            <AppStatusAction app={app} disabled={busy} onBusyChange={setBusy} onChanged={() => { setActionMenuOpen(false); onChange(); }} className="block min-h-10 w-full rounded px-3 py-2 text-left text-xs text-text-muted hover:bg-bg-hover" />
            {app.source !== "builtin" && <button disabled={busy} type="button" onClick={() => { setActionMenuOpen(false); if (confirm(`Uninstall ${app.display_name || app.name}?`)) void remove(); }} className="block w-full rounded px-3 py-2 text-left text-xs text-red hover:bg-bg-hover">Uninstall</button>}
          </div>
        )}
      </div>
    </div>
    <UpgradePermissionModal
      appName={app.display_name}
      prompt={permissionPrompt}
      busy={busy}
      onCancel={() => setPermissionPrompt(null)}
      onConfirm={() => upgrade(true)}
    />
    </>
  );
}

function AppCard({
  app, onChange, onOpenDetails,
}: {
  app: AppRow;
  onChange: () => void;
  onOpenDetails: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showMount, setShowMount] = useState(false);
  const [mountUrl, setMountUrl] = useState("http://127.0.0.1:8080");
  const [mountError, setMountError] = useState("");
  const [permissionPrompt, setPermissionPrompt] = useState<UpgradePermissionPrompt | null>(null);

  const remove = async () => {
    setBusy(true);
    try {
      await apps.uninstall(app.install_id);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const mount = async () => {
    setBusy(true);
    setMountError("");
    try {
      await apps.setStatus(app.install_id, "running", { sidecarUrl: mountUrl });
      setShowMount(false);
      onChange();
    } catch (e: any) {
      setMountError(e.message || "mount failed");
    } finally {
      setBusy(false);
    }
  };

  const upgrade = async (approveNewPermissions = false) => {
    setBusy(true);
    try {
      await apps.upgrade(app.install_id, { approveNewPermissions });
      setPermissionPrompt(null);
      onChange();
    } catch (e: any) {
      const prompt = upgradePermissionPromptFromError(e);
      if (prompt && !approveNewPermissions) {
        setPermissionPrompt(prompt);
      } else {
        alert(e.message || "upgrade failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const updateAvailable = appHasUpdate(app);

  const statusColor =
    app.status === "running"
      ? "bg-green/15 text-green"
      : app.status === "error"
        ? "bg-red/15 text-red"
        : app.status === "disabled"
          ? "bg-border text-text-dim"
          : "bg-yellow/15 text-yellow";

  // Vertical tile, mirrors MarketplaceCard. Top: icon + name +
  // version. Middle: pills (status, scope, builtin) + description
  // OR live install progress. Bottom: Open button (sidecar panel
  // page or static-app mount) + Uninstall, or the inline mount/
  // remove confirmation when one of those flows is active.
  const projectPagePanel = (app.ui_panels || []).find((p) => p.slot === "project.page");
  // Static UI apps (kind=static + provides.ui_app) live at an
  // absolute URL on the same origin as the dashboard. The server
  // resolves the per-install mount path (config.mount_path overrides
  // the manifest default) and emits it as surfaces.ui_app_mount.
  const staticAppMount =
    app.status === "running" &&
    app.surfaces?.ui_app &&
    app.surfaces?.ui_app_mount
      ? app.surfaces.ui_app_mount
      : null;
  const showOpen = app.status === "running" && (!!projectPagePanel || !!staticAppMount);

  return (
    <>
    <div
      className="border border-border rounded-lg p-4 flex flex-col gap-2 cursor-pointer hover:border-accent/60 transition-colors min-h-[260px]"
      onClick={onOpenDetails}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetails();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <BigAppIcon url={app.icon} name={app.display_name} iconStyle={app.icon_style} />
        <div className="flex-1 min-w-0">
          <div className="text-text font-medium truncate">{app.display_name}</div>
          <div className="text-text-dim text-[11px] mt-0.5">
            v{app.version}
            {updateAvailable && (
              <span className="text-yellow"> → v{app.available_version}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Pill className={statusColor}>{app.status}</Pill>
        {app.project_id ? (
          <Pill className="bg-accent/10 text-accent">project</Pill>
        ) : (
          <Pill className="bg-border text-text-muted">global</Pill>
        )}
        {app.source === "builtin" && <Pill className="bg-blue/15 text-blue">built-in</Pill>}
        {app.default_for_new_agents && <Pill className="bg-accent/15 text-accent">default</Pill>}
        {app.deprecated && <Pill className="bg-red/15 text-red">deprecated</Pill>}
        {updateAvailable && <Pill className="bg-yellow/15 text-yellow">update available</Pill>}
      </div>
      {app.status === "pending" ? (
        <p className="text-accent text-xs italic flex items-center gap-1.5 flex-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
          <span className="line-clamp-3">{app.status_message || "Installing…"}</span>
        </p>
      ) : app.status === "error" && app.error_message ? (
        <p className="text-red text-xs line-clamp-3 flex-1" title={app.error_message}>{app.error_message}</p>
      ) : (
        <p className="text-text-muted text-xs line-clamp-3 flex-1">{app.description}</p>
      )}
      {app.status !== "pending" && (
        <AppSurfaceBadges surfaces={app.surfaces} className="!gap-1" />
      )}
      <div className="mt-auto flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
        {showMount ? (
          <div className="bg-accent/10 border border-accent/40 rounded p-2 flex flex-wrap items-center gap-1">
            <input
              type="text"
              value={mountUrl}
              onChange={(e) => setMountUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              className="basis-full bg-bg-input border border-border rounded px-1 py-0.5 text-[11px] font-mono text-text"
            />
            <button onClick={mount} disabled={busy} className="text-[10px] text-accent font-medium hover:underline disabled:opacity-50">
              {busy ? "…" : "mount"}
            </button>
            <button onClick={() => setShowMount(false)} disabled={busy} className="text-[10px] text-text-muted hover:text-text">cancel</button>
            {mountError && <span className="basis-full text-[10px] text-red">{mountError}</span>}
          </div>
        ) : confirmRemove ? (
          <div className="bg-red/10 border border-red/40 rounded p-2 flex items-center gap-2">
            <span className="text-[11px] text-red flex-1">Uninstall?</span>
            <button onClick={remove} disabled={busy} className="text-[11px] text-red font-medium hover:underline disabled:opacity-50">
              {busy ? "…" : "confirm"}
            </button>
            <button onClick={() => setConfirmRemove(false)} disabled={busy} className="text-[11px] text-text-muted hover:text-text">
              cancel
            </button>
          </div>
        ) : (
          <>
            {showOpen && (
              staticAppMount ? (
                // Static UI app — full navigation to the absolute URL,
                // not a router push (the SPA router doesn't own /demo,
                // /client, etc., and we want a fresh page anyway).
                <a
                  href={staticAppMount.endsWith("/") ? staticAppMount : staticAppMount + "/"}
                  target="_blank"
                  rel="noopener"
                  onClick={(e) => e.stopPropagation()}
                  className="w-full px-3 py-1.5 border border-accent rounded text-xs text-accent hover:bg-accent hover:text-bg transition-colors text-center"
                >
                  Open ↗
                </a>
              ) : (
                <Link
                  to={`/apps/${app.name}/page`}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full px-3 py-1.5 border border-accent rounded text-xs text-accent hover:bg-accent hover:text-bg transition-colors text-center"
                >
                  Open
                </Link>
              )
            )}
            <div className="flex items-center gap-1.5">
              {updateAvailable && (
                <button
                  onClick={() => upgrade()}
                  disabled={busy}
                  className="flex-1 px-2 py-1 border border-yellow rounded text-[11px] text-yellow hover:bg-bg-hover transition-colors disabled:opacity-50"
                  title={`Upgrade to v${app.available_version}`}
                >
                  {busy ? "…" : `Update → v${app.available_version}`}
                </button>
              )}
              {(app.status === "pending" || app.status === "disabled" || app.status === "error") && app.source !== "builtin" && (
                <button
                  onClick={() => setShowMount(true)}
                  className="flex-1 px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-accent hover:border-accent transition-colors"
                  title="Mount a running sidecar by URL (local dev)"
                >
                  Mount…
                </button>
              )}
              <AppStatusAction app={app} disabled={busy} onBusyChange={setBusy} onChanged={() => onChange()} />
              {app.source !== "builtin" && (
                <button
                  onClick={() => setConfirmRemove(true)}
                  className="flex-1 px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-red hover:border-red transition-colors"
                >
                  Uninstall
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
    <UpgradePermissionModal
      appName={app.display_name}
      prompt={permissionPrompt}
      busy={busy}
      onCancel={() => setPermissionPrompt(null)}
      onConfirm={() => upgrade(true)}
    />
    </>
  );
}

// surfaceLabels was the old text-only renderer; AppSurfaceBadges
// (components/apps) replaces it with coloured pills. Kept removed
// rather than commented to keep the file lean.

function InstallModal({
  open,
  onClose,
  projectId,
  onInstalled,
  initialManifestUrl,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  onInstalled: () => void;
  initialManifestUrl?: string;
}) {
  const setupExitGuard = useRef<() => boolean>(() => true);
  const closeInstall = () => { if (setupExitGuard.current()) onClose(); };
  const [manifestUrl, setManifestUrl] = useState("");
  const [preview, setPreview] = useState<AppPreview | null>(null);
  const [preflight, setPreflight] = useState<AppPreflight | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<"project" | "global">("project");

  // Reconcile scope against what the app actually supports as soon as
  // we see a preview. Without this, a global-only app would inherit
  // the "project" default, the picker would be hidden (length===1
  // branch below), and Install would POST projectId to a server that
  // (correctly) rejects it with "app does not support scope project".
  useEffect(() => {
    if (!preview) return;
    const supported = preview.manifest.scopes;
    if (!supported.includes(scope) && supported.length > 0) {
      setScope(supported[0] as "project" | "global");
    }
  }, [preview, scope]);
  // bindings: role → connection_id | install_id | null. Built by the
  // role pickers; sent verbatim to apps.install on submit.
  const [bindings, setBindings] = useState<Record<string, AppBindingValue>>({});
  // intents: role → pending sub-action. Executed in sequence on
  // Install click, BEFORE the parent install POST. Lets the operator
  // express "use these creds" / "yes install storage" without per-row
  // confirm buttons.
  const [intents, setIntents] = useState<Record<string, RoleIntent | null>>({});

  // When the modal opens with a marketplace-pre-filled URL, kick off
  // preview automatically — saves a click and matches "install from
  // marketplace card" intent.
  useEffect(() => {
    if (open && initialManifestUrl && initialManifestUrl !== manifestUrl) {
      setManifestUrl(initialManifestUrl);
      setPreview(null);
      setPreflight(null);
      setBindings({});
      setIntents({});
      setConfig({});
      setError("");
      setScope("project");
      // Trigger preview + preflight in parallel after URL state settles.
      setTimeout(() => {
        setPreviewing(true);
        Promise.all([
          apps.preview(initialManifestUrl),
          apps.preflight(initialManifestUrl, undefined, projectId),
        ])
          .then(([p, pf]) => {
            setPreview(p);
            setPreflight(pf);
            setBindings(seedBindings(pf));
          })
          .catch((e) => setError(e.message || "preview failed"))
          .finally(() => setPreviewing(false));
      }, 0);
    }
    if (!open) {
      // Reset when closed so the next open is clean.
      setManifestUrl("");
      setPreview(null);
      setPreflight(null);
      setBindings({});
      setIntents({});
      setError("");
      setConfig({});
      setScope("project");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialManifestUrl]);

  const reset = () => {
    setManifestUrl("");
    setPreview(null);
    setPreflight(null);
    setBindings({});
    setIntents({});
    setError("");
    setConfig({});
    setScope("project");
  };

  const doPreview = async () => {
    setError("");
    setPreviewing(true);
    try {
      const [p, pf] = await Promise.all([
        apps.preview(manifestUrl),
        apps.preflight(manifestUrl, undefined, projectId),
      ]);
      setIntents({});
      setConfig({});
      setPreview(p);
      setPreflight(pf);
      setBindings(seedBindings(pf));
    } catch (e: any) {
      setError(e.message || "preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  // refetchPreflight is invoked by RolePicker after an inline create
  // (new connection or new app install). We re-fetch preflight to
  // populate the now-existing candidate; the picker auto-binds via
  // its own onChange callback after the refresh resolves.
  // Scope-aware: a global-scoped install minted a global connection
  // (see InstallModal's projectId={...} prop on PreviewAndConfigure
  // for the inline-connect fix), so we must re-preflight with the
  // same scope to actually see it. Without this, the refresh polls
  // the operator's current project and the new global connection
  // never appears in the candidate list.
  const refetchPreflight = async () => {
    if (!manifestUrl) return;
    try {
      const pf = await apps.preflight(
        manifestUrl,
        undefined,
        scope === "global" ? "" : projectId,
      );
      setPreflight(pf);
    } catch (e: any) {
      setError(e.message || "preflight refresh failed");
    }
  };

  // Required roles must have either a non-null binding OR (for
  // kind=app) a pending install_app intent — the intent gets
  // resolved by doInstall before the parent install runs. For
  // kind=integration there's no intent path: the operator must hit
  // the inline Connect button to mint the connection synchronously,
  // which writes the binding directly.
  const requiredRolesUnbound = (preflight?.roles || []).filter((r) => {
    if (!r.required) return false;
    if (hasBindingSelection(bindings[r.role])) return false;
    const intent = intents[r.role];
    if (intent?.kind === "install_app" && intent.appName) return false;
    return true;
  });
  // Required config fields whose value is empty. A field is required
  // when manifest's `required: true` OR when its
  // `required_if_role_bound` names a role with a non-null binding.
  // The Install button is gated on both: required roles + required
  // fields. Optional fields (the rest of config_schema) live in the
  // post-install Settings panel, keeping the modal short.
  const requiredFieldsUnfilled = preview
    ? requiredConfigFields(preview.manifest, bindings).filter(
        (f) => !((config[f.name] ?? f.default ?? "") as string).trim(),
      )
    : [];
  const optionalConnectionsUnfinished = (preflight?.roles || []).filter((r) =>
    !r.required && intents[r.role]?.kind === "connect_integration" && !hasBindingSelection(bindings[r.role]),
  );
  const optionalAppsUnavailable = (preflight?.roles || []).filter((r) => {
    const intent = intents[r.role];
    return !r.required && intent?.kind === "install_app" && !intent.appName;
  });
  const installBlockers = [
    ...requiredRolesUnbound.map((r) => `Connect or install ${r.label || r.role}`),
    ...requiredFieldsUnfilled.map((f) => `Fill in ${f.label || f.name}`),
    ...optionalConnectionsUnfinished.map((r) => `Finish connecting ${r.label || r.role}, or deselect it`),
    ...optionalAppsUnavailable.map((r) => `No app is available for ${r.label || r.role}; deselect it`),
  ];
  const canInstall =
    !!preview &&
    installBlockers.length === 0;

  // Step text shown next to the spinner during the multi-step install.
  const [installStep, setInstallStep] = useState("");

  const doInstall = async () => {
    if (!preview || !canInstall) return;
    setError("");
    setInstalling(true);
    setInstallStep("");
    try {
      // Resolve install_app intents — connection intents are
      // already-resolved (the Connect button creates them
      // synchronously and writes the binding before the operator
      // can click Install). Apps deps install here in sequence,
      // their result_id written back to bindings before the parent
      // install fires.
      const finalBindings: Record<string, AppBindingValue> = { ...bindings };
      let registryCache: MarketplaceEntry[] | null = null;
      for (const role of preflight?.roles || []) {
        const intent = intents[role.role];
        if (!intent || intent.kind !== "install_app") continue;
        if (finalBindings[role.role] != null && finalBindings[role.role] !== 0) continue;

        setInstallStep(`Installing ${intent.appName}…`);
        if (!registryCache) {
          const r = await apps.marketplace();
          registryCache = r.apps || [];
        }
        const entry = registryCache.find((a) => a.name === intent.appName);
        if (!entry) throw new Error(`${intent.appName} not in registry`);
        if (entry.deprecated) {
          throw new Error(`${intent.appName} is deprecated and can no longer be installed`);
        }
        const r = await apps.install({
          manifestUrl: entry.manifest_url,
          projectId: scope === "global" ? "" : projectId,
        });
        finalBindings[role.role] = r.install_id;
      }

      // Now install the parent with all bindings resolved.
      setInstallStep(`Installing ${preview.manifest.display_name || preview.manifest.name}…`);
      await apps.install({
        manifestUrl,
        projectId: scope === "global" ? "" : projectId,
        config,
        bindings: finalBindings,
      });
      reset();
      onInstalled();
    } catch (e: any) {
      setError(e.message || "install failed");
    } finally {
      setInstalling(false);
      setInstallStep("");
    }
  };

  return (
    <Modal open={open} onClose={closeInstall} width={preview?.manifest.setup ? "max-w-3xl" : "max-w-xl"} ariaLabel="Install an app">
      <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h3 className="min-w-0 text-text text-base font-bold">Install an app</h3>
        <button
          type="button"
          onClick={closeInstall}
          aria-label="Close install dialog"
          className="flex size-11 shrink-0 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          ×
        </button>
      </div>

      {!preview ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 sm:p-5">
          <label className="block">
            <span className="text-text-muted text-xs">Apteva manifest or Agent Plugin URL</span>
            <input
              type="text"
              value={manifestUrl}
              onChange={(e) => setManifestUrl(e.target.value)}
              placeholder="https://example.com/my-app/plugin.json"
              className="mt-1 min-h-11 w-full bg-bg-input border border-border rounded px-2 py-1.5 text-sm text-text font-mono focus:outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[11px] text-text-dim">
              Supports existing apteva.yaml manifests and Agent Plugins 1.0.0 plugin.json packages.
            </span>
          </label>
          {error && <div className="text-red text-xs">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="min-h-11 px-3 py-1.5 text-sm text-text-muted hover:text-text">
              Cancel
            </button>
            <button
              onClick={doPreview}
              disabled={!manifestUrl || previewing}
              className="min-h-11 px-3 py-1.5 text-sm bg-accent text-bg rounded font-bold disabled:opacity-50"
            >
              {previewing ? "Loading…" : "Preview →"}
            </button>
          </div>
        </div>
      ) : preview.manifest.setup && !preflight ? (
        <div className="p-5 space-y-3"><p role={error ? "alert" : "status"}>{error || "Loading app setup…"}</p>{error && <button className="min-h-11 text-accent" onClick={() => void refetchPreflight()}>Retry setup</button>}</div>
      ) : preview.manifest.setup && preflight ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5"><GuidedAppSetup onExitGuard={guard => { setupExitGuard.current = guard; }} key={manifestUrl} preflight={preflight} manifestURL={manifestUrl} projectId={scope === "global" ? "" : projectId} onDone={() => { reset(); onInstalled(); }} /></div>
      ) : (
        <PreviewAndConfigure
          preview={preview}
          preflight={preflight}
          bindings={bindings}
          setBindings={setBindings}
          intents={intents}
          setIntents={setIntents}
          canInstall={canInstall}
          installBlockers={installBlockers}
          scope={scope}
          setScope={setScope}
          config={config}
          setConfig={setConfig}
          error={error}
          installing={installing}
          installStep={installStep}
          // Pass the scope-aware projectId so any integration
          // connections minted inline during this install (via
          // InlineConnectIntegration) land at the same scope as
          // the app itself — a global app gets globally-scoped
          // integrations, not project-scoped ones the operator
          // can't reuse from other projects.
          projectId={scope === "global" ? "" : projectId}
          refetchPreflight={refetchPreflight}
          onBack={() => {
            setPreview(null);
            setPreflight(null);
            setBindings({});
            setIntents({});
            setConfig({});
            setError("");
            setScope("project");
          }}
          onConfirm={doInstall}
        />
      )}
    </Modal>
  );
}

// RolePicker renders one preflight role as either a select (when
// candidates exist) or a hint with an "Install …" affordance. The
// optional/required distinction shows up as a checkbox prefix; when
// unchecked the binding is null (operator declined the optional dep).
// RoleIntent — pending sub-action stored alongside the role's binding.
// The parent's Install button executes intents in sequence (install
// dep apps + create connections) before submitting the parent install
// with the resulting ids.
// seedBindings pre-populates the bindings map from preflight.
//
// Required roles auto-pick the first compatible candidate so the
// install button isn't blocked behind a click the user can't avoid
// anyway — they can still change the picked target before submit.
//
// Optional roles always start unbound, even when exactly one
// compatible candidate is available. Auto-binding "convenient"
// optional deps surprised operators ("I just installed image-studio
// and somehow my storage app is now wired into it"); making the
// opt-in explicit is the safer default. The operator ticks the
// role's checkbox when they want it; otherwise the dep is skipped
// and the install proceeds with the role unbound.
function seedBindings(pf: AppPreflight | null): Record<string, AppBindingValue> {
  const out: Record<string, AppBindingValue> = {};
  if (!pf) return out;
  for (const r of pf.roles) {
    if (!r.required) {
      out[r.role] = null;
      continue;
    }
    const cands = r.kind === "integration" ? r.integration_candidates : r.app_candidates;
    if (cands && cands.length > 0) {
      const c = cands[0] as PreflightConnectionCandidate | PreflightAppCandidate;
      const id = "connection_id" in c ? c.connection_id : c.install_id;
      out[r.role] = r.mode === "multiple" ? multiBinding([id], id) : id;
    } else {
      // Required role with no candidate — operator must satisfy it
      // (Connect button for kind=integration, install_app intent for
      // kind=app). Leaving null surfaces the unbound state in the UI.
      out[r.role] = null;
    }
  }
  return out;
}

function PreviewAndConfigure({
  preview,
  preflight,
  bindings,
  setBindings,
  intents,
  setIntents,
  canInstall,
  installBlockers,
  scope,
  setScope,
  config,
  setConfig,
  error,
  installing,
  installStep,
  onBack,
  onConfirm,
  projectId,
  refetchPreflight,
}: {
  preview: AppPreview;
  preflight: AppPreflight | null;
  bindings: Record<string, AppBindingValue>;
  setBindings: Dispatch<SetStateAction<Record<string, AppBindingValue>>>;
  intents: Record<string, RoleIntent | null>;
  setIntents: Dispatch<SetStateAction<Record<string, RoleIntent | null>>>;
  canInstall: boolean;
  installBlockers: string[];
  scope: "project" | "global";
  setScope: (s: "project" | "global") => void;
  config: Record<string, string>;
  setConfig: (c: Record<string, string>) => void;
  error: string;
  installing: boolean;
  installStep: string;
  onBack: () => void;
  onConfirm: () => void;
  projectId?: string;
  refetchPreflight: () => Promise<void>;
}) {
  const m = preview.manifest;
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [expandedOptionalRole, setExpandedOptionalRole] = useState<string | null>(null);
  const requiredRoles = (preflight?.roles || []).filter((role) => role.required);
  const optionalRoles = (preflight?.roles || []).filter((role) => !role.required);
  const selectedOptionalRoles = optionalRoles.filter((role) =>
    hasBindingSelection(bindings[role.role]) || intents[role.role] != null,
  );
  const hasRequiredSetup = requiredRoles.length > 0 || requiredConfigFields(m, bindings).length > 0;
  const permissions = m.requires.permissions || [];
  const optionalSummary = selectedOptionalRoles.length > 0
    ? `Selected: ${selectedOptionalRoles.map((role) => role.label || role.role).join(", ")}`
    : `Available: ${optionalRoles.map((role) => role.label || role.role).join(", ")}`;

  const renderRole = (role: PreflightRole, compact: boolean) => (
    <RolePicker
      key={role.role}
      role={role}
      value={bindings[role.role] ?? null}
      onChange={(value) => {
        setBindings((current) => ({ ...current, [role.role]: value }));
        if (compact && hasBindingSelection(value)) setExpandedOptionalRole(role.role);
      }}
      intent={intents[role.role] ?? null}
      setIntent={(intent) => {
        setIntents((current) => ({ ...current, [role.role]: intent }));
        if (compact && intent) setExpandedOptionalRole(role.role);
      }}
      projectId={projectId}
      onConnected={async (connId) => {
        await refetchPreflight();
        setBindings((current) => ({
          ...current,
          [role.role]: addBindingSelection(current[role.role], connId, role.mode === "multiple"),
        }));
      }}
      compact={compact}
      expanded={expandedOptionalRole === role.role}
      onToggleExpanded={() => setExpandedOptionalRole(
        expandedOptionalRole === role.role ? null : role.role,
      )}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        <section className="rounded-lg border border-border p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h4 className="min-w-0 break-words text-sm font-bold text-text">{m.display_name || m.name}</h4>
            <span className="shrink-0 text-xs text-text-dim">v{m.version}</span>
          </div>
          {m.description && (
            <>
              <p className={`mt-2 break-words text-xs leading-relaxed text-text-muted ${descriptionExpanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>
                {m.description}
              </p>
              {m.description.length > 60 && (
                <button
                  type="button"
                  onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                  aria-expanded={descriptionExpanded}
                  className="mt-1 min-h-8 text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {descriptionExpanded ? "Show less" : "Read full description"}
                </button>
              )}
            </>
          )}
        </section>

        {(m.scopes.length > 0 || permissions.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {m.scopes.length > 0 && (
              <section className="min-w-0">
                <h4 className="mb-2 text-xs font-medium text-text-muted">Install scope</h4>
                {m.scopes.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {(["project", "global"] as const).map((choice) =>
                      m.scopes.includes(choice) ? (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => setScope(choice)}
                          aria-pressed={scope === choice}
                          className={`min-h-10 rounded border px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                            scope === choice
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border text-text-muted hover:text-text"
                          }`}
                        >
                          {choice}
                        </button>
                      ) : null,
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">
                    <span className="rounded border border-border bg-bg-muted px-2 py-1 font-mono">{m.scopes[0]}</span>
                    <span className="ml-2">Only available scope</span>
                  </p>
                )}
              </section>
            )}

            {permissions.length > 0 && (
              <section className="min-w-0">
                <h4 className="mb-2 text-xs font-medium text-text-muted">Permissions requested</h4>
                <ul className="flex flex-wrap gap-1.5">
                  {permissions.map((permission) => (
                    <li key={permission} className="max-w-full break-all rounded border border-border bg-bg-muted px-2 py-1 font-mono text-[11px] text-text">
                      {permission}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {hasRequiredSetup && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-text">Required setup</h4>
            {requiredRoles.map((role) => renderRole(role, false))}
            <RequiredConfigFields
              manifest={m}
              bindings={bindings}
              config={config}
              setConfig={setConfig}
            />
          </section>
        )}

        {optionalRoles.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setOptionalOpen(!optionalOpen)}
              aria-expanded={optionalOpen}
              aria-controls="install-optional-addons"
              className="flex min-h-16 w-full items-center gap-3 p-3 text-left hover:bg-bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:p-4"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-text">
                  Optional add-ons
                  <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-normal text-text-muted">
                    {selectedOptionalRoles.length} of {optionalRoles.length} selected
                  </span>
                </span>
                <span className="mt-1 block truncate text-[11px] text-text-muted" title={optionalSummary}>{optionalSummary}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-sm text-text-muted">{optionalOpen ? "▴" : "▾"}</span>
            </button>
            <div id="install-optional-addons" hidden={!optionalOpen} className="space-y-2 border-t border-border p-2 sm:p-3">
              <p className="px-1 text-[11px] text-text-muted">Choose only the add-ons you want to use.</p>
              {optionalRoles.map((role) => renderRole(role, true))}
            </div>
          </section>
        )}

        <details className="text-[11px] text-text-dim">
          <summary className="cursor-pointer py-1 hover:text-text-muted">What happens after install?</summary>
          <p className="mt-1 leading-relaxed">
            Apteva builds the app on this host. A first install can take 30–60 seconds while dependencies download.
            Its status changes to running after the health check passes.
          </p>
        </details>
      </div>

      <footer className="shrink-0 border-t border-border bg-bg-card px-4 py-3 sm:px-5">
        {error && <div role="alert" className="mb-2 max-h-20 overflow-y-auto break-words text-xs text-red">{error}</div>}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p id="install-blockers" role="status" className={`min-w-0 flex-1 text-[11px] ${installBlockers.length ? "text-yellow" : "text-text-muted"}`}>
            {installBlockers.length
              ? `${installBlockers[0]}${installBlockers.length > 1 ? ` (+${installBlockers.length - 1} more)` : ""}`
              : selectedOptionalRoles.length > 0
                ? `Ready · ${selectedOptionalRoles.length} optional add-on${selectedOptionalRoles.length === 1 ? "" : "s"} selected`
                : "Ready to install"}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              onClick={onBack}
              disabled={installing}
              className="min-h-11 rounded px-3 text-xs text-text-muted hover:text-text disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={installing || !canInstall}
              aria-describedby="install-blockers"
              className="min-h-11 min-w-0 flex-1 rounded bg-accent px-4 text-sm font-bold text-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:max-w-60 sm:flex-none"
            >
              <span className="block truncate">
                {installing ? installStep || "Installing…" : `Install ${m.display_name || m.name}`}
              </span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Config-schema rendering ─────────────────────────────────────────
//
// v0.14 install modal renders only the REQUIRED subset of the
// manifest's config_schema; the rest stays in post-install Settings.
// "Required" = field.required is true OR field.required_if_role_bound
// names a role with a non-null binding. Non-required fields silently
// ride along with their declared defaults — operators don't have to
// see fields they don't need to think about. Same renderer is used
// at install AND post-install (via SettingsSection); the only
// difference is which fields it shows.

// requiredConfigFields returns the subset of config_schema fields
// that need an answer for THIS install given the current bindings.
// Pure function so InstallModal can reuse it for canInstall gating.
