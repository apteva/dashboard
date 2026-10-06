import type { WorkspacePage } from "../apps/contributions";

export function pageHref(page: WorkspacePage, projectId?: string) {
  return `/pages/${encodeURIComponent(page.id)}?${page.scope === "global" ? "scope=global" : `project=${encodeURIComponent(projectId || "")}`}`;
}

export function pageEditorHref(page: WorkspacePage, projectId?: string) {
  return `${pageHref(page, projectId)}&edit=1`;
}
