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
import { resolvePanelComponent } from "../components/apps/nativePanels";

export function AppProjectPage() {
  const { name } = useParams<{ name: string }>();
  const { currentProject } = useProjects();
  const [app, setApp] = useState<AppRow | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!name) return;
    apps
      .list(currentProject?.id)
      .then((rows) => {
        const found = rows.find((r) => r.name === name);
        if (!found) {
          setError(`App "${name}" is not installed in this project.`);
          setApp(null);
          return;
        }
        if (found.status !== "running") {
          setError(`App "${name}" is ${found.status} — start it from the Apps tab.`);
          setApp(null);
          return;
        }
        setApp(found);
        setError("");
      })
      .catch((e) => setError(e.message || "failed to load app"));
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
  if (!app) {
    return <div className="p-6 text-text-dim text-sm">Loading…</div>;
  }
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
  const Native = resolvePanelComponent(app.name, panel.entry);
  if (Native) {
    return (
      <div className="h-full">
        <Native
          appName={app.name}
          installId={app.install_id}
          projectId={currentProject?.id || ""}
        />
      </div>
    );
  }

  // Iframe fallback for apps with no native registration. install_id
  // + project_id flow as URL params so the panel can scope reads.
  const params = new URLSearchParams({
    install_id: String(app.install_id),
    project_id: currentProject?.id || "",
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
