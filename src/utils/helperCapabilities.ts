import type { MCPServer } from "../api";

const HELPER_CAPABILITY_SOURCES = new Set(["app", "local", "remote"]);

export function globalHelperCapabilityInventory(rows: MCPServer[]): MCPServer[] {
  return rows
    .filter((row) =>
      !row.project_id
      && HELPER_CAPABILITY_SOURCES.has(row.source)
      && !!row.proxy_config,
    )
    .sort((left, right) =>
      helperCapabilityLabel(left).localeCompare(helperCapabilityLabel(right)),
    );
}

export function helperCapabilityLabel(row: MCPServer): string {
  return row.description || row.name;
}

export function helperCapabilityKind(row: MCPServer): string {
  if (row.source === "app") return "app";
  return "integration";
}
