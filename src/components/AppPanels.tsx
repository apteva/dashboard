import { useEffect, useState } from "react";
import { apps, type AppRow } from "../api";

// AppPanels mounts every running App's `ui_panels` whose slot matches
// the requested slot. Panels are iframed (third-party trust) at
// /api/apps/<name><entry>?install_id=…&instance_id=…&token=…. The
// sidecar's static handler serves the bundled HTML/JS.
//
// Supported slots:
//   instance.tab    — full-pane content under the instance detail tabs
//   instance.status — small status strip on the instance detail header
//   settings.app    — embedded into the Apps tab's per-install detail page
//   sidebar.widget  — narrow sidebar widget (not consumed yet)
//
// Each panel iframe gets a postMessage protocol later; for v1 it just
// reads the URL params and talks to /api/apps/<name>/* directly.
export function AppPanels({
  slot,
  instanceId,
  projectId,
  className,
  onLoad,
}: {
  slot: string;
  instanceId?: number;
  projectId?: string;
  className?: string;
  onLoad?: (panels: PanelInstance[]) => void;
}) {
  const [panels, setPanels] = useState<PanelInstance[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apps
      .list(projectId)
      .then((rows) => {
        if (cancelled) return;
        const collected: PanelInstance[] = [];
        for (const r of rows) {
          if (r.status !== "running") continue;
          for (const p of r.ui_panels || []) {
            if (p.slot === slot) {
              collected.push({
                installId: r.install_id,
                appName: r.name,
                appDisplay: r.display_name,
                slot: p.slot,
                label: p.label,
                icon: p.icon,
                entry: p.entry,
              });
            }
          }
        }
        setPanels(collected);
        onLoad?.(collected);
      })
      .catch((e) => setError(e.message || "panel load failed"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, projectId]);

  if (error) return <div className="text-red text-xs">{error}</div>;
  if (panels.length === 0) return null;

  return (
    <div className={className}>
      {panels.map((p) => (
        <AppPanelFrame key={`${p.installId}#${p.entry}`} panel={p} instanceId={instanceId} />
      ))}
    </div>
  );
}

export interface PanelInstance {
  installId: number;
  appName: string;
  appDisplay: string;
  slot: string;
  label: string;
  icon: string;
  entry: string;
}

function AppPanelFrame({ panel, instanceId }: { panel: PanelInstance; instanceId?: number }) {
  // The sidecar's static handler serves panel.entry at <sidecar>/ui/...
  // The platform proxies that under /api/apps/<name>/ui/..., so a
  // relative URL the iframe can resolve from the dashboard origin is:
  const params = new URLSearchParams({
    install_id: String(panel.installId),
    ...(instanceId ? { instance_id: String(instanceId) } : {}),
    // token is forwarded automatically via the cookie on same-origin
    // requests; no need to splice it into the URL for now.
  });
  const src = `/api/apps/${panel.appName}${panel.entry}?${params.toString()}`;
  // Heights are slot-specific. instance.status is a thin strip; tabs
  // get the rest of the pane.
  const height =
    panel.slot === "instance.status"
      ? "h-16"
      : panel.slot === "sidebar.widget"
        ? "h-32"
        : "h-full min-h-[300px]";
  return (
    <div className={`border border-border rounded ${height} overflow-hidden`}>
      <iframe
        src={src}
        title={`${panel.appDisplay} — ${panel.label}`}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
