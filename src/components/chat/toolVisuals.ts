import { useEffect, useMemo, useState } from "react";
import { integrations, type ConnectionInfo } from "../../api";
import type { InstalledAppRow } from "../apps/chatComponents";

export type ToolGlyph =
  | "agent"
  | "chart"
  | "document"
  | "globe"
  | "memory"
  | "message"
  | "search"
  | "table"
  | "tool";

export interface ToolVisual {
  key: string;
  label: string;
  iconUrl?: string;
  glyph: ToolGlyph;
}

interface ToolVisualSource extends ToolVisual {
  aliases: string[];
  exactTools: string[];
}

export interface ToolVisualRegistry {
  exact: Map<string, ToolVisualSource>;
  sources: ToolVisualSource[];
}

function normalizeToolToken(value: string | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueTokens(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(normalizeToolToken).filter(Boolean)));
}

function visualGlyphForName(value: string): ToolGlyph {
  const name = normalizeToolToken(value);
  if (name.includes("memory") || name === "remember" || name === "evolve") return "memory";
  if (name.includes("search") || name.includes("find")) return "search";
  if (name.includes("sheet") || name.includes("table")) return "table";
  if (name.includes("report") || name.includes("document") || name.includes("file")) return "document";
  if (name.includes("message") || name.includes("channel") || name.includes("send")) return "message";
  if (name.includes("analytics") || name.includes("metric") || name.includes("stats")) return "chart";
  if (name.includes("browser") || name.includes("web") || name.includes("http")) return "globe";
  if (name === "spawn" || name === "update" || name === "kill") return "agent";
  return "tool";
}

function appSource(app: InstalledAppRow): ToolVisualSource {
  const label = app.display_name || app.name || "App";
  const tools = app.surfaces?.mcp_tool_names || [];
  return {
    key: `app:${app.install_id || app.name}`,
    label,
    iconUrl: app.icon,
    glyph: visualGlyphForName(`${app.name} ${label}`),
    aliases: uniqueTokens([app.name, app.display_name]),
    exactTools: uniqueTokens(tools),
  };
}

function connectionSources(connections: ConnectionInfo[]): ToolVisualSource[] {
  const bySlug = new Map<string, ToolVisualSource>();
  for (const connection of connections) {
    const slug = normalizeToolToken(connection.app_slug || connection.app_name || connection.name);
    if (!slug) continue;
    const existing = bySlug.get(slug);
    const aliases = uniqueTokens([
      ...(existing?.aliases || []),
      connection.app_slug,
      connection.app_name,
      connection.name,
    ]);
    bySlug.set(slug, {
      key: existing?.key || `integration:${slug}`,
      label: existing?.label || connection.app_name || connection.name || connection.app_slug || "Integration",
      iconUrl: existing?.iconUrl || connection.logo,
      glyph: existing?.glyph || visualGlyphForName(`${connection.app_slug} ${connection.app_name}`),
      aliases,
      exactTools: existing?.exactTools || [],
    });
  }
  return [...bySlug.values()];
}

export function buildToolVisualRegistry(
  apps: InstalledAppRow[],
  connections: ConnectionInfo[],
): ToolVisualRegistry {
  const sources = [...apps.map(appSource), ...connectionSources(connections)];
  const exact = new Map<string, ToolVisualSource>();
  for (const source of sources) {
    for (const tool of source.exactTools) exact.set(tool, source);
  }
  sources.sort((a, b) => {
    const aLength = Math.max(0, ...a.aliases.map((alias) => alias.length));
    const bLength = Math.max(0, ...b.aliases.map((alias) => alias.length));
    return bLength - aLength;
  });
  return { exact, sources };
}

export function resolveToolVisual(name: string, registry: ToolVisualRegistry): ToolVisual {
  const normalized = normalizeToolToken(name);
  const exact = registry.exact.get(normalized);
  if (exact) return exact;
  const source = registry.sources.find((candidate) =>
    candidate.aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias}_`)),
  );
  if (source) return source;
  return {
    key: `native:${normalized || "tool"}`,
    label: "Apteva tool",
    glyph: visualGlyphForName(normalized),
  };
}

export function useToolVisualRegistry(
  projectId: string | null | undefined,
  apps: InstalledAppRow[],
): ToolVisualRegistry {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  useEffect(() => {
    if (!projectId) {
      setConnections([]);
      return;
    }
    let cancelled = false;
    integrations.connections(projectId, { includeAppOwned: true })
      .then((rows) => {
        if (!cancelled) setConnections(rows || []);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return useMemo(() => buildToolVisualRegistry(apps, connections), [apps, connections]);
}

