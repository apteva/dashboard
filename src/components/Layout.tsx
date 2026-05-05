import { NavLink, Outlet } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useProjects } from "../hooks/useProjects";
import { useAuth } from "../hooks/useAuth";
import { AccountMenu } from "./AccountMenu";
import { NotificationsTray } from "./NotificationsTray";
import { startChatNotifications } from "../state/chatNotifications";
import { chatConnections } from "../state/chatConnections";
import { apps, platform, type PlatformStatus } from "../api";

export function Layout() {
  const [version, setVersion] = useState("");
  const [versionTip, setVersionTip] = useState("");
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { projects, currentProject, setCurrentProject } = useProjects();
  const { user, logout } = useAuth();

  // Boot the global notifications source once the user is logged in.
  //
  // We deliberately do NOT call chatConnections.stopAll() in cleanup.
  // React StrictMode in dev double-fires this effect (mount → cleanup →
  // remount), and tearing down the per-chat SSEs on every cleanup
  // pass would emit a [chat] user disconnected event to the agent and
  // immediately reconnect — confusing the agent's channel-availability
  // reasoning. SSEs are torn down naturally when the browser tab
  // closes; explicit logout calls chatConnections.stopAll() directly
  // (see the logout button below).
  //
  // The notifications driver (startChatNotifications) is safe to bounce
  // — its cleanup is just an SSE close + localStorage listener removal,
  // no agent-visible side effects.
  useEffect(() => {
    if (!user || user === false) return;
    const stopNotifs = startChatNotifications();
    chatConnections.resumeFromStorage();
    return () => {
      stopNotifs();
    };
  }, [user]);

  // Logout teardown — when user transitions from authenticated to false,
  // close every open chat SSE so the agent sees the user as gone.
  // Distinct from the StrictMode-induced cleanup above which preserves
  // connections.
  useEffect(() => {
    if (user === false) {
      chatConnections.stopAll();
    }
  }, [user]);

  // Pull the platform-update status so the sidebar version footer can
  // show "update available" inline with the current version. The
  // server polls upstream every few hours; we re-read on dashboard
  // load so a refresh after an update lands shows the new state.
  useEffect(() => {
    if (!user || user === false) return;
    platform.status().then(setPlatformStatus).catch(() => {});
  }, [user]);

  const refreshPlatformStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await platform.refresh();
      setPlatformStatus(next);
    } catch {
      /* keep last view; error surfaces server-side in `error` field */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // /version now returns the full component breakdown — apteva (umbrella),
    // cli, dashboard, integrations, core, plus the build timestamp.
    // Display the umbrella in the sidebar footer; hover to see the full
    // breakdown via title. Fall back to the old `version` field for
    // older server binaries that haven't shipped the new handler yet.
    fetch("/version")
      .then((r) => r.json())
      .then((d) => {
        // Show the CLI version as the primary label — that's the one that
        // gets bumped per release (apteva/package.json). Fall back to the
        // umbrella/package version for older server binaries that predate
        // this change.
        const primary = d.cli || d.apteva || d.version || "";
        setVersion(primary);
        const parts: string[] = [];
        if (d.apteva) parts.push(`apteva ${d.apteva}`);
        if (d.cli) parts.push(`cli ${d.cli}`);
        if (d.dashboard) parts.push(`dashboard ${d.dashboard}`);
        if (d.integrations) parts.push(`integrations ${d.integrations}`);
        if (d.core) parts.push(`core ${d.core}`);
        if (d.build) parts.push(`build ${d.build}`);
        setVersionTip(parts.join("\n"));
      })
      .catch(() => {});
  }, []);

  // Sidebar is split into three semantic groups so the user can tell
  // platform-built surfaces from installed-app surfaces at a glance:
  //
  //   primaryNav — the dashboard's daily verbs (no section label;
  //                this group IS the platform's default home).
  //   appNav     — pages contributed by installed apps (header: APPS).
  //                Each entry carries the app's manifest icon so the
  //                visual cue matches the Apps page.
  //   manageNav  — platform-administration verbs (header: MANAGE).
  //                Things you do TO the platform, not WITH it.
  const primaryNav = [
    { to: "/", label: "Overview" },
    { to: "/agents", label: "Agents" },
    { to: "/chat", label: "Chat" },
  ];
  const manageNav = [
    { to: "/integrations", label: "Integrations" },
    { to: "/apps", label: "Apps" },
    { to: "/skills", label: "Skills" },
    { to: "/analytics", label: "Analytics" },
    { to: "/settings", label: "Settings" },
  ];
  // App-contributed entries from any installed app declaring a
  // `provides.ui_panels` entry with slot=project.page. Each one
  // becomes a sidebar link to /apps/<name>/page rendered via
  // AppProjectPage. Fetched per project so installs scoped to one
  // project don't bleed into another's sidebar.
  //
  // Refresh policy: load on project switch, and again whenever the
  // window dispatches an "apteva:apps-changed" event. The Apps page
  // fires that event after install/uninstall + while polling pending
  // rows, so a freshly-installed app's sidebar entry appears the
  // instant the install flips to running. A 5s background poll is
  // there as a safety net for events we somehow miss.
  const [appNav, setAppNav] = useState<{ to: string; label: string; icon?: string }[]>([]);
  const refreshAppNav = useCallback(() => {
    apps
      .list(currentProject?.id)
      .then((rows) => {
        const out: { to: string; label: string; icon?: string }[] = [];
        for (const r of rows) {
          if (r.status !== "running") continue;
          for (const p of r.ui_panels || []) {
            if (p.slot === "project.page") {
              out.push({
                to: `/apps/${r.name}/page`,
                label: p.label || r.display_name || r.name,
                icon: r.icon,
              });
            }
          }
        }
        setAppNav(out);
      })
      .catch(() => setAppNav([]));
  }, [currentProject?.id]);
  useEffect(() => {
    refreshAppNav();
    const onAppsChanged = () => refreshAppNav();
    window.addEventListener("apteva:apps-changed", onAppsChanged);
    const id = setInterval(refreshAppNav, 5000);
    return () => {
      window.removeEventListener("apteva:apps-changed", onAppsChanged);
      clearInterval(id);
    };
  }, [refreshAppNav]);

  // Flat list — only used for "is this entry's path a prefix of
  // another's" active-link disambiguation. Doesn't change rendering.
  const navItems = [...primaryNav, ...appNav, ...manageNav];

  return (
    <div className="flex h-screen bg-bg">
      {/* Sidebar */}
      <nav className="w-56 border-r border-border flex flex-col">
        <div className="px-5 py-4 border-b border-border">
          <span className="text-accent font-bold text-lg">Apteva</span>
        </div>

        {/* Project selector */}
        {projects.length > 0 && (
          <div className="px-3 py-3 border-b border-border">
            <select
              value={currentProject?.id || ""}
              onChange={(e) => {
                const p = projects.find((p) => p.id === e.target.value);
                setCurrentProject(p || null);
              }}
              className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1 py-3 overflow-y-auto">
          {/* Primary group — the platform's daily-use verbs.
              No section label: this group IS the dashboard's default. */}
          {primaryNav.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              navItems={navItems}
            />
          ))}

          {/* Apps group — only rendered when ≥1 installed app has a
              project.page panel. Header label tells the user these are
              contributed by sidecars, and each entry carries the app's
              own icon to reinforce the "third-party" visual cue. */}
          {appNav.length > 0 && (
            <>
              <SidebarSectionHeader label="APPS" />
              {appNav.map((item) => (
                <SidebarLink
                  key={item.to}
                  item={item}
                  navItems={navItems}
                  iconUrl={item.icon}
                />
              ))}
            </>
          )}

          {/* Manage group — platform-administration verbs. Things you
              do TO the platform, not WITH the platform's daily surfaces. */}
          <SidebarSectionHeader label="MANAGE" />
          {manageNav.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              navItems={navItems}
            />
          ))}
        </div>
        {/* Logged-in user + account menu (change password, logout). Rendered
            above the version line so it sits in the same footer area. */}
        {user && user !== false && (
          <AccountMenu user={user} onLogout={logout} />
        )}

        {version && (
          <div className="px-5 py-3 border-t border-border flex items-center gap-2">
            <span
              className="text-text-muted text-xs"
              title={versionTip}
            >
              v{version}
            </span>
            {platformStatus?.update_available && (
              <button
                type="button"
                onClick={() => setUpdateModalOpen(true)}
                className="text-xs px-2 py-0.5 rounded bg-yellow/15 text-yellow hover:bg-yellow/25 transition-colors"
                title="Click for update details"
              >
                update available
              </button>
            )}
          </div>
        )}
      </nav>

      {updateModalOpen && platformStatus && (
        <PlatformUpdateModal
          status={platformStatus}
          refreshing={refreshing}
          onRefresh={refreshPlatformStatus}
          onClose={() => setUpdateModalOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Slim top bar — global controls. Currently just the
            notifications tray; placeholder for future search,
            user-shortcut, or quick-create surfaces. */}
        <div className="h-10 border-b border-border flex items-center justify-end px-3 flex-shrink-0">
          <NotificationsTray />
        </div>
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// Small inline modal for the "update available" pill. The platform
// status is read-only here — we don't trigger the update from the
// dashboard. The instruction copy adapts to the install method (npx,
// docker, source, standalone tarball); we can only guess from the
// browser, so we list the canonical commands and let the operator
// pick the relevant one.
function PlatformUpdateModal(props: {
  status: PlatformStatus;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { status, refreshing, onRefresh, onClose } = props;
  const polled = status.polled_at
    ? new Date(status.polled_at).toLocaleString()
    : "never";
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-border rounded-lg shadow-xl max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium">Platform update available</h2>
            {status.bundle_version && (
              <p className="text-text-muted text-xs mt-0.5">
                Bundle v{status.bundle_version}
                {status.release_notes_url && (
                  <>
                    {" · "}
                    <a
                      href={status.release_notes_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      release notes ↗
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-1 mb-4">
          {status.components.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between text-sm py-1 border-b border-border last:border-b-0"
            >
              <span className="font-mono text-xs">{c.name}</span>
              <span className="text-text-muted">
                v{c.current || "?"}
                {c.update_available && c.latest && (
                  <span className="text-yellow"> → v{c.latest}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        <div className="bg-border/30 rounded p-3 mb-4 text-xs">
          <div className="font-medium mb-2">To update, run one of:</div>
          <pre className="font-mono text-text-muted whitespace-pre-wrap leading-relaxed">{`# standalone tarball / global install
apteva update

# npm install
npm install -g apteva@latest

# Docker
docker pull apteva:latest && docker compose up -d`}</pre>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Last checked: {polled}</span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="px-3 py-1 rounded border border-border hover:bg-border/30 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Checking…" : "Check now"}
          </button>
        </div>

        {status.error && (
          <div className="mt-3 text-xs text-red">Error: {status.error}</div>
        )}
      </div>
    </div>
  );
}

// SidebarSectionHeader — the small uppercase label that delineates
// nav groups (APPS / MANAGE). Same typographic treatment Linear, VS
// Code, and Slack use for sidebar groupings: tiny, low-contrast,
// generous top margin so the group reads as a separate band.
function SidebarSectionHeader({ label }: { label: string }) {
  return (
    <div className="px-5 mt-5 mb-1 text-[10px] font-medium tracking-wider text-text-dim/70 uppercase">
      {label}
    </div>
  );
}

// SidebarLink — a NavLink with optional inline app-icon prefix, plus
// the same end-match behaviour the original flat list used (avoids
// /apps lighting up as active when you're on /apps/storage/page).
function SidebarLink({
  item,
  navItems,
  iconUrl,
}: {
  item: { to: string; label: string };
  navItems: { to: string; label: string }[];
  iconUrl?: string;
}) {
  const isPrefixOfAnother = navItems.some(
    (other) => other !== item && other.to.startsWith(item.to + (item.to === "/" ? "" : "/")),
  );
  return (
    <NavLink
      to={item.to}
      end={item.to === "/" || isPrefixOfAnother}
      className={({ isActive }) =>
        `flex items-center gap-2 px-5 py-2 text-sm transition-colors ${
          isActive
            ? "text-accent bg-bg-hover border-r-2 border-accent"
            : "text-text-muted hover:text-text hover:bg-bg-hover"
        }`
      }
    >
      {iconUrl !== undefined && <SidebarAppIcon url={iconUrl} name={item.label} />}
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

// SidebarAppIcon — 16×16 thumbnail of the app's manifest icon, with
// the same broken-image fallback Apps.tsx's AppIcon uses (single
// uppercase letter on a muted square). Kept as its own component so
// each entry has its own broken-state — a 404 on Storage's icon
// shouldn't make every app render the letter fallback.
function SidebarAppIcon({ url, name }: { url?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span className="w-4 h-4 rounded-sm bg-bg-input text-text-dim flex items-center justify-center text-[10px] flex-shrink-0">
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="w-4 h-4 rounded-sm flex-shrink-0"
      onError={() => setBroken(true)}
    />
  );
}
