import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  apps,
  integrations,
  type AppRow,
  type AppPreview,
  type AppPreflight,
  type AppDetail,
  type AppManifestV2,
  type AppConfigField,
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
import { AppDiscoverySelect } from "../components/apps/AppDiscoverySelect";

type Tab = "installed" | "marketplace";

// AppIcon — renders the manifest icon, falls back to a single-letter
// avatar when the URL is missing or 404s. Both the marketplace card
// and the installed-app card share this so we don't end up with the
// browser's default broken-image glyph.
function AppIcon({ url, name }: { url?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="w-10 h-10 rounded bg-bg-input text-text-dim flex items-center justify-center flex-shrink-0">
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="w-10 h-10 rounded bg-bg-input p-1 flex-shrink-0"
      onError={() => setBroken(true)}
    />
  );
}

// The Apps tab — sidecar-based v2 Apps. Lists every install visible
// to the current project (own installs + globals), shows surfaces +
// status, and lets the user install a new one from a manifest URL.
//
// Marketplace + permission consent UI are next iteration; for now the
// install flow is "paste a manifest URL, fill config, click Install".
export function Apps() {
  const { currentProject } = useProjects();
  const [tab, setTab] = useState<Tab>("installed");
  usePageTitle(["Apps", tab === "marketplace" ? "Marketplace" : "Installed"]);
  const [rows, setRows] = useState<AppRow[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  const [registryURL, setRegistryURL] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installModal, setInstallModal] = useState<{ manifestUrl?: string } | null>(null);
  // Side-panel state — single component, two contexts (a marketplace
  // entry vs. an installed app row). Only one is non-null at a time.
  const [detailEntry, setDetailEntry] = useState<MarketplaceEntry | null>(null);
  const [detailInstall, setDetailInstall] = useState<AppRow | null>(null);

  const refreshInstalled = () => {
    setLoading(true);
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
      .finally(() => setLoading(false));
  };

  const refreshMarketplace = () => {
    setLoading(true);
    apps
      .marketplace(currentProject?.id)
      .then((r) => {
        setMarketplace(r.apps);
        setRegistryURL(r.registry_url);
      })
      .catch((e) => setError(e.message || "failed"))
      .finally(() => setLoading(false));
  };

  // Initial load + reload when tab or project changes. The cancelled
  // flag prevents the older fetch's response from overwriting state
  // when the user flips tabs or switches project mid-flight.
  useEffect(() => {
    let cancelled = false;
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
          const r = await apps.marketplace(currentProject?.id);
          if (cancelled) return;
          setMarketplace(r.apps);
          setRegistryURL(r.registry_url);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [tab, currentProject?.id]);

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
    const anyPending = rows.some((r) => r.status === "pending");
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
  }, [tab, rows, currentProject?.id]);

  // Keep the installed-app side panel bound to the freshest row. List
  // polling updates `rows`, but the panel stores the row object that was
  // clicked; without this, an upgrade can finish in the list while the
  // open panel still shows the old version until a full page reload.
  useEffect(() => {
    if (!detailInstall) return;
    const fresh = rows.find((r) => r.install_id === detailInstall.install_id);
    if (fresh && fresh !== detailInstall) {
      setDetailInstall(fresh);
    }
  }, [rows, detailInstall]);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4 flex items-start justify-between">
        <div>
          <h2 className="text-text text-base font-bold">Apps</h2>
          <p className="text-text-muted text-sm mt-1">
            Apteva Apps run as sidecar services and contribute MCP tools,
            HTTP routes, channels, and UI surfaces.
          </p>
        </div>
        <button
          onClick={() => setInstallModal({})}
          className="px-3 py-1.5 text-sm bg-accent text-bg rounded-lg font-bold hover:opacity-80 flex-shrink-0"
        >
          + Install from URL
        </button>
      </div>

      <div className="border-b border-border px-6 flex gap-0">
        {(["installed", "marketplace"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs capitalize transition-colors ${
              tab === t ? "text-accent border-b border-accent -mb-px" : "text-text-muted hover:text-text"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {error && <div className="text-red text-sm">{error}</div>}

      {tab === "installed" ? (
        loading ? (
          <div className="text-text-dim text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="border border-border rounded-lg p-8 text-center max-w-2xl mx-auto">
            <p className="text-text-muted text-sm">No apps installed yet.</p>
            <p className="text-text-dim text-xs mt-1">
              Browse the <button onClick={() => setTab("marketplace")} className="text-accent hover:underline">Marketplace</button> tab or click <span className="text-accent">+ Install from URL</span>.
            </p>
          </div>
        ) : (
          // Installed apps are inventory, not pitch decks — render
          // as compact rows (status-led, actionable) rather than the
          // marketing cards we use on the Marketplace tab.
          <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
            {rows.map((r) => (
              <AppListRow
                key={r.install_id}
                app={r}
                onChange={refreshInstalled}
                onOpenDetails={() => setDetailInstall(r)}
              />
            ))}
          </div>
        )
      ) : (
        <MarketplaceView
          entries={marketplace}
          registryURL={registryURL}
          loading={loading}
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
          if (!detailInstall) return;
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
      />
    </div>
  );
}

function MarketplaceView({
  entries, registryURL, loading, onInstall, onOpenDetails,
}: {
  entries: MarketplaceEntry[];
  registryURL: string;
  loading: boolean;
  onInstall: (e: MarketplaceEntry) => void;
  onOpenDetails: (e: MarketplaceEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  if (loading) return <div className="text-text-dim text-sm">Loading marketplace…</div>;
  if (entries.length === 0) {
    return (
      <div className="border border-border rounded-lg p-8 text-center max-w-2xl mx-auto">
        <p className="text-text-muted text-sm">Marketplace is empty.</p>
        <p className="text-text-dim text-xs mt-1">Configured registry: <span className="font-mono">{registryURL}</span></p>
      </div>
    );
  }

  // Distinct categories for the chip row, ordered by population.
  const categoryCounts: Record<string, number> = {};
  for (const e of entries) {
    const k = e.category || "other";
    categoryCounts[k] = (categoryCounts[k] || 0) + 1;
  }
  const categories = Object.keys(categoryCounts).sort(
    (a, b) => categoryCounts[b] - categoryCounts[a],
  );

  // Apply text + category filter. Search hits name, display_name,
  // description, and tags so "video" finds Media even though that
  // word isn't in the name.
  const q = query.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (category !== "all" && (e.category || "other") !== category) return false;
    if (!q) return true;
    const hay = [
      e.name, e.display_name, e.description,
      ...(e.tags || []),
    ].join(" ").toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="space-y-5">
      {/* Search + category chips */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="bg-bg-input border border-border rounded px-3 py-1.5 text-sm flex-1 min-w-[200px] max-w-md"
        />
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            label="all"
            count={entries.length}
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {categories.map((c) => (
            <CategoryChip
              key={c}
              label={c}
              count={categoryCounts[c]}
              active={category === c}
              onClick={() => setCategory(c)}
            />
          ))}
        </div>
      </div>

      {/* Result grid */}
      {filtered.length === 0 ? (
        <div className="text-text-muted text-sm text-center py-12">
          No apps match. Try a different search or category.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((e) => (
            <MarketplaceCard
              key={e.name}
              entry={e}
              onInstall={() => onInstall(e)}
              onOpenDetails={() => onOpenDetails(e)}
            />
          ))}
        </div>
      )}

      <p className="text-text-dim text-[10px]">
        Registry: <span className="font-mono">{registryURL}</span>
        {" · "}
        {filtered.length} of {entries.length} apps
      </p>
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
        <BigAppIcon url={entry.icon} name={entry.display_name} />
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
function BigAppIcon({ url, name }: { url?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <div className="w-12 h-12 rounded-lg bg-bg-input text-text-dim flex items-center justify-center flex-shrink-0 text-xl font-medium">
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="w-12 h-12 rounded-lg bg-bg-input p-1 flex-shrink-0 object-contain"
      onError={() => setBroken(true)}
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

// AppListRow — compact horizontal row for the Installed tab.
// Different mental model from MarketplaceCard: operators are doing
// inventory + lifecycle management here, not browsing. So we lead
// with the status dot, keep the description compressed to a single
// line (or replaced inline with status_message / error_message
// while pending or errored), and surface every applicable action as
// a button on the right.
//
// Shares uninstall + mount + disable + upgrade handlers with the
// previous AppCard so behaviour is identical — only the layout
// changes.
function AppListRow({
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
  const disable = async () => {
    setBusy(true);
    try {
      await apps.setStatus(app.install_id, "disabled");
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

  const updateAvailable =
    !app.deprecated && !!app.available_version && !!app.version && app.available_version !== app.version;

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
      className="px-4 py-3 flex items-center gap-3 hover:bg-bg-card transition-colors cursor-pointer"
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
      {/* Status dot */}
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`}
        title={app.status}
      />

      {/* Icon */}
      <AppIcon url={app.icon} name={app.display_name} />

      {/* Name + version (left column, takes remaining space, truncates) */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text text-sm font-medium truncate">
            {app.display_name}
          </span>
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
        {app.deprecated && <Pill className="bg-red/15 text-red">deprecated</Pill>}
        {updateAvailable && <Pill className="bg-yellow/15 text-yellow">update</Pill>}
      </div>

      {/* Actions — anchored right, click doesn't propagate to row */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {showMount ? (
          <div className="bg-accent/10 border border-accent/40 rounded p-1.5 flex items-center gap-1.5">
            <input
              type="text"
              value={mountUrl}
              onChange={(e) => setMountUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              className="bg-bg-input border border-border rounded px-1.5 py-0.5 text-[11px] font-mono text-text w-48"
            />
            <button
              onClick={mount}
              disabled={busy}
              className="text-[11px] text-accent font-medium hover:underline disabled:opacity-50"
            >
              {busy ? "…" : "mount"}
            </button>
            <button
              onClick={() => setShowMount(false)}
              disabled={busy}
              className="text-[11px] text-text-muted hover:text-text"
            >
              cancel
            </button>
            {mountError && (
              <span className="text-[10px] text-red ml-1">{mountError}</span>
            )}
          </div>
        ) : confirmRemove ? (
          <div className="bg-red/10 border border-red/40 rounded px-2 py-1 flex items-center gap-2">
            <span className="text-[11px] text-red">Uninstall?</span>
            <button
              onClick={remove}
              disabled={busy}
              className="text-[11px] text-red font-medium hover:underline disabled:opacity-50"
            >
              {busy ? "…" : "confirm"}
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              disabled={busy}
              className="text-[11px] text-text-muted hover:text-text"
            >
              cancel
            </button>
          </div>
        ) : (
          <>
            {showOpen && (
              staticAppMount ? (
                <a
                  href={staticAppMount.endsWith("/") ? staticAppMount : staticAppMount + "/"}
                  target="_blank"
                  rel="noopener"
                  onClick={(e) => e.stopPropagation()}
                  className="px-2.5 py-1 border border-accent rounded text-[11px] text-accent hover:bg-accent hover:text-bg transition-colors"
                >
                  Open ↗
                </a>
              ) : (
                <Link
                  to={`/apps/${app.name}/page`}
                  onClick={(e) => e.stopPropagation()}
                  className="px-2.5 py-1 border border-accent rounded text-[11px] text-accent hover:bg-accent hover:text-bg transition-colors"
                >
                  Open
                </Link>
              )
            )}
            {updateAvailable && (
              <button
                onClick={() => upgrade()}
                disabled={busy}
                className="px-2.5 py-1 border border-yellow rounded text-[11px] text-yellow hover:bg-yellow/10 transition-colors disabled:opacity-50"
                title={`Upgrade to v${app.available_version}`}
              >
                {busy ? "…" : "Update"}
              </button>
            )}
            {(app.status === "pending" || app.status === "disabled" || app.status === "error") && app.source !== "builtin" && (
              <button
                onClick={() => setShowMount(true)}
                className="px-2.5 py-1 border border-border rounded text-[11px] text-text-muted hover:text-accent hover:border-accent transition-colors"
                title="Mount a running sidecar by URL (local dev)"
              >
                Mount…
              </button>
            )}
            {app.status === "running" && app.source !== "builtin" && (
              <button
                onClick={disable}
                disabled={busy}
                className="px-2.5 py-1 border border-border rounded text-[11px] text-text-muted hover:text-yellow hover:border-yellow transition-colors disabled:opacity-50"
              >
                Disable
              </button>
            )}
            {app.source !== "builtin" && (
              <button
                onClick={() => setConfirmRemove(true)}
                className="px-2.5 py-1 border border-border rounded text-[11px] text-text-muted hover:text-red hover:border-red transition-colors"
              >
                Uninstall
              </button>
            )}
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

  const disable = async () => {
    setBusy(true);
    try {
      await apps.setStatus(app.install_id, "disabled");
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

  const updateAvailable =
    !app.deprecated && !!app.available_version && !!app.version && app.available_version !== app.version;

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
        <BigAppIcon url={app.icon} name={app.display_name} />
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
              {app.status === "running" && app.source !== "builtin" && (
                <button
                  onClick={disable}
                  disabled={busy}
                  className="flex-1 px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-yellow hover:border-yellow transition-colors"
                >
                  Disable
                </button>
              )}
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
  };

  const doPreview = async () => {
    setError("");
    setPreviewing(true);
    try {
      const [p, pf] = await Promise.all([
        apps.preview(manifestUrl),
        apps.preflight(manifestUrl, undefined, projectId),
      ]);
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
    const hasBinding = bindings[r.role] != null && bindings[r.role] !== 0;
    if (hasBinding) return false;
    const intent = intents[r.role];
    if (intent && intent.kind === "install_app") return false;
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
  const canInstall =
    !!preview &&
    requiredRolesUnbound.length === 0 &&
    requiredFieldsUnfilled.length === 0;

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
    <Modal open={open} onClose={onClose} width="max-w-lg">
      {/* flex-1 + overflow-y-auto keeps the body scrollable inside the
          Modal's max-h-[90vh] container — the Preview-and-configure step
          can grow tall once integration credential forms expand. */}
      <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
        <h3 className="text-text text-base font-bold">Install an app</h3>

        {!preview ? (
          <>
            <label className="block">
              <span className="text-text-muted text-xs">Manifest URL</span>
              <input
                type="text"
                value={manifestUrl}
                onChange={(e) => setManifestUrl(e.target.value)}
                placeholder="https://raw.githubusercontent.com/apteva/app-tasks/main/apteva.yaml"
                className="w-full mt-1 bg-bg-input border border-border rounded px-2 py-1.5 text-sm text-text font-mono focus:outline-none focus:border-accent"
              />
            </label>
            {error && <div className="text-red text-xs">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-text-muted hover:text-text">
                Cancel
              </button>
              <button
                onClick={doPreview}
                disabled={!manifestUrl || previewing}
                className="px-3 py-1.5 text-sm bg-accent text-bg rounded font-bold disabled:opacity-50"
              >
                {previewing ? "Loading…" : "Preview →"}
              </button>
            </div>
          </>
        ) : (
          <PreviewAndConfigure
            preview={preview}
            preflight={preflight}
            bindings={bindings}
            setBindings={setBindings}
            intents={intents}
            setIntents={setIntents}
            canInstall={canInstall}
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
            onBack={() => { setPreview(null); setPreflight(null); setIntents({}); }}
            onConfirm={doInstall}
          />
        )}
      </div>
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
type RoleIntent =
  | { kind: "connect"; slug: string; name: string; creds: Record<string, string>; authType: string }
  | { kind: "install_app"; manifestUrl: string; appName: string }
  // "connect_integration" is the placeholder optedIn state for an
  // optional kind=integration role with no existing candidates. We
  // can't set a value yet (the connection doesn't exist) and there's
  // no work to defer to the parent Install handler — the inline
  // <InlineConnectIntegration> form below creates the connection
  // synchronously and replaces this with a real value via onChange.
  // Without this kind, the checkbox visually toggles but the
  // controlled `checked={optedIn}` snaps it right back to false.
  | { kind: "connect_integration" };

function bindingIDs(value: AppBindingValue | undefined): number[] {
  if (value == null) return [];
  if (typeof value === "number") return value > 0 ? [value] : [];
  return Array.isArray(value.ids) ? value.ids.filter((id) => id > 0) : [];
}

function bindingDefaultID(value: AppBindingValue | undefined): number | undefined {
  const ids = bindingIDs(value);
  if (ids.length === 0) return undefined;
  if (value && typeof value === "object" && value.default_id && ids.includes(value.default_id)) {
    return value.default_id;
  }
  return ids[0];
}

function hasBindingSelection(value: AppBindingValue | undefined): boolean {
  return bindingIDs(value).length > 0;
}

function multiBinding(ids: number[], defaultID?: number): AppBindingValue {
  const unique = Array.from(new Set(ids.filter((id) => id > 0)));
  if (unique.length === 0) return null;
  const chosenDefault = defaultID && unique.includes(defaultID) ? defaultID : unique[0];
  return { ids: unique, default_id: chosenDefault };
}

function addBindingSelection(value: AppBindingValue | undefined, id: number, multiple: boolean): AppBindingValue {
  if (!multiple) return id;
  return multiBinding([...bindingIDs(value), id], bindingDefaultID(value) || id);
}

// RolePicker — one row per requires.integrations entry. Three states:
//
//   1. has candidates → select (auto-picked first one)
//   2. no candidates, kind=integration → inline credential form;
//      typing fields STORES an intent on the parent — the actual
//      /connections POST fires only when the main Install button
//      is clicked
//   3. no candidates, kind=app → opting in stores an install intent;
//      the dep app is installed before the parent on Install click
//
// Visual: subtle border in all states (no yellow highlight); the
// required/optional pill is the only emphasis on importance.
function RolePicker({
  role,
  value,
  onChange,
  intent,
  setIntent,
  projectId,
  onConnected,
}: {
  role: PreflightRole;
  value: AppBindingValue;
  onChange: (v: AppBindingValue) => void;
  intent: RoleIntent | null;
  setIntent: (i: RoleIntent | null) => void;
  projectId?: string;
  onConnected: (connId: number) => void;
}) {
  const cands =
    role.kind === "integration" ? role.integration_candidates || [] : role.app_candidates || [];
  const multiple = role.mode === "multiple";
  const hasCands = cands.length > 0;
  const optedIn = !role.required && (hasBindingSelection(value) || intent != null);
  // kind=integration: synchronous Connect button before parent install
  // kind=app: stores an intent, parent install handler resolves it
  const showCredentialForm =
    role.kind === "integration" && !hasCands && (role.required || optedIn);
  const showAppOptInHint =
    role.kind === "app" && !hasCands && (role.required || optedIn);

  const label = role.label || role.role;

  return (
    <div className="border border-border rounded p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        {!role.required && (
          <input
            type="checkbox"
            checked={optedIn}
            onChange={(e) => {
              if (e.target.checked) {
                if (hasCands) {
                  const c = cands[0] as PreflightConnectionCandidate | PreflightAppCandidate;
                  const id = "connection_id" in c ? c.connection_id : c.install_id;
                  onChange(multiple ? multiBinding([id], id) : id);
                } else if (role.kind === "app") {
                  // Set install_app intent; the parent's Install
                  // handler runs the install before the parent.
                  setIntent({
                    kind: "install_app",
                    manifestUrl: "",
                    appName: (role.compatible || [])[0] || "",
                  });
                } else {
                  // kind=integration with no candidate: stash a
                  // placeholder intent so optedIn flips true and the
                  // <InlineConnectIntegration> form below renders.
                  // onConnected (parent) replaces this intent with a
                  // real connection_id when the form submits.
                  setIntent({ kind: "connect_integration" });
                }
              } else {
                onChange(null);
                setIntent(null);
              }
            }}
          />
        )}
        <span className="text-text font-medium">{label}</span>
        {role.required ? (
          <span className="text-text-dim text-[10px] uppercase tracking-wide">required</span>
        ) : (
          <span className="text-text-dim text-[10px] uppercase tracking-wide">optional</span>
        )}
        {role.capabilities && role.capabilities.length > 0 && (
          <span className="ml-auto text-text-dim text-[10px] truncate" title={role.capabilities.join(", ")}>
            {role.capabilities.join(", ")}
          </span>
        )}
      </div>

      {role.hint && !showCredentialForm && !showAppOptInHint && (
        <div className="text-text-muted text-[11px]">{role.hint}</div>
      )}

      {hasCands && (role.required || optedIn) && !multiple && (
        <select
          value={typeof value === "number" ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || null)}
          className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs text-text"
        >
          {role.kind === "integration"
            ? (role.integration_candidates || []).map((c) => (
                <option key={c.connection_id} value={c.connection_id}>
                  {c.name} ({c.app_slug})
                  {c.scope === "global" ? " · global" : ""}
                </option>
              ))
            : (role.app_candidates || []).map((c) => (
                <option key={c.install_id} value={c.install_id}>
                  {c.display_name}
                </option>
              ))}
        </select>
      )}

      {hasCands && (role.required || optedIn) && multiple && (
        <div className="space-y-2">
          <div className="grid gap-1.5">
            {cands.map((c) => {
              const id = "connection_id" in c ? c.connection_id : c.install_id;
              const selected = bindingIDs(value).includes(id);
              return (
                <label
                  key={id}
                  className="flex items-center gap-2 text-xs text-text border border-border rounded px-2 py-1.5 bg-bg-input"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => {
                      const ids = bindingIDs(value);
                      const next = e.target.checked ? [...ids, id] : ids.filter((x) => x !== id);
                      onChange(multiBinding(next, bindingDefaultID(value)));
                    }}
                  />
                  <span className="truncate">
                    {"connection_id" in c
                      ? `${c.name} (${c.app_slug}${c.scope === "global" ? " · global" : ""})`
                      : c.display_name}
                  </span>
                </label>
              );
            })}
          </div>
          {bindingIDs(value).length > 1 && (
            <label className="grid gap-1 text-[11px] text-text-muted">
              Default
              <select
                value={bindingDefaultID(value) || bindingIDs(value)[0] || 0}
                onChange={(e) => onChange(multiBinding(bindingIDs(value), Number(e.target.value)))}
                className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs text-text"
              >
                {cands
                  .filter((c) => bindingIDs(value).includes("connection_id" in c ? c.connection_id : c.install_id))
                  .map((c) => {
                    const id = "connection_id" in c ? c.connection_id : c.install_id;
                    return (
                      <option key={id} value={id}>
                        {"connection_id" in c ? `${c.name} (${c.app_slug})` : c.display_name}
                      </option>
                    );
                  })}
              </select>
            </label>
          )}
        </div>
      )}

      {/* No candidates, kind=integration → embedded form with a Connect
          button that fires before the main install. */}
      {showCredentialForm && (
        <InlineConnectIntegration
          slugs={role.compatible || []}
          projectId={projectId}
          onConnected={onConnected}
        />
      )}

      {/* No candidates, kind=app → opting in queues an install_app
          intent; resolved when the user clicks the main Install. */}
      {showAppOptInHint && (
        <div className="text-text-muted text-[11px]">
          {(role.compatible || [])[0]} will be installed when you click Install.
        </div>
      )}
    </div>
  );
}

// InlineConnectIntegration — embedded credential form with an
// explicit Connect button. The connection is created BEFORE the
// parent install fires (vs. the kind=app path which waits and
// installs the dep alongside the parent).
//
// Why split the two: connections often involve sensitive creds the
// operator wants to verify land + work before committing to the
// rest of the install. Once the connection exists in the project,
// the parent install proceeds with a clean binding. Apps (kind=app)
// don't have that round-trip — registry → install is a deterministic
// sequence with no per-call surprises, so bundling it into the
// parent Install button is the right call.
function InlineConnectIntegration({
  slugs,
  projectId,
  onConnected,
}: {
  slugs: string[];
  projectId?: string;
  onConnected: (connId: number) => void;
}) {
  const [chosenSlug, setChosenSlug] = useState(slugs[0] || "");
  const [detail, setDetail] = useState<AppDetail | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!chosenSlug) return;
    setDetail(null);
    integrations.app(chosenSlug)
      .then((d) => {
        setDetail(d);
        if (!name) setName(d.name);
      })
      .catch((e) => setError(e?.message || "load failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenSlug]);

  const submit = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const types = detail.auth?.types || [];
      const authType = types.find((t) => t !== "oauth2") || types[0] || "api_key";
      const result = await integrations.connect(
        detail.slug,
        name.trim() || detail.name,
        creds,
        authType,
        projectId,
        undefined,
        "app_install",
      );
      const conn = result as { id?: number; connection?: { id: number } };
      const id = conn.id || conn.connection?.id;
      if (!id) {
        setError("connection created but id missing in response");
        return;
      }
      onConnected(id);
    } catch (e: any) {
      setError(e?.message || "connect failed");
    } finally {
      setBusy(false);
    }
  };

  if (!detail) {
    return <div className="text-text-dim text-[11px]">Loading {chosenSlug}…</div>;
  }
  if (!detail.auth?.credential_fields?.length) {
    return (
      <div className="text-red text-[11px]">
        {detail.name} requires OAuth — connect it once from the Integrations page, then come back here.
      </div>
    );
  }

  return (
    <div className="bg-bg-input border border-border rounded p-2 space-y-2">
      {slugs.length > 1 && (
        <select
          value={chosenSlug}
          onChange={(e) => setChosenSlug(e.target.value)}
          className="w-full bg-bg border border-border rounded px-2 py-1 text-[11px]"
        >
          {slugs.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <div className="text-[11px] text-text-muted">
        Credentials for {detail.name} — encrypted server-side, never sent to the app process.
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="connection name"
        className="w-full bg-bg border border-border rounded px-2 py-1 text-[11px]"
      />
      {detail.auth.credential_fields.map((f) => (
        <div key={f.name}>
          <label className="text-text-dim text-[10px]">{f.label || f.name}</label>
          <input
            type="password"
            value={creds[f.name] || ""}
            onChange={(e) => setCreds({ ...creds, [f.name]: e.target.value })}
            className="w-full bg-bg border border-border rounded px-2 py-1 text-[11px] font-mono"
          />
          {f.description && <div className="text-text-dim text-[10px] mt-0.5">{f.description}</div>}
        </div>
      ))}
      {error && <div className="text-red text-[10px]">{error}</div>}
      <button
        onClick={submit}
        disabled={busy}
        className="w-full px-2 py-1 text-[11px] bg-accent text-bg rounded font-bold disabled:opacity-50"
      >
        {busy ? "Connecting…" : `Connect ${detail.name}`}
      </button>
    </div>
  );
}

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
  setBindings: (b: Record<string, AppBindingValue>) => void;
  intents: Record<string, RoleIntent | null>;
  setIntents: (i: Record<string, RoleIntent | null>) => void;
  canInstall: boolean;
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
  return (
    <div className="space-y-3">
      <div className="border border-border rounded p-3">
        <div className="flex items-center gap-2">
          <span className="text-text font-bold">{m.display_name || m.name}</span>
          <span className="text-text-dim text-xs">v{m.version}</span>
        </div>
        <p className="text-text-muted text-xs mt-1">{m.description}</p>
      </div>

      {m.requires.permissions?.length > 0 && (
        <div>
          <div className="text-text-muted text-xs mb-1">Permissions requested:</div>
          <ul className="space-y-1">
            {m.requires.permissions.map((p) => (
              <li key={p} className="text-text text-xs flex items-center gap-1.5">
                <span className="text-yellow">●</span>
                <span className="font-mono">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.scopes.length > 0 && (
        <div>
          <div className="text-text-muted text-xs mb-1">Install scope</div>
          {m.scopes.length > 1 ? (
            <div className="flex gap-2">
              {(["project", "global"] as const).map((s) =>
                m.scopes.includes(s) ? (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`px-3 py-1 text-xs rounded border ${
                      scope === s
                        ? "border-accent text-accent bg-accent/10"
                        : "border-border text-text-muted"
                    }`}
                  >
                    {s}
                  </button>
                ) : null,
              )}
            </div>
          ) : (
            // Single-scope app: show as a non-interactive label so the
            // operator knows what's about to happen instead of the
            // picker silently disappearing.
            <div className="text-text-muted text-xs">
              <span className="px-2 py-0.5 rounded border border-border bg-bg-muted font-mono">
                {m.scopes[0]}
              </span>
              <span className="ml-2 italic">
                this app only supports {m.scopes[0]} scope
              </span>
            </div>
          )}
        </div>
      )}

      {/* Required-config fields. Optional fields land in the
          post-install Settings panel — keeping the install modal
          short. Field is "required" when:
            - field.required is true, OR
            - field.required_if_role_bound names a role that has a
              non-null binding above.
          Renderer also handles type=select_from_integration which
          fetches options from the bound connection (e.g. R2's
          list_buckets) so the bucket field becomes a dropdown of
          real buckets the moment the operator binds backend. */}
      <RequiredConfigFields
        manifest={m}
        bindings={bindings}
        config={config}
        setConfig={setConfig}
      />

      {/* Integration role pickers — one per requires.integrations entry.
          Required roles must be bound; optional roles render a checkbox. */}
      {preflight && preflight.roles.length > 0 && (
        <div className="border border-border rounded p-3 space-y-3">
          <div className="text-text-muted text-xs">Dependencies</div>
          {preflight.roles.map((r) => (
            <RolePicker
              key={r.role}
              role={r}
              value={bindings[r.role] ?? null}
              onChange={(v) => setBindings({ ...bindings, [r.role]: v })}
              intent={intents[r.role] ?? null}
              setIntent={(i) => setIntents({ ...intents, [r.role]: i })}
              projectId={projectId}
              onConnected={async (connId) => {
                // Connection just landed in the DB. Refresh
                // candidates so the role's select can pick it; then
                // bind it explicitly so the operator sees the new
                // option pre-selected.
                await refetchPreflight();
                setBindings({
                  ...bindings,
                  [r.role]: addBindingSelection(bindings[r.role], connId, r.mode === "multiple"),
                });
              }}
            />
          ))}
        </div>
      )}

      {error && <div className="text-red text-xs">{error}</div>}

      <div className="flex justify-between items-center pt-2">
        <button onClick={onBack} className="text-text-muted text-xs hover:text-text">
          ← back
        </button>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={installing || !canInstall}
            title={canInstall ? "" : "Bind all required dependencies first"}
            className="px-3 py-1.5 text-sm bg-accent text-bg rounded font-bold disabled:opacity-50"
          >
            {installing ? installStep || "Installing…" : "Install"}
          </button>
        </div>
      </div>
      <p className="text-text-dim text-[10px]">
        Apteva clones the repo and runs <code>go build</code> on this host.
        First install of a version takes ~30–60s while dependencies download;
        subsequent installs are cached. Status will flip to{" "}
        <code>running</code> once the sidecar passes its health check.
      </p>
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
function requiredConfigFields(
  manifest: AppManifestV2,
  bindings: Record<string, AppBindingValue>,
): AppConfigField[] {
  const out: AppConfigField[] = [];
  for (const f of manifest.config_schema || []) {
    if (f.required) {
      out.push(f);
      continue;
    }
    if (f.required_if_role_bound) {
      const v = bindings[f.required_if_role_bound];
      if (hasBindingSelection(v)) out.push(f);
    }
  }
  return out;
}

function RequiredConfigFields({
  manifest,
  bindings,
  config,
  setConfig,
}: {
  manifest: AppManifestV2;
  bindings: Record<string, AppBindingValue>;
  config: Record<string, string>;
  setConfig: (c: Record<string, string>) => void;
}) {
  const fields = requiredConfigFields(manifest, bindings);
  if (fields.length === 0) return null;

  const update = (name: string, val: string) =>
    setConfig({ ...config, [name]: val });

  return (
    <div className="border border-border rounded p-3 space-y-3">
      <div className="text-text-muted text-xs">Configuration</div>
      {fields.map((f) => {
        const value = config[f.name] ?? f.default ?? "";
        const label = f.label || f.name;
        return (
          <div key={f.name} className="space-y-1">
            <label className="text-text text-xs flex items-center gap-2">
              <span>{label}</span>
              <span className="text-red text-[10px]">required</span>
            </label>
            <ConfigFieldInput
              field={f}
              value={value}
              onChange={(v) => update(f.name, v)}
              bindings={bindings}
            />
            {f.description && (
              <div className="text-text-dim text-[11px]">{f.description}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ConfigFieldInput dispatches on f.type. Unknown types fall back to
// a plain text input so a future manifest with a new type doesn't
// hard-crash an older dashboard — it just downgrades to manual entry.
function ConfigFieldInput({
  field,
  value,
  onChange,
  bindings,
}: {
  field: AppConfigField;
  value: string;
  onChange: (v: string) => void;
  bindings: Record<string, AppBindingValue>;
}) {
  switch (field.type) {
    case "password":
      return (
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        />
      );
    case "select":
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        >
          <option value="">(choose…)</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "select_from_integration":
      return (
        <IntegrationDiscoverySelect
          field={field}
          value={value}
          onChange={onChange}
          connectionId={
            field.integration_role ? bindingDefaultID(bindings[field.integration_role]) ?? null : null
          }
        />
      );
    case "select_from_app":
      return (
        <AppDiscoverySelect
          field={field}
          value={value}
          onChange={onChange}
        />
      );
    case "toggle":
      return (
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
      );
    case "text":
    default:
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
        />
      );
  }
}

// IntegrationDiscoverySelect — type=select_from_integration. Reads
// the connection bound to field.integration_role, fires
// discovery.tool against it, parses the response per response_path,
// renders a <select>. On any failure (no binding, upstream 4xx/5xx,
// empty result) AND field.fallback === "text", collapses to a
// regular text input with an info banner so the operator can
// type the value manually. The most common failure mode in the
// wild is bucket-scoped tokens that can't list_buckets — we hit
// that against R2 in v0.13 — so the manual-fallback path is the
// expected branch, not the unhappy one.
function IntegrationDiscoverySelect({
  field,
  value,
  onChange,
  connectionId,
}: {
  field: AppConfigField;
  value: string;
  onChange: (v: string) => void;
  connectionId: number | null | undefined;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    setOptions(null);
    setErr("");
    if (!connectionId || !field.discovery?.tool) return;
    setLoading(true);
    integrations
      .execute(connectionId, field.discovery.tool, {})
      .then((res) => {
        if (!res.success) {
          // Pull the response body into a string for two purposes:
          //   1. Pattern-match S3-compat AccessDenied so we can show
          //      a friendly "your token is bucket-scoped" message
          //      instead of the raw "HTTP 403" the operator can't act
          //      on. This is the v0.13 health-check insight applied at
          //      install time — same Cloudflare R2 token that returns
          //      ✓ green on the connection Test button (because the
          //      catalog's auth_ok_when_body_contains absorbs it) will
          //      land here at install time too. Don't auto-pass;
          //      list_buckets actually CAN'T list, so the dropdown
          //      really does need to fall back to manual entry. Just
          //      make the explanation legible.
          //   2. Include the upstream's literal error in the
          //      tooltip when it isn't AccessDenied — operators
          //      shouldn't have to dig through server logs to
          //      learn it was, say, an InvalidAccessKeyId typo.
          const body = stringifyExecuteData(res.data);
          if (res.status === 403 && /AccessDenied|access[\s_-]?denied/i.test(body)) {
            throw new Error(
              "your token can't list (bucket-scoped) — type the bucket name below",
            );
          }
          if (res.status === 401) {
            throw new Error("auth rejected (HTTP 401) — check the connection's credentials");
          }
          const trim = body.length > 120 ? body.slice(0, 120) + "…" : body;
          throw new Error(`HTTP ${res.status}: ${trim}`);
        }
        const items = pluckList(res.data, field.discovery?.response_path || "");
        const opts = items.map((it) => {
          const v = pluckField(it, field.discovery?.value_field || "");
          const l = pluckField(it, field.discovery?.label_field || "");
          return { value: v, label: l || v };
        }).filter((o) => o.value !== "");
        setOptions(opts);
      })
      .catch((e) => {
        setErr(e?.message || "discovery failed");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, field.discovery?.tool]);

  // No binding yet: nudge the operator to bind first.
  if (!connectionId) {
    return (
      <div className="text-text-dim text-[11px] italic">
        Bind an integration above to populate this list.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-text-dim text-[11px]">Loading options…</div>
    );
  }

  // Discovery failed (auth scope, network, malformed response) —
  // fall back to text input if the catalog opted in.
  const hasOptions = options && options.length > 0;
  const showFallback = !hasOptions && field.fallback === "text";

  if (showFallback) {
    // Order: explain WHY first (so the operator reads context before
    // the empty input box), then the input, then a tiny secondary
    // hint. Pre-fix this rendered input-then-warning, which on a
    // freshly-bound R2 looked like an empty form with a yellow
    // line below — easy to miss the input field entirely.
    return (
      <>
        <div className="text-yellow text-[11px] leading-snug">
          {err
            ? `Couldn't auto-list options: ${err}.`
            : "No options returned — enter the value manually."}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            field.name === "s3_bucket"
              ? "my-bucket-name"
              : "value"
          }
          className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
          autoFocus
        />
      </>
    );
  }

  if (!hasOptions) {
    // No fallback declared. Show the error and disable.
    return (
      <div className="text-red text-[11px]">
        {err || "No options returned by discovery."}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-card border border-border rounded px-2 py-1 text-sm"
    >
      <option value="">(choose…)</option>
      {options!.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}


// stringifyExecuteData renders the integration runner's response
// `data` field as a string we can substring-match for error
// patterns (AccessDenied, InvalidAccessKeyId, etc.). The runner
// returns either a parsed object (JSON APIs), a parsed map (XML
// → S3-style), or an already-stringified body. We coerce to
// string defensively so the discovery error path can pattern-
// match without caring about the upstream's content type.
function stringifyExecuteData(data: any): string {
  if (data == null) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

// pluckList walks a JSON path through `data`, returning whatever's
// at the end as an array. Path uses "." to descend object keys;
// missing keys → []. The runner's response shape is the integration
// tool's literal response (parsed JSON for REST, parsed XML for
// S3-style services), so we deliberately don't normalise — the
// catalog author writes the path matching the literal upstream
// response. Empty path = use `data` itself.
function pluckList(data: any, path: string): any[] {
  if (!path) {
    return Array.isArray(data) ? data : [];
  }
  let cur: any = data;
  for (const seg of path.split(".")) {
    if (cur == null) return [];
    cur = cur[seg];
  }
  if (cur == null) return [];
  return Array.isArray(cur) ? cur : [cur]; // single-item upstreams sometimes drop the array wrapper
}

// pluckField extracts one named field from an item; empty path
// returns the item itself if it's a string. Mirrors the lenient
// shape the catalog authors expect.
function pluckField(item: any, field: string): string {
  if (!field) {
    return typeof item === "string" ? item : "";
  }
  const v = item?.[field];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
