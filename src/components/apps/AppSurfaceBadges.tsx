// Compact badge row for an app's surfaces. Renders only the
// non-zero ones so the eye sees what an app contributes at a glance:
// "tools 4 · UI · routes 2" instead of a full 8-checkbox grid.
//
// Each badge family carries its own subtle color so you can tell
// "this is a UI-only app" (purple) from "this is an integrations
// app" (green) from "this brings new MCP tools" (cyan) without
// reading the labels.
import type { AppSurfaces } from "../../api";

interface BadgeProps {
  label: string;
  count?: number;
  className: string;
  title?: string;
}

function Badge({ label, count, className, title }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${className}`}
      title={title}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="opacity-70 font-mono">{count}</span>
      )}
    </span>
  );
}

interface Props {
  surfaces?: AppSurfaces;
  className?: string;
}

export function AppSurfaceBadges({ surfaces, className }: Props) {
  if (!surfaces) return null;
  const items: BadgeProps[] = [];

  // Runtime kind colours the row's first chip — it's the single
  // most important "what is this thing" signal.
  if (surfaces.kind === "static") {
    items.push({
      label: "static",
      className: "bg-purple/15 text-purple-200",
      title: "Static UI app — no sidecar process; apteva-server mounts dist/ directly.",
    });
  } else if (surfaces.kind === "source") {
    items.push({
      label: "source",
      className: "bg-amber/15 text-amber-200",
      title: "Source build — apteva clones the repo and runs `go build` on install.",
    });
  } else if (surfaces.kind === "service") {
    items.push({
      label: "service",
      className: "bg-sky/15 text-sky-200",
      title: "Service container — sidecar deployed via the orchestrator.",
    });
  }

  if (surfaces.ui_app) {
    items.push({
      label: "UI",
      className: "bg-purple/15 text-purple-200",
      title: surfaces.ui_app_mount
        ? `Standalone UI mounted at ${surfaces.ui_app_mount}`
        : "Standalone UI app",
    });
  }
  if (surfaces.ui_panel_count > 0) {
    items.push({
      label: "panels",
      count: surfaces.ui_panel_count,
      className: "bg-purple/10 text-purple-200/80",
      title: `${surfaces.ui_panel_count} dashboard panel(s)`,
    });
  }
  if (surfaces.mcp_tool_count > 0) {
    items.push({
      label: "tools",
      count: surfaces.mcp_tool_count,
      className: "bg-cyan/15 text-cyan-200",
      title: surfaces.mcp_tool_names?.join(", ") ?? `${surfaces.mcp_tool_count} MCP tool(s)`,
    });
  }
  if (surfaces.http_route_count > 0) {
    items.push({
      label: "routes",
      count: surfaces.http_route_count,
      className: "bg-emerald/15 text-emerald-200",
      title: surfaces.http_routes?.join(", ") ?? `${surfaces.http_route_count} HTTP route(s)`,
    });
  }
  if (surfaces.channel_count > 0) {
    items.push({
      label: "channels",
      count: surfaces.channel_count,
      className: "bg-amber/15 text-amber-200",
      title: surfaces.channel_names?.join(", ") ?? `${surfaces.channel_count} channel(s)`,
    });
  }
  if (surfaces.worker_count > 0) {
    items.push({
      label: "workers",
      count: surfaces.worker_count,
      className: "bg-rose/15 text-rose-200",
      title: `${surfaces.worker_count} background worker(s)`,
    });
  }
  if (surfaces.prompt_fragment_count > 0) {
    items.push({
      label: "prompt",
      count: surfaces.prompt_fragment_count,
      className: "bg-bg-hover text-text-muted",
      title: `${surfaces.prompt_fragment_count} prompt fragment(s)`,
    });
  }

  // Unmet hard dependencies surface as a single attention-grabbing
  // badge — clicking the card opens the side panel where the full
  // list lives. Optional missing deps don't show here (they degrade
  // silently); only the required ones the install flow will cascade.
  const unmetRequired = (surfaces.required_apps ?? []).filter(
    (d) => !d.installed && !d.optional,
  );
  if (unmetRequired.length > 0) {
    items.push({
      label: `needs ${unmetRequired.length}`,
      className: "bg-amber/15 text-amber-200",
      title: `Will also install: ${unmetRequired.map((d) => d.name).join(", ")}`,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {items.map((b, i) => (
        <Badge key={`${b.label}-${i}`} {...b} />
      ))}
    </div>
  );
}
