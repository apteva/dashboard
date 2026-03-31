import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { providers, type Provider } from "../api";
import { useProjects } from "../hooks/useProjects";

export function Layout() {
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [version, setVersion] = useState("");
  const { projects, currentProject, setCurrentProject } = useProjects();

  useEffect(() => {
    providers.list().then(setProviderList).catch(() => {});
    fetch("/version").then((r) => r.json()).then((d) => setVersion(d.version || "")).catch(() => {});
  }, []);

  const hasIntegrations = providerList.some((p) => p.name === "Apteva Local");

  const navItems = [
    { to: "/", label: "Dashboard" },
    ...(hasIntegrations ? [{ to: "/integrations", label: "Integrations" }] : []),
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
        {version && (
          <div className="px-5 py-3 border-t border-border">
            <span className="text-text-muted text-xs">v{version}</span>
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
