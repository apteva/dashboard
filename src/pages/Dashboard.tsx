import { useWorkspaceSystem } from "../components/widgets/useWorkspaceSystem";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWorkspaceData } from "../components/widgets/useWorkspaceData";
import { useWorkspaceActivity } from "../components/widgets/useWorkspaceActivity";
import { InspectorWidget, ResultPreviewWidget } from "../components/widgets/SystemWidgets";
import { workspaceModel, resourceKey } from "../components/widgets/workspaceModel";
import { Modal } from "../components/Modal";
import type { WidgetPreview } from "../components/apps/widgetContext";
import { NewAgentButton } from "../components/NewAgentButton";
import { nativeWidgetDefinitions } from "../components/widgets/NativeWidgets";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";
import {
  ContributionMount,
  contributionsFor,
  defaultWidgetSettings,
  defaultWidgetSize,
  supportedWidgetSizes,
  type WorkspacePage,
} from "../components/apps/contributions";
import { WorkspaceCanvas } from "../components/apps/WorkspaceCanvas";
import { WidgetCanvas, type WidgetDefinition } from "../components/apps/WidgetCanvas";
import { useInstalledAppsState } from "../components/apps/chatComponents";
import {
  type WidgetAction,
  type WidgetContext,
  type WidgetResourceRef,
} from "../components/apps/widgetContext";

import { useWidgetVisibility } from "../components/apps/useWidgetVisibility";

