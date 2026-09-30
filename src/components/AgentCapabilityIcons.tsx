import { AppIcon } from "@apteva/ui-kit";
import { useMemo } from "react";
import type { AppRow, ConnectionInfo, InstanceSkill, MCPServer, MCPServerConfig } from "../api";

export interface AgentCapabilityCatalog {
  apps: AppRow[];
  connections: ConnectionInfo[];
  inventory: MCPServer[];
}

type CapabilityIcon = {
  key: string;
  name: string;
  kind: "app" | "integration" | "skill" | "mcp";
  src?: string;
  iconStyle?: string;
};

function normalized(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function installIdFromURL(raw?: string): number {
  if (!raw) return 0;
  try {
    const url = new URL(raw, "http://localhost");
    return Number(url.searchParams.get("install_id")) || 0;
  } catch {
    return Number(raw.match(/[?&]install_id=(\d+)/)?.[1]) || 0;
  }
}

function appSlugFromURL(raw?: string) {
  const match = String(raw || "").match(/\/api\/apps\/([^/?#]+)\/mcp/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function agentCardCapabilities(
  attached: MCPServerConfig[],
  skills: InstanceSkill[],
  catalog: AgentCapabilityCatalog,
): CapabilityIcon[] {
  const found = new Map<string, CapabilityIcon>();
  const add = (item: CapabilityIcon) => {
    if (!found.has(item.key)) found.set(item.key, item);
  };
  for (const server of attached) {
    const name = normalized(server.name);
    const row = catalog.inventory.find((candidate) =>
      (server.url && (candidate.proxy_config?.url === server.url || candidate.url === server.url))
      || normalized(candidate.proxy_config?.name || candidate.name) === name,
    );
    const installId = installIdFromURL(server.url) || row?.owner_app_install_id || 0;
    const slug = normalized(appSlugFromURL(server.url));
    const app = catalog.apps.find((candidate) =>
      (installId > 0 && candidate.install_id === installId)
      || (slug && normalized(candidate.name) === slug),
    );
    if (app) {
      add({ key: `app:${app.install_id}`, name: app.display_name || app.name, kind: "app", src: app.icon, iconStyle: app.icon_style });
      continue;
    }
    const connection = catalog.connections.find((candidate) => candidate.id === row?.connection_id);
    if (connection) {
      add({ key: `connection:${connection.id}`, name: connection.app_name || connection.name, kind: "integration", src: connection.logo });
      continue;
    }
    const displayName = row?.description || row?.name || server.name;
    add({ key: `mcp:${name}`, name: displayName, kind: row?.source === "app" ? "app" : "mcp" });
  }
  for (const skill of skills) {
    const app = skill.source === "app"
      ? catalog.apps.find((candidate) => normalized(candidate.name) === normalized(skill.app_name))
      : undefined;
    if (app) {
      add({ key: `app:${app.install_id}`, name: app.display_name || app.name, kind: "app", src: app.icon, iconStyle: app.icon_style });
    } else {
      add({ key: `skill:${skill.skill_id || skill.slug}`, name: skill.name || skill.slug, kind: "skill" });
    }
  }
  const order = { app: 0, integration: 1, skill: 2, mcp: 3 };
  return [...found.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

export function AgentCapabilityIcons({ attached, skills, catalog, compact = false }: {
  attached: MCPServerConfig[];
  skills: InstanceSkill[];
  catalog: AgentCapabilityCatalog;
  compact?: boolean;
}) {
  const capabilities = useMemo(() => agentCardCapabilities(attached, skills, catalog), [attached, skills, catalog]);
  const shown = capabilities.slice(0, 4);
  const hidden = capabilities.slice(4);
  return <div className={`flex min-w-0 items-center gap-2 ${compact ? "" : "mt-3 border-t border-border/70 pt-3"}`}>
    <span className={`${compact ? "hidden lg:inline" : ""} shrink-0 text-[10px] font-semibold uppercase tracking-wide text-text-dim`}>Capabilities</span>
    {shown.length === 0 ? <span className="truncate text-xs text-text-dim">{compact ? "+" : "None attached"}</span> : (
      <div className="flex min-w-0 items-center gap-1.5" aria-label="Attached capabilities">
        {shown.map((capability, index) => <span key={capability.key}
          role="img" aria-label={`${capability.kind}: ${capability.name}`}
          title={`${capability.kind === "mcp" ? "MCP server" : capability.kind}: ${capability.name}`}
          className={`${compact && index > 0 ? "hidden sm:inline-flex" : "inline-flex"} h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-bg-input text-accent`}>
          {capability.src
            ? <AppIcon src={capability.src} iconStyle={capability.iconStyle} name={capability.name} size="sm"
                framed={false} className={capability.kind === "integration" ? "rounded bg-white text-gray-800" : "rounded"} />
            : capability.kind === "skill" ? <span aria-hidden="true" className="text-sm">✦</span>
              : <span aria-hidden="true" className="text-xs font-bold">{capability.name.slice(0, 1).toUpperCase()}</span>}
        </span>)}
        {compact && capabilities.length > 1 && <span className="inline-flex h-7 items-center text-[10px] text-text-muted sm:hidden" title={capabilities.slice(1).map((item) => item.name).join(", ")}>+{capabilities.length - 1}</span>}
        {hidden.length > 0 && <span title={hidden.map((item) => `${item.kind}: ${item.name}`).join(", ")}
          className={`${compact ? "hidden sm:inline-flex" : "inline-flex"} h-7 shrink-0 items-center rounded-md border border-border bg-bg-hover px-1.5 text-[10px] text-text-muted`}>
          +{hidden.length}
        </span>}
      </div>
    )}
  </div>;
}
