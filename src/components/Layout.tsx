import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useProjects } from "../hooks/useProjects";
import { useAuth } from "../hooks/useAuth";
import { AccountMenu } from "./AccountMenu";
import { NotificationsTray } from "./NotificationsTray";
import { startChatNotifications } from "../state/chatNotifications";
import { chatConnections } from "../state/chatConnections";
import { apps } from "../api";

export function Layout() {
  const [version, setVersion] = useState("");
  const [versionTip, setVersionTip] = useState("");
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

  // Built-in nav entries always present.
  const baseNav = [
    { to: "/", label: "Overview" },
    { to: "/agents", label: "Agents" },
    { to: "/chat", label: "Chat" },
    { to: "/integrations", label: "Integrations" },
  ];
  // App-contributed entries from any installed app declaring a
  // `provides.ui_panels` entry with slot=project.page. Each one
  // becomes a sidebar link to /apps/<name>/page rendered via
  // AppProjectPage. Fetched per project so installs scoped to one
  // project don't bleed into another's sidebar.
  const [appNav, setAppNav] = useState<{ to: string; label: string }[]>([]);
  useEffect(() => {
    apps
      .list(currentProject?.id)
      .then((rows) => {
        const out: { to: string; label: string }[] = [];
        for (const r of rows) {
          if (r.status !== "running") continue;
          for (const p of r.ui_panels || []) {
            if (p.slot === "project.page") {
              out.push({
                to: `/apps/${r.name}/page`,
                label: p.label || r.display_name || r.name,
              });
            }
          }
        }
        setAppNav(out);
      })
      .catch(() => setAppNav([]));
  }, [currentProject?.id]);

  // Sidebar nav: base entries, then app-contributed pages, then the
  // platform-management entries (Apps marketplace, Analytics,
  // Settings) at the bottom.
  const tailNav = [
    { to: "/apps", label: "Apps" },
    { to: "/analytics", label: "Analytics" },
    { to: "/settings", label: "Settings" },
  ];
  const navItems = [...baseNav, ...appNav, ...tailNav];

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

        <div className="flex-1 py-3">
          {navItems.map((item) => {
            // Use exact-match for any nav entry that could be a prefix
            // of a more-specific one. Without this, /apps lights up as
            // active when you're on /apps/storage/page (and same for /).
            const isPrefixOfAnother = navItems.some(
              (other) => other !== item && other.to.startsWith(item.to + (item.to === "/" ? "" : "/")),
            );
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/" || isPrefixOfAnother}
                className={({ isActive }) =>
                  `block px-5 py-3 text-sm transition-colors ${
                    isActive
                      ? "text-accent bg-bg-hover border-r-2 border-accent"
                      : "text-text-muted hover:text-text hover:bg-bg-hover"
                  }`
                }
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>
        {/* Logged-in user + account menu (change password, logout). Rendered
            above the version line so it sits in the same footer area. */}
        {user && user !== false && (
          <AccountMenu user={user} onLogout={logout} />
        )}

        {version && (
          <div className="px-5 py-3 border-t border-border">
            <span
              className="text-text-muted text-xs"
              title={versionTip}
            >
              v{version}
            </span>
          </div>
        )}
      </nav>

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
