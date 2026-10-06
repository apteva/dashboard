import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { useProjectUILayout, type WorkspacePage } from "../apps/contributions";
import { Modal } from "../Modal";
import { pageEditorHref, pageHref } from "./pages";

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none";
const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-xs font-semibold text-text-muted hover:border-accent hover:text-text disabled:opacity-50";

type Draft = { id?: string; title: string; description: string; scope: "project" | "global"; layout: "grid" | "workspace"; projectId: string; pinned: boolean };

export function PagesSettings() {
  const { projects, currentProject } = useProjects();
  const { document } = useProjectUILayout(currentProject?.id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<{ page: WorkspacePage; projectId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allPages = [
    ...(document.global?.pages || []).map((page) => ({ page: { ...page, scope: "global" as const }, projectId: undefined as string | undefined, scopeName: "Global" })),
    ...projects.flatMap((project) => (document.projects?.[project.id]?.pages || []).map((page) => ({ page: { ...page, scope: "project" as const }, projectId: project.id, scopeName: project.name }))),
  ];
  const selected = allPages.find(({ page, projectId }) => page.id === params.get("page") && (params.get("scope") === "global" ? page.scope === "global" : projectId === params.get("project")));
  const publish = (response: { ui_layout: Record<string, unknown>; revision: number }) => {
    window.dispatchEvent(new CustomEvent("apteva:ui-layout-changed", { detail: { document: response.ui_layout, revision: response.revision } }));
  };
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const response = await auth.mutateUIPage(draft.id ? "PATCH" : "POST", {
        id: draft.id, scope: draft.scope, project_id: draft.scope === "project" ? draft.projectId : undefined,
        title: draft.title.trim(), description: draft.description.trim(), pinned: draft.pinned, layout: draft.layout,
      });
      publish(response);
      if (!draft.id) navigate(pageEditorHref({ id: response.page.id, title: draft.title.trim(), kind: "custom", scope: draft.scope }, draft.projectId));
      setDraft(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save page."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true); setError("");
    try {
      publish(await auth.mutateUIPage("DELETE", { id: deleting.page.id, scope: deleting.page.scope, project_id: deleting.projectId }));
      if (params.get("page") === deleting.page.id) setParams({ tab: "pages" });
      setDeleting(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not delete page."); }
    finally { setBusy(false); }
  };
  const openProperties = (page: WorkspacePage, projectId?: string) => {
    setError(""); setDraft({ id: page.id, title: page.title, description: page.description || "", scope: page.scope, layout: page.layout || "grid", projectId: projectId || "", pinned: page.pinned !== false });
  };
  const startPage = (title = "", description = "") => {
    setError("");
    setDraft({
      title,
      description,
      layout: "grid",
      scope: currentProject ? "project" : "global",
      projectId: currentProject?.id || "",
      pinned: true,
    });
  };

  // Older editor links still open the same page in its full-size editor.
  if (selected) return <Navigate to={pageEditorHref(selected.page, selected.projectId)} replace />;

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-medium text-text">Pages</h2><p className="mt-1 max-w-2xl text-sm text-text-muted">Create your own workspaces with app widgets, agent activity, and usage. Pages and layouts are saved to your account; global pages work across projects.</p></div>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} onClick={() => startPage("Build", "A focused workspace for the work you are building.")}>Create Build page</button>
        <button className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-bg hover:bg-accent-hover" onClick={() => startPage()}>Create page</button>
      </div>
    </header>
    {error && !draft && !deleting && <p role="alert" className="text-sm text-red">{error}</p>}
    <>
      {allPages.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center"><h3 className="text-sm font-semibold">No pages yet</h3><p className="mt-2 text-sm text-text-muted">Start with a blank page, give it a name, then add the widgets you need.</p></div> : <div className="grid gap-3 lg:grid-cols-2">{allPages.map(({ page, projectId, scopeName }) => <article key={`${projectId || "global"}:${page.id}`} className="min-w-0 rounded-lg border border-border p-4">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/40 text-accent" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{page.title}</h3><p className="mt-1 text-xs text-text-dim">{scopeName} · {page.pinned !== false ? "In sidebar" : "Unpinned"}</p></div></div>
        {page.description && <p className="mt-3 line-clamp-2 text-sm text-text-muted">{page.description}</p>}
        <div className="mt-4 flex flex-wrap gap-2"><Link className={buttonClass} to={pageHref(page, projectId)}>Open</Link><Link className={buttonClass} to={pageEditorHref(page, projectId)}>Edit widgets</Link><button className={buttonClass} onClick={() => openProperties(page, projectId)}>Settings</button><button className={`${buttonClass} ml-auto`} onClick={() => { setError(""); setDeleting({ page, projectId }); }}>Delete</button></div>
      </article>)}</div>}
    </>
    <Modal open={!!draft} onClose={() => !busy && setDraft(null)} ariaLabel={draft?.id ? "Page settings" : "Create page"} width="max-w-lg">
      {draft && <form className="space-y-4 overflow-auto p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h3 className="text-lg font-semibold">{draft.id ? "Page settings" : "Create page"}</h3>
        <label className="block space-y-1 text-xs text-text-muted"><span>Name</span><input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={inputClass} placeholder="e.g. Build, Sales, My workspace" /></label>
        <label className="block space-y-1 text-xs text-text-muted"><span>Description</span><textarea maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={inputClass} rows={2} /></label>
        <label className="block space-y-1 text-xs text-text-muted"><span>Scope</span><select disabled={!!draft.id} className={inputClass} value={draft.scope === "global" ? "global" : draft.projectId} onChange={(event) => setDraft({ ...draft, scope: event.target.value === "global" ? "global" : "project", projectId: event.target.value === "global" ? "" : event.target.value })}><option value="global">Global · all projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label className="block space-y-1 text-xs text-text-muted"><span>Layout</span><select className={inputClass} value={draft.layout} onChange={event => setDraft({ ...draft, layout: event.target.value as Draft["layout"] })}><option value="grid">Widget grid</option><option value="workspace">Workspace · side panel, main view, and details</option></select><span>Assign widgets to each area in Edit widgets.</span></label>
        <label className="flex min-h-10 items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} />Show in sidebar</label>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => setDraft(null)}>Cancel</button><button disabled={busy || !draft.title.trim()} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-bg disabled:opacity-50">{busy ? "Saving…" : draft.id ? "Save" : "Create and add widgets"}</button></div>
      </form>}
    </Modal>
    <Modal open={!!deleting} onClose={() => !busy && setDeleting(null)} ariaLabel="Delete page" width="max-w-md"><div className="space-y-4 p-5"><h3 className="text-lg font-semibold">Delete {deleting?.page.title}?</h3><p className="text-sm text-text-muted">This removes the page and its widget layout. Your apps, agents, and their data remain available.</p>{error && <p role="alert" className="text-sm text-red">{error}</p>}<div className="flex justify-end gap-2"><button disabled={busy} className={buttonClass} onClick={() => setDeleting(null)}>Cancel</button><button disabled={busy} className="min-h-10 rounded-lg border border-red px-4 text-sm text-red disabled:opacity-50" onClick={() => void remove()}>{busy ? "Deleting…" : "Delete page"}</button></div></div></Modal>
  </div>;
}
