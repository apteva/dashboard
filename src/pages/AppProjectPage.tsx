// AppProjectPage — generic mount point for any installed app's
// `provides.ui_panels` entry with slot=project.page. The route is
// /apps/:name/page; the panel is iframed full-pane, scoped to the
// current project.
//
// Same iframe machinery as instance.tab but without instance_id.
// The app's panel reads project_id from the URL query (and any
// other contextual hints we may add later — e.g. team_id).

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apps, type AppRow } from "../api";
import { useProjects } from "../hooks/useProjects";

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

  // Build the iframe URL. install_id + project_id are passed so the
  // panel can scope reads/writes correctly. instance_id is omitted —
  // this is project-level, not instance-level.
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
