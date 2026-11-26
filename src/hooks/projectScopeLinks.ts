// The sidebar picker's value for All projects.
export const ALL_PROJECTS_VALUE = "__all_projects__";

export interface ScopeLink {
  scope: "all" | "project";
  /** The linked project, when it exists. */
  projectId?: string;
  /** True when the parameter should be removed after applying it. */
  strip: boolean;
}

// Screens whose scope comes only from the sidebar. On these, `?scope=all` and
// `?project=` are one-time links: they move the sidebar, then disappear.
const SIDEBAR_SCOPED_PATHS = new Set(["/", "/analytics"]);

// scopeFromLink reads a scope a link asks for. Project pages keep their
// `?project=` (it names the page's project) but still move the sidebar to it.
export function scopeFromLink(pathname: string, params: URLSearchParams, projectIds: readonly string[]): ScopeLink | null {
  const requested = params.get("project");
  const known = requested && projectIds.includes(requested) ? requested : undefined;
  if (SIDEBAR_SCOPED_PATHS.has(pathname)) {
    if (params.get("scope") === "all") return { scope: "all", strip: true };
    if (requested) return { scope: "project", projectId: known, strip: true };
    return null;
  }
  if (pathname.startsWith("/pages/") && known && params.get("scope") !== "global") {
    return { scope: "project", projectId: known, strip: false };
  }
  return null;
}
