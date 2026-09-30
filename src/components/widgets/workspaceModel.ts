import type { WidgetResourceRef } from "../apps/widgetContext";
import { agentCardCapabilities } from "../AgentCapabilityIcons";
import type { WorkspaceData } from "./useWorkspaceData";

export interface WorkspaceResource {
  ref: WidgetResourceRef; name: string; description: string; status: string;
  icon?: string; iconStyle?: "image" | "monochrome"; agentIcon?: string;
  href?: string; configureHref?: string; fields: Array<[string, string]>;
}
export const resourceKey = (ref: WidgetResourceRef) => `${ref.type}:${ref.id}`;
export function workspaceModel(data: WorkspaceData) {
  const resources = new Map<string, WorkspaceResource>();
  const add = (resource: WorkspaceResource) => resources.set(resourceKey(resource.ref), resource);
  for (const agent of data.agents) {
    const status = data.statuses.find(row => row.instance_id === agent.id && !row.stale);
    add({ ref: { type: "agent", id: agent.id, label: agent.name, projectId: agent.project_id }, name: agent.name,
      description: agent.directive, status: agent.status === "running" ? "Online" : agent.status,
      agentIcon: agent.icon, href: `/agents/${agent.id}`, configureHref: `/agents/${agent.id}`,
      fields: [["Runtime", agent.status], ["Reported", status?.title || "No status reported"], ["Mode", agent.mode]] });
  }
  for (const app of data.apps) add({ ref: { type: "app", id: app.install_id, label: app.display_name || app.name, projectId: app.project_id },
    name: app.display_name || app.name, description: app.description, status: app.status, icon: app.icon, iconStyle: app.icon_style,
    href: app.ui_panels?.some(panel => panel.slot === "project.page") ? `/apps/${encodeURIComponent(app.name)}/page?project=${encodeURIComponent(app.project_id || "")}` : "/apps",
    configureHref: "/apps", fields: [["Version", app.version], ["Tools", String(app.surfaces?.mcp_tool_names?.length || 0)], ["Status", app.error_message || app.status_message || app.status]] });
  for (const connection of data.connections) add({ ref: { type: "integration", id: connection.id, label: connection.name || connection.app_name, projectId: connection.project_id },
    name: connection.name || connection.app_name, description: connection.app_name, status: connection.status, icon: connection.logo, href: "/integrations", configureHref: "/integrations",
    fields: [["Service", connection.app_name], ["Tools", String(connection.tool_count)], ["Authentication", connection.auth_type]] });
  for (const skill of data.skills) add({ ref: { type: "skill", id: skill.id, label: skill.name, projectId: skill.project_id }, name: skill.name,
    description: skill.description, status: skill.enabled ? "Enabled" : "Disabled", href: "/skills", configureHref: "/skills", fields: [["Source", skill.app_name || skill.source], ["Version", skill.version]] });
  const edges = new Map<number, string[]>();
  for (const agent of data.agents) {
    const attachments = data.attachments[agent.id];
    if (!attachments) continue;
    const catalog = { apps: data.apps.filter(app => !app.project_id || app.project_id === agent.project_id), connections: data.connections.filter(c => !c.project_id || c.project_id === agent.project_id), inventory: data.inventory.filter(row => !row.project_id || row.project_id === agent.project_id) };
    const attached = agentCardCapabilities(attachments.servers, attachments.skills, catalog);
    const keys: string[] = [];
    for (const capability of attached) {
      let key = capability.key.replace(/^connection:/, "integration:");
      if (!resources.has(key)) {
        // Keep unresolved attachments visible without inventing an app identity.
        key = `mcp:${agent.id}:${capability.key}`;
        add({ ref: { type: "mcp", id: `${agent.id}:${capability.key}`, label: capability.name, agentId: agent.id, projectId: agent.project_id }, name: capability.name,
          description: "Configured capability. Open the agent to manage this attachment.", status: "Attached", icon: capability.src,
          href: `/agents/${agent.id}`, configureHref: `/agents/${agent.id}`, fields: [["Agent", agent.name], ["Kind", capability.kind]] });
      }
      keys.push(key);
    }
    edges.set(agent.id, keys);
  }
  return { resources, edges };
}
