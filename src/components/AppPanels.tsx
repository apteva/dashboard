import type { HostUI } from "@apteva/ui-kit";
import { AppHostFrame } from "./apps/hostUI";
import { useEffect, useState } from "react";
import { apps, type AppRow } from "../api";
import { resolvePanelComponent } from "./apps/nativePanels";

// AppPanels mounts every running App's `ui_panels` whose slot matches
// the requested slot. First-party apps with a registered React
// component render inline (no iframe, theme inherited); third-party
// apps fall back to an iframe served by the sidecar.
//
// Supported slots:
//   project.page    — full-pane page scoped to the current project
//                     (mounted via AppProjectPage, not this component)
//   instance.tab    — full-pane content under the instance detail tabs
//   instance.status — small status strip on the instance detail header
//   settings.app    — embedded into the Apps tab's per-install detail page
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
  const [loadedScope, setLoadedScope] = useState("");
  const [panels, setPanels] = useState<PanelInstance[]>([]);
  const [activePanel, setActivePanel] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPanels([]); setActivePanel(""); setError("");
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
                hostUI: p.host_ui,
                version: r.version,
              });
            }
          }
        }
        setPanels(collected); setLoadedScope(`${projectId}:${slot}`);
        onLoad?.(collected);
      })
      .catch((e) => setError(e.message || "panel load failed"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, projectId]);

  if (error) return <div className="text-red text-xs">{error}</div>;
  if (panels.length === 0 || loadedScope !== `${projectId}:${slot}`) return null;

  return (
    <div className={className}>
      {panels.map((p) => (
        <div key={`${projectId}:${p.installId}#${p.entry}`} className="contents"
          onFocusCapture={() => setActivePanel(`${p.installId}#${p.entry}`)}
          onPointerDownCapture={() => setActivePanel(`${p.installId}#${p.entry}`)}>
          <AppPanelMount panel={p} instanceId={instanceId} projectId={projectId || ""}
            foreground={slot === "instance.tab" && (activePanel || `${panels[0].installId}#${panels[0].entry}`) === `${p.installId}#${p.entry}`} />
        </div>
      ))}
    </div>
  );
}

function AppPanelMount({
  panel,
  instanceId,
  projectId,
  foreground,
}: {
  foreground: boolean;
  panel: PanelInstance;
  instanceId?: number;
  projectId: string;
}) {
  const Native = resolvePanelComponent(panel.appName, panel.entry, panel.version, {
    installId: panel.installId,
    projectId,
  });
  if (Native) {
    return (
      <Native
        hostSurface={{foreground,hostUI:panel.hostUI,surface:panel.slot+":"+panel.entry}}
        appName={panel.appName}
        installId={panel.installId}
        projectId={projectId}
        instanceId={instanceId}
      />
    );
  }
  return <AppPanelFrame panel={panel} instanceId={instanceId} projectId={projectId} foreground={foreground} />;
}

export interface PanelInstance {
  hostUI?: HostUI;
  installId: number;
  appName: string;
  appDisplay: string;
  slot: string;
  label: string;
  icon: string;
  entry: string;
  version: string;
}

function AppPanelFrame({ panel, instanceId, projectId, foreground }: { panel: PanelInstance; instanceId?: number; projectId: string; foreground: boolean }) {
  // The sidecar's static handler serves panel.entry at <sidecar>/ui/...
  // The platform proxies that under /api/apps/<name>/ui/..., so a
  // relative URL the iframe can resolve from the dashboard origin is:
  const params = new URLSearchParams({
    install_id: String(panel.installId),
    project_id: projectId,
    ...(instanceId ? { agent_id: String(instanceId) } : {}),
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
      <AppHostFrame src={src} title={`${panel.appDisplay} — ${panel.label}`}
        projectId={projectId} installId={panel.installId} surface={panel.slot+":"+panel.entry}
        foreground={foreground} hostUI={panel.hostUI} />
    </div>
  );
}
