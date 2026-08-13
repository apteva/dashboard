// AppProjectPage — generic mount point for any installed app's
// `provides.ui_panels` entry with slot=project.page. The route is
// /apps/:name/page.
//
// First-party apps register a React component in nativePanels.tsx;
// we mount that directly so it inherits theme tokens, router, auth.
// Apps without a registration fall back to an iframe served by the
// sidecar — same trust boundary the v1 panels relied on.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apps, type AppRow } from "../api";
import { useProjects } from "../hooks/useProjects";
import { usePageTitle } from "../hooks/usePageTitle";
import { resolvePanelComponent } from "../components/apps/nativePanels";

interface LoadedApp {
  app: AppRow;
  projectId: string;
  routeName: string;
}

export function loadedAppMatchesRoute(
  loaded: Pick<LoadedApp, "projectId" | "routeName">,
  projectId?: string,
  routeName?: string,
): boolean {
  return !!projectId && !!routeName && loaded.projectId === projectId && loaded.routeName === routeName;
}

export function AppProjectPage() {
  const { name } = useParams<{ name: string }>();
  const { currentProject } = useProjects();
  const [loaded, setLoaded] = useState<LoadedApp | null>(null);
  const [error, setError] = useState("");
  const app = loaded?.app ?? null;
  usePageTitle(["App", app?.display_name || app?.name || name || "loading"]);

  useEffect(() => {
    const projectId = currentProject?.id;
    if (!name || !projectId) {
      setLoaded(null);
      return;
    }
    // Project switches can leave the previous request in flight. If that
    // older request resolves last, it must not replace the selected
    // project's install (and produce a mixed install_id/project_id panel
    // URL). Clear the old row immediately and ignore stale completions.
    let cancelled = false;
    setLoaded(null);
    setError("");
    apps
      .list(projectId)
      .then((rows) => {
        if (cancelled) return;
        // Prefer the install owned by this project when the same app also
        // has a global install visible to it.
        const found =
          rows.find((r) => r.name === name && r.project_id === projectId) ||
          rows.find((r) => r.name === name && !r.project_id);
        if (!found) {
          setError(`App "${name}" is not installed in this project.`);
          setLoaded(null);
          return;
        }
        if (found.status !== "running") {
          setError(`App "${name}" is ${found.status} — start it from the Apps tab.`);
          setLoaded(null);
          return;
        }
        // Keep the request scope and row together. Never derive the panel's
        // project ID later from mutable context: that allowed an old install
        // row and a newly-selected project to be combined during reloads.
        setLoaded({ app: found, projectId, routeName: name });
        setError("");
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "failed to load app");
      });
    return () => {
      cancelled = true;
    };
  }, [name, currentProject?.id]);

  if (error) {
    return (
      <div className="p-6">
        <div className="border border-border rounded-lg p-8 text-center">
          <p className="text-text-muted text-sm">{error}</p>
        </div>
      </div>
    );
  }
  if (!loaded || !app) {
    return <div className="p-6 text-text-dim text-sm">Loading…</div>;
  }
  // Effects run after render. During a project or route switch, refuse to
  // render data produced by the previous request even if the row omits its
  // project_id (for example, a global install or stale cached response).
  if (!loadedAppMatchesRoute(loaded, currentProject?.id, name)) {
    return <div className="p-6 text-text-dim text-sm">Loading…</div>;
  }
  const panelProjectId = loaded.projectId;
  const panel = (app.ui_panels || []).find((p) => p.slot === "project.page");
  if (!panel) {
    return (
      <div className="p-6">
        <div className="border border-border rounded-lg p-8 text-center">
          <p className="text-text-muted text-sm">
            App "{app.display_name || app.name}" has no project-level page.
          </p>
        </div>
      </div>
    );
  }

  // Native path: dynamically import the panel module the app's
  // sidecar serves at panel.entry. The component lives inside our
  // React tree, inherits the importmap'd React + theme + router.
  const Native = resolvePanelComponent(app.name, panel.entry, app.version, {
    installId: app.install_id,
    projectId: panelProjectId,
    identity: {
      name: app.name,
      displayName: app.display_name || app.name,
      iconUrl: app.icon,
      iconStyle: app.icon_style,
    },
  });
  if (Native) {
    return (
      <div className="h-full">
        <Native
          appName={app.name}
          installId={app.install_id}
          projectId={panelProjectId}
        />
      </div>
    );
  }

  // Iframe fallback for apps with no native registration. install_id
  // + project_id flow as URL params so the panel can scope reads.
  const params = new URLSearchParams({
    install_id: String(app.install_id),
    project_id: panelProjectId,
  });
  const src = `/api/apps/${app.name}${panel.entry}?${params.toString()}`;

  return (
    <div className="h-full">
      <iframe
        src={src}
        title={`${app.display_name || app.name} — ${panel.label}`}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
