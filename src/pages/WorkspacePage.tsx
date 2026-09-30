import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useProjectUILayout } from "../components/apps/contributions";
import { useProjects } from "../hooks/useProjects";
import { Dashboard } from "./Dashboard";

export function WorkspacePage() {
  const { pageId } = useParams();
  const [params] = useSearchParams();
  const { currentProject, projects, loaded, setCurrentProject } = useProjects();
  const global = params.get("scope") === "global";
  const projectId = params.get("project") || currentProject?.id;
  const { project } = useProjectUILayout(projectId, global ? "global" : "project");
  const page = project.pages?.find((page) => page.id === pageId);
  useEffect(() => {
    if (global || !page || !projectId || currentProject?.id === projectId) return;
    const requested = projects.find(project => project.id === projectId);
    if (requested) setCurrentProject(requested);
  }, [global, page?.id, projectId, currentProject?.id, projects]);
  if (!loaded) return <div className="p-6 text-sm text-text-muted">Loading page…</div>;
  if (!page || (!global && !projects.some((project) => project.id === projectId))) {
    return <div className="p-6"><h1 className="text-lg font-bold">Page unavailable</h1><p className="mt-2 text-sm text-text-muted">This page was removed or is outside your available projects.</p><Link to="/settings?tab=pages" className="mt-4 inline-block text-sm text-accent">Manage pages</Link></div>;
  }
  return <Dashboard key={`${global ? "global" : projectId}:${page.id}`} page={{ ...page, scope: global ? "global" : "project" }} pageProjectId={global ? undefined : projectId} />;
}