export function Dashboard({ page, pageProjectId }: {
  page?: WorkspacePage;
  pageProjectId?: string;
} = {}) {
  usePageTitle(page?.title || "Home");
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [assistantRevision, setAssistantRevision] = useState(0);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { projects, currentProject, loaded: projectsLoaded, setCurrentProject } = useProjects();
  const allProjects = page ? page.scope === "global" : searchParams.get("scope") === "all";
  const requestedProject = projects.find((project) => project.id === (page ? pageProjectId : searchParams.get("project")));
  const selectedProject = allProjects ? undefined : page ? requestedProject : requestedProject || currentProject || undefined;
  const projectId = selectedProject?.id;
  const widgetSlot = page ? `page.${page.id}` : "dashboard.home";
  const editingRequested = !!page && searchParams.get("edit") === "1";
  const [editingLayout, setEditingLayout] = useState(editingRequested);
  const focused = page?.layout === "workspace" && !editingLayout;
  const [galleryRequest, setGalleryRequest] = useState(0);
  const { components: visibleWidgetComponents, reported: widgetsReported, onVisibleChange: handleVisibleComponentsChange } = useWidgetVisibility(JSON.stringify([projectId, allProjects, widgetSlot]));
  const [selectedResource, setSelectedResource] = useState<WidgetResourceRef>();
  const [activityId, setActivityId] = useState<string>();
  const [preview, setPreview] = useState<WidgetPreview>();
  const [actionError, setActionError] = useState("");
  const { apps: installedApps, ready: installedAppsReady } = useInstalledAppsState(
    projectId,
    allProjects ? "global" : "project",
  );
  const scopeReady = allProjects || (projectsLoaded && (!!projectId || projects.length === 0));
  const needsData = visibleWidgetComponents.some(component => component.startsWith("native:")) || !!selectedResource || !!preview;
  const needsRelationships = visibleWidgetComponents.some(component => ["native:system-map", "native:context-inspector", "native:activity", "native:result-preview", "native:quick-actions"].includes(component)) || !!selectedResource;
  const data = useWorkspaceData(projectId, allProjects, scopeReady && needsData, needsRelationships, projects.map(project => project.id));
  const { agents, stats } = data;
  const activity = useWorkspaceActivity(agents, projectId, needsData && visibleWidgetComponents.some(component => ["native:activity", "native:result-preview", "native:system-map", "native:context-inspector"].includes(component)));

  const system = useWorkspaceSystem(data, activity.rows, allProjects ? "global" : projectId || "", needsData);

  useEffect(() => {
    setEditingLayout(editingRequested);
  }, [projectId, allProjects, page?.id, editingRequested]);
  useEffect(() => {
    setSelectedResource(undefined); setActivityId(undefined); setPreview(undefined); setActionError("");
  }, [projectId, allProjects, page?.id]);

  const handleEditingChange = useCallback((editing: boolean) => {
    setEditingLayout(editing);
    if (!editing) setGalleryRequest(0);
    if (page) {
      setSearchParams(previous => {
        const next = new URLSearchParams(previous);
        if (editing) next.set("edit", "1");
        else next.delete("edit");
        return next;
      }, { replace: true });
    }
  }, [page?.id, setSearchParams]);
  const openWidgetGallery = () => {
    if (page) handleEditingChange(true);
    setGalleryRequest(value => value + 1);
  };

  const errorCount = stats.reduce((sum, row) => sum + row.errors, 0);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const widgetContext = useMemo<WidgetContext>(() => ({
    projectId,
    pageId: page?.id,
    scope: allProjects ? "global" : "project",
    selected: selectedResource,
    activityId, preview,
  }), [allProjects, page?.id, projectId, selectedResource, activityId, preview]);
  const handleWidgetAction = useCallback((action: WidgetAction) => {
    setActionError("");
    if (["select", "select_activity", "preview", "clear_selection"].includes(action.type)) setSelectionRevision(n => n + 1);
    if (action.type === "clear_selection") { setSelectedResource(undefined); setActivityId(undefined); setPreview(undefined); return; }
    if (action.type === "select" || action.type === "select_activity") {
      if (projectId && action.resource.projectId && action.resource.projectId !== projectId) { setActionError("This item belongs to another project."); return; }
      setSelectedResource(action.resource); setPreview(undefined);
      setActivityId(action.type === "select_activity" ? action.id : undefined);
      return;
    }
    if (action.type === "preview") {
      if (projectId && action.preview.resource?.projectId && action.preview.resource.projectId !== projectId) { setActionError("This output belongs to another project."); return; }
      setPreview(action.preview); setSelectedResource(action.preview.resource); setActivityId(undefined); return;
    }
    if (action.type === "ask_helper") {
      const detail = { prompt: action.prompt, context: widgetContext, handled: false, inline: visibleWidgetComponents.includes("native:helper") };
      window.dispatchEvent(new CustomEvent("apteva:helper-prompt", { detail }));
      if (detail.handled) setAssistantRevision(n => n + 1);
      if (!detail.handled) setActionError("Helper is unavailable for this project. Enable it and the Conversations chat assistant in Settings.");
      return;
    }
    if (action.type === "open" || action.type === "configure") {
      const resource = workspaceModel(data).resources.get(resourceKey(action.resource));
      const href = action.type === "configure" ? resource?.configureHref || resource?.href : resource?.href;
      const owner = projects.find(project => project.id === resource?.ref.projectId);
      if (owner && owner.id !== currentProject?.id) setCurrentProject(owner);
      if (href) navigate(href);
      else setActionError("This item has no available page in the current scope.");
      return;
    }
    setActionError("This action is not available here. Open the resource to use its own controls.");
  }, [navigate, widgetContext, data, projectId, visibleWidgetComponents, projects, currentProject?.id, setCurrentProject]);
  const nativeContext = {
    ...data, projectId, allProjects, projectNames, widgetContext, activity, system,
    widgetActions: { dispatch: handleWidgetAction, select: (resource: WidgetResourceRef) => handleWidgetAction({ type: "select", resource }) },
  };
  const appContributions = useMemo(
    () => contributionsFor(installedApps, widgetSlot, allProjects ? "global" : "project"),
    [allProjects, installedApps, widgetSlot],
  );
  const widgetDefinitions = useMemo<WidgetDefinition[]>(() => [
    ...nativeWidgetDefinitions(nativeContext),
    ...appContributions.map((contribution): WidgetDefinition => ({
      key: contribution.key,
      label: contribution.spec.label || contribution.spec.name,
      description: contribution.spec.description || contribution.app.display_name || contribution.app.name,
      icon: contribution.app.icon,
      iconStyle: contribution.app.icon_style,
      supportedSizes: supportedWidgetSizes(contribution.spec),
      defaultSize: defaultWidgetSize(contribution.spec),
      defaultSettings: defaultWidgetSettings(contribution.spec),
      settingsSchema: contribution.spec.settings_schema,
      suggested: contribution.spec.suggested,
      kind: "app",
      providerLabel: contribution.app.display_name || contribution.app.name,
      providerKey: contribution.app.name,
      render: (instance, renderContext) => (allProjects || projectId) ? (
        <ContributionMount
          instance={{ ...instance, contribution }}
          apps={installedApps}
          slot={widgetSlot}
          projectId={projectId}
          dashboardScope={allProjects ? "global" : "project"}
          widgetContext={renderContext?.context || widgetContext}
          widgetActions={renderContext?.actions}
        />
      ) : null,
    })),
  ], [data, activity, system, allProjects, appContributions, handleWidgetAction, installedApps, projectId, projectNames, widgetContext, widgetSlot]);
  const chooseScope = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    if (value === "all") next.set("scope", "all");
    else { next.delete("scope"); next.set("project", value); }
    setSearchParams(next, { replace: true });
  };
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
        <div className={`flex items-center justify-between gap-3 ${focused ? "flex-wrap sm:flex-nowrap" : "flex-wrap"}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-text">{page?.title || "Home"}</h1>
                <span className="rounded border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                  {allProjects ? "All projects" : selectedProject?.name || "Current project"}
                </span>
              </div>
              {errorCount > 0 && (
                <Link
                  to={
                    projectId
                      ? `/monitor?project=${encodeURIComponent(projectId)}`
                      : "/monitor"
                  }
                  className="rounded border border-red/30 bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red hover:bg-red/15"
                >
                  {errorCount} error{errorCount === 1 ? "" : "s"}
                </Link>
              )}
            </div>
            <p className="mt-1 text-xs text-text-dim">
              {page ? page.description || "Your workspace widgets." : "What needs attention and what your agents are doing now."}
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {!page && <label className="min-w-0 sm:w-44">
              <span className="sr-only">Home scope</span>
              <select
                value={allProjects ? "all" : projectId || "all"}
                onChange={(event) => chooseScope(event.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-bg-input px-3 text-xs text-text outline-none focus:border-accent"
              >
                <option value="all">All projects</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>}
            <button
              type="button"
              data-tour="add-widget"
              onClick={openWidgetGallery}
              className="rounded-md border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:border-accent hover:text-text"
            >
              Add widget
            </button>
            <button
              type="button"
              onClick={() => handleEditingChange(!editingLayout)}
              aria-pressed={editingLayout}
              className={`rounded-md border px-3 py-2 text-xs font-semibold ${editingLayout ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:border-accent hover:text-text"}`}
            >
              {editingLayout ? "Done" : page ? "Edit page" : "Edit layout"}
            </button>
            {!page && <NewAgentButton />}
          </div>
        </div>
      </header>

      <main className={`page-safe-bottom min-h-0 flex-1 p-3 sm:p-4 ${focused ? "flex flex-col overflow-hidden" : "overflow-auto"}`}>
        {(data.errors.length > 0 || actionError) && <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-yellow/30 p-3 text-xs text-text-muted"><span className="flex-1">{actionError || data.errors.join(" ")}</span>{data.errors.length > 0 && <button className="text-accent" onClick={data.refresh}>Refresh</button>}{actionError && <button className="text-accent" onClick={() => setActionError("")}>Dismiss</button>}</div>}
        {page && installedAppsReady && widgetsReported && visibleWidgetComponents.length === 0 && <div className="mb-4 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-text-muted">{editingLayout ? "Add widgets to compose this page. You can resize, reorder, and configure each one." : "This page has no widgets yet."}</p>
          <button type="button" onClick={openWidgetGallery} className="mt-3 min-h-10 rounded-md border border-accent bg-accent px-4 text-xs font-semibold text-bg hover:brightness-110">Add your first widget</button>
        </div>}
        {focused ? <div className="min-h-0 flex-1"><WorkspaceCanvas projectId={projectId} slot={widgetSlot} definitions={widgetDefinitions} context={widgetContext} onAction={handleWidgetAction} ready={scopeReady && installedAppsReady} onVisibleChange={handleVisibleComponentsChange} selectionRevision={selectionRevision} assistantRevision={assistantRevision} /></div> : <WidgetCanvas
          workspaceLayout={page?.layout === "workspace"}
          projectId={projectId}
          layoutScope={allProjects ? "global" : "project"}
          slot={widgetSlot}
          definitions={widgetDefinitions}
          editing={editingLayout}
          keepEditingWhenEmpty={!!page}
          onEditingChange={handleEditingChange}
          onVisibleComponentsChange={handleVisibleComponentsChange}
          galleryRequest={galleryRequest}
          definitionsReady={scopeReady && installedAppsReady}
          context={widgetContext}
          onWidgetAction={handleWidgetAction}
        />}
      </main>
      <Modal open={!!selectedResource && !activityId && !visibleWidgetComponents.includes("native:context-inspector")} onClose={() => setSelectedResource(undefined)} ariaLabel="Resource inspector" width="max-w-xl"><InspectorWidget {...nativeContext} /></Modal>
      <Modal open={!!(activityId || preview) && !visibleWidgetComponents.includes("native:result-preview")} onClose={() => { setActivityId(undefined); setPreview(undefined); }} ariaLabel="Result preview" width="max-w-2xl"><div className="flex justify-end border-b border-border p-2"><button className="min-h-9 px-3 text-xs text-text-muted" onClick={() => { setActivityId(undefined); setPreview(undefined); }}>Close</button></div><ResultPreviewWidget {...nativeContext} /></Modal>
    </div>
  );
}
