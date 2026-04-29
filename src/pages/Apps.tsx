import { useState, useEffect } from "react";
import { apps, type AppRow, type AppPreview, type MarketplaceEntry } from "../api";
import { useProjects } from "../hooks/useProjects";
import { Modal } from "../components/Modal";
import { AppSurfaceBadges } from "../components/apps/AppSurfaceBadges";
import { AppDetailPanel } from "../components/apps/AppDetailPanel";

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
      .then(setRows)
      .catch((e) => setError(e.message || "failed"))
      .finally(() => setLoading(false));
  };

  const refreshMarketplace = () => {
    setLoading(true);
    apps
      .marketplace()
      .then((r) => {
        setMarketplace(r.apps);
        setRegistryURL(r.registry_url);
      })
      .catch((e) => setError(e.message || "failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === "installed") refreshInstalled();
    else refreshMarketplace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, currentProject?.id]);

  // While any install is mid-build, poll every 2s so the dashboard
  // shows the live phase string ("Cloning…", "Building…", "Starting…")
  // and flips to running/error without a manual refresh.
  useEffect(() => {
    if (tab !== "installed") return;
    const anyPending = rows.some((r) => r.status === "pending");
    // 1s while pending so the live status_message (Downloading X /
    // Building: Y / Linking…) the supervisor pushes from `go build`
    // output appears responsive instead of stuck.
    if (!anyPending) return;
    const id = setInterval(() => {
      apps.list(currentProject?.id).then(setRows).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [tab, rows, currentProject?.id]);

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {rows.map((r) => (
              <AppCard
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
          setInstallModal(null);
          if (tab === "installed") refreshInstalled();
          else refreshMarketplace();
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
  if (loading) return <div className="text-text-dim text-sm">Loading marketplace…</div>;
  if (entries.length === 0) {
    return (
      <div className="border border-border rounded-lg p-8 text-center">
        <p className="text-text-muted text-sm">Marketplace is empty.</p>
        <p className="text-text-dim text-xs mt-1">Configured registry: <span className="font-mono">{registryURL}</span></p>
      </div>
    );
  }
  // Group by category for a tidier layout.
  const byCategory: Record<string, MarketplaceEntry[]> = {};
  entries.forEach((e) => {
    const k = e.category || "other";
    (byCategory[k] = byCategory[k] || []).push(e);
  });
  const order = Object.keys(byCategory).sort();
  return (
    <div className="space-y-5">
      {order.map((cat) => (
        <div key={cat}>
          <div className="text-text-muted text-xs uppercase tracking-wide mb-2">{cat}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {byCategory[cat].map((e) => (
              <MarketplaceCard
                key={e.name}
                entry={e}
                onInstall={() => onInstall(e)}
                onOpenDetails={() => onOpenDetails(e)}
              />
            ))}
          </div>
        </div>
      ))}
      <p className="text-text-dim text-[10px]">Registry: <span className="font-mono">{registryURL}</span></p>
    </div>
  );
}

function MarketplaceCard({
  entry, onInstall, onOpenDetails,
}: {
  entry: MarketplaceEntry;
  onInstall: () => void;
  onOpenDetails: () => void;
}) {
  // Card body is clickable → opens the side panel. Action buttons
  // stop propagation so install / repo don't accidentally open it too.
  return (
    <div
      className="border border-border rounded-lg p-3 flex items-start gap-3 cursor-pointer hover:border-border-strong transition-colors"
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
      <AppIcon url={entry.icon} name={entry.display_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text font-medium">{entry.display_name}</span>
          <span className="text-text-dim text-xs">v{entry.version}</span>
          {entry.official && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue">official</span>}
          {entry.builtin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue">built-in</span>}
          {entry.installed && !entry.builtin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green">installed</span>}
        </div>
        <p className="text-text-muted text-xs mt-1 line-clamp-2">{entry.description}</p>
        <AppSurfaceBadges surfaces={entry.surfaces} className="mt-2" />
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onInstall}
          disabled={entry.installed}
          title={entry.builtin ? "Bundled into apteva-server — always available" : ""}
          className="px-2 py-1 border border-accent rounded text-[11px] text-accent hover:bg-accent hover:text-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {entry.builtin ? "built-in" : entry.installed ? "installed" : "install"}
        </button>
        <a
          href={entry.repo}
          target="_blank"
          rel="noopener noreferrer"
          className="px-2 py-1 text-[11px] text-text-muted hover:text-text text-center"
        >
          repo ↗
        </a>
      </div>
    </div>
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

  const statusColor =
    app.status === "running"
      ? "bg-green/15 text-green"
      : app.status === "error"
        ? "bg-red/15 text-red"
        : app.status === "disabled"
          ? "bg-border text-text-dim"
          : "bg-yellow/15 text-yellow";

  return (
    <div
      className="border border-border rounded-lg p-3 flex items-start gap-3 cursor-pointer hover:border-border-strong transition-colors"
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
      <AppIcon url={app.icon} name={app.display_name} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text font-medium">{app.display_name}</span>
          <span className="text-text-dim text-xs">v{app.version}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor}`}>{app.status}</span>
          {app.project_id ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent" title={`project ${app.project_id}`}>
              project
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-border text-text-muted" title="server-wide install">
              global
            </span>
          )}
          {app.source === "builtin" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue">builtin</span>
          )}
        </div>
        {app.status === "pending" ? (
          <p className="text-accent text-xs mt-1 italic flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
            <span className="truncate">{app.status_message || "Installing…"}</span>
          </p>
        ) : app.status === "error" && app.error_message ? (
          <p className="text-red text-xs mt-1 line-clamp-2" title={app.error_message}>{app.error_message}</p>
        ) : (
          <p className="text-text-muted text-xs mt-1 line-clamp-2">{app.description}</p>
        )}
        <AppSurfaceBadges surfaces={app.surfaces} className="mt-2" />
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
        {showMount ? (
          <span className="flex items-center gap-1 bg-accent/10 border border-accent/40 rounded px-2 py-1 flex-wrap max-w-[280px]">
            <input
              type="text"
              value={mountUrl}
              onChange={(e) => setMountUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              className="flex-1 min-w-[160px] bg-bg-input border border-border rounded px-1 py-0.5 text-[11px] font-mono text-text"
            />
            <button onClick={mount} disabled={busy} className="text-[10px] text-accent font-medium hover:underline disabled:opacity-50">
              {busy ? "…" : "mount"}
            </button>
            <button onClick={() => setShowMount(false)} disabled={busy} className="text-[10px] text-text-muted hover:text-text">cancel</button>
            {mountError && <span className="basis-full text-[10px] text-red">{mountError}</span>}
          </span>
        ) : confirmRemove ? (
          <span className="flex items-center gap-1 bg-red/10 border border-red/40 rounded px-2 py-1">
            <button
              onClick={remove}
              disabled={busy}
              className="text-[10px] text-red font-medium hover:underline disabled:opacity-50"
            >
              {busy ? "…" : "confirm"}
            </button>
            <button
              onClick={() => setConfirmRemove(false)}
              disabled={busy}
              className="text-[10px] text-text-muted hover:text-text"
            >
              cancel
            </button>
          </span>
        ) : (
          <>
            {(app.status === "pending" || app.status === "disabled" || app.status === "error") && app.source !== "builtin" && (
              <button
                onClick={() => setShowMount(true)}
                className="px-2 py-1 border border-accent rounded text-[11px] text-accent hover:bg-accent hover:text-bg transition-colors"
                title="Mount a running sidecar by URL (local dev). For orchestrator-deployed apps this is set automatically."
              >
                mount…
              </button>
            )}
            {app.status === "running" && (
              <button
                onClick={disable}
                disabled={busy}
                className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-yellow hover:border-yellow transition-colors"
              >
                disable
              </button>
            )}
            {app.source !== "builtin" && (
              <button
                onClick={() => setConfirmRemove(true)}
                className="px-2 py-1 border border-border rounded text-[11px] text-text-muted hover:text-red hover:border-red transition-colors"
              >
                uninstall
              </button>
            )}
          </>
        )}
      </div>
    </div>
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
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<"project" | "global">("project");

  // When the modal opens with a marketplace-pre-filled URL, kick off
  // preview automatically — saves a click and matches "install from
  // marketplace card" intent.
  useEffect(() => {
    if (open && initialManifestUrl && initialManifestUrl !== manifestUrl) {
      setManifestUrl(initialManifestUrl);
      setPreview(null);
      // Trigger preview after URL state settles.
      setTimeout(() => {
        setPreviewing(true);
        apps.preview(initialManifestUrl)
          .then((p) => setPreview(p))
          .catch((e) => setError(e.message || "preview failed"))
          .finally(() => setPreviewing(false));
      }, 0);
    }
    if (!open) {
      // Reset when closed so the next open is clean.
      setManifestUrl("");
      setPreview(null);
      setError("");
      setConfig({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialManifestUrl]);

  const reset = () => {
    setManifestUrl("");
    setPreview(null);
    setError("");
    setConfig({});
  };

  const doPreview = async () => {
    setError("");
    setPreviewing(true);
    try {
      const p = await apps.preview(manifestUrl);
      setPreview(p);
    } catch (e: any) {
      setError(e.message || "preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const doInstall = async () => {
    if (!preview) return;
    setError("");
    setInstalling(true);
    try {
      await apps.install({
        manifestUrl,
        projectId: scope === "global" ? "" : projectId,
        config,
      });
      reset();
      onInstalled();
    } catch (e: any) {
      setError(e.message || "install failed");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width="max-w-lg">
      <div className="p-5 space-y-4">
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
            scope={scope}
            setScope={setScope}
            config={config}
            setConfig={setConfig}
            error={error}
            installing={installing}
            onBack={() => setPreview(null)}
            onConfirm={doInstall}
          />
        )}
      </div>
    </Modal>
  );
}

function PreviewAndConfigure({
  preview,
  scope,
  setScope,
  config,
  setConfig,
  error,
  installing,
  onBack,
  onConfirm,
}: {
  preview: AppPreview;
  scope: "project" | "global";
  setScope: (s: "project" | "global") => void;
  config: Record<string, string>;
  setConfig: (c: Record<string, string>) => void;
  error: string;
  installing: boolean;
  onBack: () => void;
  onConfirm: () => void;
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

      {m.scopes.length > 1 && (
        <div>
          <div className="text-text-muted text-xs mb-1">Install scope</div>
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
        </div>
      )}

      {/* Config schema rendering — minimal: text fields. Richer types
          (gdrive_sheet picker, etc.) come once the catalog ships. */}
      {/* For preview/v1 we just rely on the user pasting values. */}

      {error && <div className="text-red text-xs">{error}</div>}

      <div className="flex justify-between items-center pt-2">
        <button onClick={onBack} className="text-text-muted text-xs hover:text-text">
          ← back
        </button>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            disabled={installing}
            className="px-3 py-1.5 text-sm bg-accent text-bg rounded font-bold disabled:opacity-50"
          >
            {installing ? "Installing…" : "Install"}
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
