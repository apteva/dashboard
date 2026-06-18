import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProjects } from "../hooks/useProjects";
import { useAuth } from "../hooks/useAuth";
import { AccountMenu } from "./AccountMenu";
import { NotificationsTray } from "./NotificationsTray";
import { startChatNotifications } from "../state/chatNotifications";
import { chatConnections, purgeLegacyChatConnectedKeys } from "../state/chatConnections";
import { apps, platform, type PlatformStatus } from "../api";
import { ContextAgentChatWidget, readContextAgentChatOpenDefault } from "./ContextAgentChatWidget";

// Sidebar APPS section visible-cap. Above this, the overflow row
// collapses the rest behind a "More apps (N)" toggle. Five is the
// "shows above the fold on a 720-tall screen plus the MANAGE
// section underneath" threshold — picked empirically. Pinning lands
// in a later PR; PR-1 uses the first N entries by the server's
// sort order.
const SIDEBAR_APPS_VISIBLE = 5;

export function Layout() {
  const [version, setVersion] = useState("");
  const [versionTip, setVersionTip] = useState("");
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  // Sidebar APPS overflow toggle. Default collapsed so a long
  // install list (~22 apps in the boot we saw) doesn't push the
  // MANAGE section off-screen. Persisted to localStorage so the
  // expanded-state survives page reloads without a backend setting.
  const [showAllApps, setShowAllApps] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebar:showAllApps") === "1";
    } catch {
      return false;
    }
  });
  const toggleShowAllApps = useCallback(() => {
    setShowAllApps((v) => {
      const next = !v;
      try {
        localStorage.setItem("sidebar:showAllApps", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const { projects, currentProject, setCurrentProject } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(readContextAgentChatOpenDefault);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
  // Chat-connection intent is session-only now — no resume from disk
  // (see chatConnections.ts header). We do, however, purge legacy
  // `chat.connected.<id>` localStorage keys from the old persistent
  // design once per boot so they don't sit around forever.
  //
  // The notifications driver (startChatNotifications) is safe to bounce
  // — its cleanup is just an SSE close + localStorage listener removal,
  // no agent-visible side effects.
  useEffect(() => {
    if (!user || user === false) return;
    purgeLegacyChatConnectedKeys();
    const stopNotifs = startChatNotifications();
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
      // Tear down the telemetry SSE on logout for the same reason
      // we tear down chat: the user is gone, no need to hold a
      // socket open. setProjectId(null) is the documented
      // "disconnect" path.
      if (typeof window !== "undefined") {
        window.__aptevaTelemetryBus?.setProjectId(null);
      }
    }
  }, [user]);

  // Bind the telemetry bus to the active project. The bus opens a
  // single /telemetry/stream?all=1&project_id=… SSE and multiplexes
  // events out to every component that calls
  // useTelemetryEvents() / window.__aptevaTelemetryBus.subscribe().
  // Per-page consumers (chat thinking strip, ActivityFeed, fleet
  // views) reuse this one stream instead of each opening their own,
  // which used to be the dominant contributor to the connection
  // budget on the dashboard.
  useEffect(() => {
    if (!user || user === false) return;
    if (typeof window === "undefined") return;
    window.__aptevaTelemetryBus?.setProjectId(currentProject?.id ?? null);
  }, [user, currentProject?.id]);

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
    { to: "/activity", label: "Activity" },
    { to: "/chat", label: "Chat" },
  ];
  const manageNav = [
    { to: "/integrations", label: "Integrations" },
    { to: "/apps", label: "Apps" },
    { to: "/skills", label: "Skills" },
    { to: "/environments", label: "Environments" },
    { to: "/analytics", label: "Usage" },
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
  // Fetch epoch — every effect run bumps this and only the latest run
  // is allowed to write state. Without this, an in-flight unfiltered
  // fetch (currentProject not yet hydrated) can race with a later
  // project-filtered fetch and "win" by resolving second, leaving the
  // sidebar showing every project's panels duplicated. The duplicate-
  // Files-entry bug came from exactly this race.
  const fetchEpochRef = useRef(0);
  const refreshAppNav = useCallback(() => {
    // Skip the call when the project context isn't ready yet —
    // apps.list(undefined) hits /api/apps with no project_id filter,
    // which returns EVERY install (cross-project leak in the sidebar).
    if (!currentProject?.id) {
      setAppNav([]);
      return;
    }
    const epoch = ++fetchEpochRef.current;
    apps
      .list(currentProject.id)
      .then((rows) => {
        if (epoch !== fetchEpochRef.current) return; // stale response
        const out: { to: string; label: string; icon?: string }[] = [];
        const seen = new Set<string>();
        for (const r of rows) {
          if (r.status !== "running") continue;
          for (const p of r.ui_panels || []) {
            if (p.slot !== "project.page") continue;
            const to = `/apps/${r.name}/page`;
            // Dedupe by route — multiple installs of the same app
            // (one per project) share /apps/<name>/page, and the
            // SidebarLink uses key={item.to}. Defensive against
            // any future cross-project leak from the API.
            if (seen.has(to)) continue;
            seen.add(to);
            out.push({
              to,
              label: p.label || r.display_name || r.name,
              icon: r.icon,
            });
          }
        }
        setAppNav(out);
      })
      .catch(() => {
        if (epoch !== fetchEpochRef.current) return;
        setAppNav([]);
      });
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

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const renderSidebar = (mobile = false) => (
    <>
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <span className="text-accent font-bold text-lg">Apteva</span>
        {mobile && (
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="h-8 w-8 inline-flex items-center justify-center rounded border border-border text-text-muted hover:text-text hover:bg-bg-hover"
            aria-label="Close navigation"
          >
            x
          </button>
        )}
      </div>

      {/* Project selector. Projects the current user didn't create
          (typically because they were invited as a member, or because
          they're a platform admin seeing every project) get a
          "(shared)" tag so the picker UI signals "you're peeking
          into someone else's workspace." */}
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
            {projects.map((p) => {
              const mine = user && user !== false && p.user_id === user.id;
              return (
                <option key={p.id} value={p.id}>
                  {p.name}{mine ? "" : " (shared)"}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Primary call-to-action — building a new agent is the
          highest-frequency creative action in the app, so it sits
          above the nav rail (not behind a "go to Agents → click +"
          two-step). Filled accent so it stays the focal point of
          the sidebar regardless of which page is selected. */}
      <div className="px-3 py-3 border-b border-border">
        <button
          onClick={() => {
            navigate("/agents/new");
            if (mobile) setMobileNavOpen(false);
          }}
          className="w-full flex items-center justify-center gap-2 bg-accent text-bg rounded-lg px-3 py-2 text-sm font-bold hover:bg-accent-hover transition-colors"
          title="Build a new agent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          New agent
        </button>
      </div>

      <div className="flex-1 py-3 overflow-y-auto">
        {/* Primary group — the platform's daily-use verbs.
            No section label: this group IS the dashboard's default. */}
        {primaryNav.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            navItems={navItems}
            onNavigate={mobile ? () => setMobileNavOpen(false) : undefined}
          />
        ))}

        {/* Apps group — only rendered when >=1 installed app has a
            project.page panel. Header label tells the user these are
            contributed by sidecars, and each entry carries the app's
            own icon to reinforce the "third-party" visual cue.
            Caps the visible list at SIDEBAR_APPS_VISIBLE so an
            installer with 20+ apps doesn't bury the MANAGE section
            below the fold. Anything beyond the cap collapses behind
            a "More apps (N)" toggle. Pinning lands in a later PR; for
            now the first SIDEBAR_APPS_VISIBLE entries (server's sort
            order) are the ones shown. */}
        {appNav.length > 0 && (() => {
          const visibleApps = showAllApps ? appNav : appNav.slice(0, SIDEBAR_APPS_VISIBLE);
          const overflow = appNav.length - visibleApps.length;
          return (
            <>
              <SidebarSectionHeader label="APPS" />
              {visibleApps.map((item) => (
                <SidebarLink
                  key={item.to}
                  item={item}
                  navItems={navItems}
                  iconUrl={item.icon}
                  onNavigate={mobile ? () => setMobileNavOpen(false) : undefined}
                />
              ))}
              {(overflow > 0 || showAllApps) && (
                <button
                  onClick={toggleShowAllApps}
                  className="w-full px-5 py-2 text-xs text-text-muted hover:text-text text-left transition-colors"
                >
                  {showAllApps
                    ? "Show less"
                    : `+ More apps (${overflow})`}
                </button>
              )}
            </>
          );
        })()}

        {/* Manage group — platform-administration verbs. Things you
            do TO the platform, not WITH the platform's daily surfaces. */}
        <SidebarSectionHeader label="MANAGE" />
        {manageNav.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            navItems={navItems}
            onNavigate={mobile ? () => setMobileNavOpen(false) : undefined}
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
    </>
  );

  return (
    <div className="flex h-dvh min-h-dvh bg-bg overflow-hidden">
      {/* Sidebar */}
      <nav className="hidden md:flex w-56 shrink-0 border-r border-border flex-col">
        {renderSidebar(false)}
      </nav>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          />
          <nav className="relative h-full w-[min(20rem,86vw)] bg-bg border-r border-border flex flex-col shadow-xl">
            {renderSidebar(true)}
          </nav>
        </div>
      )}

      {updateModalOpen && platformStatus && (
        <PlatformUpdateModal
          status={platformStatus}
          refreshing={refreshing}
          onRefresh={refreshPlatformStatus}
          onClose={() => setUpdateModalOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Slim top bar — global controls. Currently just the
            notifications tray; placeholder for future search,
            user-shortcut, or quick-create surfaces. */}
        <div className="h-12 md:h-10 border-b border-border flex items-center justify-between md:justify-end gap-3 px-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded border border-border text-text-muted hover:text-text hover:bg-bg-hover"
            aria-label="Open navigation"
          >
            <span className="sr-only">Open navigation</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </svg>
          </button>
          <div className="md:hidden min-w-0 flex-1">
            <div className="text-sm font-bold text-accent truncate">Apteva</div>
            {currentProject && (
              <div className="text-[11px] text-text-dim truncate">{currentProject.name}</div>
            )}
          </div>
          <NotificationsTray />
        </div>
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>

      <ContextAgentChatWidget
        open={agentDrawerOpen}
        onOpen={() => setAgentDrawerOpen(true)}
        onClose={() => setAgentDrawerOpen(false)}
      />
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
          <div className="font-medium mb-2">{updateInstructionsTitle(status.install_method)}</div>
          <pre className="font-mono text-text-muted whitespace-pre-wrap leading-relaxed">{updateInstructionsBody(status.install_method)}</pre>
          {updateInstructionsNote(status.install_method) && (
            <div className="mt-2 text-text-dim text-[11px] italic">
              {updateInstructionsNote(status.install_method)}
            </div>
          )}
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
  onNavigate,
}: {
  item: { to: string; label: string };
  navItems: { to: string; label: string }[];
  iconUrl?: string;
  onNavigate?: () => void;
}) {
  const isPrefixOfAnother = navItems.some(
    (other) => other !== item && other.to.startsWith(item.to + (item.to === "/" ? "" : "/")),
  );
  return (
    <NavLink
      to={item.to}
      end={item.to === "/" || isPrefixOfAnother}
      onClick={onNavigate}
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

// updateInstructionsTitle / Body / Note — the three slots in the
// "Platform update available" modal. The server tags each install
// with an `install_method` (foreground / systemd-* / launchd-* /
// docker / source / packaged); we render the matching command.
//
// Why three functions and not one big switch component: the title
// changes the verb ("To update, run" vs "Restart your container"),
// and the note appears only for flavors where the supervisor
// handles the restart for free — separating them keeps the JSX
// above clean.
function updateInstructionsTitle(method: string | undefined): string {
  switch (method) {
    case "docker":
      return "Pull the new image and restart your container:";
    case "source":
      return "Pull the monorepo and rebuild:";
    case "packaged":
      return "Use your system package manager:";
    case "systemd-system":
    case "systemd-user":
    case "launchd-system":
    case "launchd-user":
      return "Run apteva update — the supervisor handles the restart:";
    default:
      return "To update, run:";
  }
}

function updateInstructionsBody(method: string | undefined): string {
  switch (method) {
    case "docker":
      return "docker pull apteva:latest\ndocker compose up -d";
    case "source":
      return "cd <your monorepo>\ngit pull\n./scripts/build-local.sh";
    case "packaged":
      return "# pick the right one for your distro\nsudo apt upgrade apteva\n# or: sudo dnf upgrade apteva\n# or: sudo pacman -Syu apteva";
    case "systemd-user":
    case "launchd-user":
      return "apteva update";
    case "systemd-system":
    case "launchd-system":
      return "sudo apteva update";
    default:
      // foreground OR unknown: show the canonical paths for both
      // standalone-tarball and npm installs so npx/npm-global users
      // see something useful too.
      return "# standalone / one-command upgrade\napteva update\n\n# npm install\nnpm install -g apteva@latest";
  }
}

function updateInstructionsNote(method: string | undefined): string | null {
  switch (method) {
    case "systemd-user":
    case "systemd-system":
      return "The unit's SuccessExitStatus=11 + Restart=on-failure picks up the new binary through bin/current.";
    case "launchd-user":
    case "launchd-system":
      return "launchd's KeepAlive picks up the new binary through bin/current after the SIGTERM drain.";
    case "foreground":
      return "After the swap, re-run apteva to start the new version.";
    default:
      return null;
  }
}
