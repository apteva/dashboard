import type { AppRow, MarketplaceEntry } from "../api";

export interface AgentAppRecommendation {
  slug: string;
  name: string;
  reason: string;
  icon?: string;
  iconStyle?: "image" | "monochrome";
  installed?: AppRow;
  catalog?: MarketplaceEntry;
  fromTemplate: boolean;
}

// Installed metadata wins over registry hints, including an installed release
// that no longer recommends itself. Scope and identity use the normal app list.
export function agentAppRecommendations(
  installed: AppRow[],
  catalog: MarketplaceEntry[],
  templateSlugs: string[],
  selectedSlugs: Set<string>,
  projectId?: string,
): AgentAppRecommendation[] {
  const visible = installed.filter(
    (app) => !app.project_id || app.project_id === projectId,
  );
  const candidates = new Set([
    ...visible.map((app) => app.name),
    ...catalog.map((app) => app.name),
  ]);
  const result: AgentAppRecommendation[] = [];
  for (const slug of candidates) {
    if (selectedSlugs.has(slug)) continue;
    const installs = visible.filter((app) => app.name === slug);
    const app =
      installs.find((app) => !!projectId && app.project_id === projectId) ||
      installs[0];
    const entry = catalog.find((entry) => entry.name === slug);
    const metadata = app ? app.agent_setup : entry?.agent_setup;
    const fromTemplate = templateSlugs.includes(slug);
    if (
      (!metadata?.recommended && !fromTemplate) ||
      app?.deprecated ||
      (!app && entry?.deprecated)
    )
      continue;
    result.push({
      slug,
      name: app?.display_name || entry?.display_name || slug,
      reason:
        metadata?.reason ||
        (fromTemplate
          ? "Suggested by the selected template."
          : app?.description || entry?.description || ""),
      icon: app?.icon || entry?.icon,
      iconStyle: app?.icon_style || entry?.icon_style,
      installed: app,
      catalog: entry,
      fromTemplate,
    });
  }
  return result.sort(
    (a, b) =>
      Number(b.fromTemplate) - Number(a.fromTemplate) ||
      Number(!!b.installed) - Number(!!a.installed) ||
      a.name.localeCompare(b.name),
  );
}
