import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useProjects } from "../hooks/useProjects";
import { useAuth } from "../hooks/useAuth";
import { AccountMenu } from "./AccountMenu";

export function Layout() {
  const [version, setVersion] = useState("");
  const [versionTip, setVersionTip] = useState("");
  const { projects, currentProject, setCurrentProject } = useProjects();
  const { user, logout } = useAuth();

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

  const navItems = [
    { to: "/", label: "Agents" },
    { to: "/integrations", label: "Integrations" },
    { to: "/analytics", label: "Analytics" },
    { to: "/settings", label: "Settings" },
  ];

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
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
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
          ))}
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
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
