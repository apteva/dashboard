import { useState, useEffect } from "react";

import { projects as projectsAPI, projectMembers, projectInvites, adminUsers, type Project, type ProjectMember, type ProjectInvite, type ProjectRole, type AdminUser } from "../../api";

import { Modal } from "../../components/Modal";

import { useProjects } from "../../hooks/useProjects";
import { useAuth } from "../../hooks/useAuth";

import { ProjectPresetSetup } from "../../components/projects/ProjectPresetSetup";

const PROJECT_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4"];

export function ProjectsTab() {
  const { projects, currentProject, setCurrentProject, reload } = useProjects();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  // Which project's Members modal is open. Null when closed.
  const [membersFor, setMembersFor] = useState<string | null>(null);
  const [setupFor, setSetupFor] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const p = await projectsAPI.create(name.trim(), description.trim(), color);
    if (!currentProject) setCurrentProject(p);
    reload();
    setName(""); setDescription(""); setColor(PROJECT_COLORS[0]); setShowCreate(false);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !name.trim()) return;
    await projectsAPI.update(editingId, name.trim(), description.trim(), color);
    reload();
    setEditingId(null); setName(""); setDescription(""); setColor(PROJECT_COLORS[0]);
  };

  const handleDelete = async (id: string) => {
    await projectsAPI.delete(id);
    if (currentProject?.id === id) setCurrentProject(null);
    reload();
  };

  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description);
    setColor(p.color);
  };
  const ownedProjectCount = user ? projects.filter((project) => project.user_id === user.id).length : 0;
  const canCreateProject = !!user && (user.role === "admin" || user.limits.projects_per_user === 0 || ownedProjectCount < user.limits.projects_per_user);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text text-base font-bold">Projects</h2>
        <p className="text-text-muted text-sm mt-1">
          Organize instances, connections, and subscriptions by business or use case.
        </p>
      </div>
      <button
        onClick={() => { setShowCreate(true); setEditingId(null); setName(""); setDescription(""); setColor(PROJECT_COLORS[0]); }}
        disabled={!canCreateProject}
        className="px-4 py-2.5 bg-accent text-bg rounded-lg text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        New Project
      </button>
      {!canCreateProject && user && <p className="text-xs text-text-dim">This account has reached its project limit.</p>}

      {projects.length === 0 && (
        <p className="text-text-dim text-sm">No projects yet. Create one to get started.</p>
      )}

      <div className="space-y-3">
        {projects.map((p) => (
          <div key={p.id} className={`border rounded-lg p-4 bg-bg-card flex items-center justify-between ${currentProject?.id === p.id ? "border-accent" : "border-border"}`}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
              <div>
                <span className="text-text text-sm font-bold">{p.name}</span>
                {p.description && <p className="text-text-dim text-xs mt-0.5">{p.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {currentProject?.id !== p.id && (
                <button onClick={() => setCurrentProject(p)} className="text-xs text-accent hover:text-accent-hover transition-colors">
                  Switch
                </button>
              )}
              {currentProject?.id === p.id && (
                <span className="text-xs text-accent">Active</span>
              )}
              <button onClick={() => setMembersFor(p.id)} className="text-xs text-text-muted hover:text-text transition-colors">
                Members
              </button>
              <button onClick={() => setSetupFor(p.id)} className="text-xs text-text-muted hover:text-text transition-colors">
                Set up
              </button>
              <button onClick={() => openEdit(p)} className="text-xs text-text-muted hover:text-text transition-colors">
                Edit
              </button>
              <button onClick={() => handleDelete(p.id)} className="text-xs text-text-muted hover:text-red transition-colors">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit modal */}
      <Modal open={showCreate || !!editingId} onClose={() => { setShowCreate(false); setEditingId(null); }}>
        <form onSubmit={editingId ? handleUpdate : handleCreate} className="p-6 space-y-4">
          <h3 className="text-text text-base font-bold">{editingId ? "Edit Project" : "New Project"}</h3>
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)} autoFocus
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
              placeholder="e.g. Business A"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Description (optional)</label>
            <input
              value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text focus:outline-none focus:border-accent"
              placeholder="What this project is for"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Color</label>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c} type="button" onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-colors ${color === c ? "border-text" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { setShowCreate(false); setEditingId(null); }}
              className="px-4 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors">
              {editingId ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Members modal — opens from a per-project "Members" button.
          Owners (and platform admins) get inline role-edit + remove +
          invite affordances; viewers and editors get a read-only
          listing. The modal owns its own data fetch so opening/closing
          doesn't perturb the surrounding ProjectsTab state. */}
      {membersFor && (
        <Modal open={!!membersFor} onClose={() => setMembersFor(null)}>
          <ProjectMembersPane
            projectID={membersFor}
            projectName={projects.find((p) => p.id === membersFor)?.name || ""}
            onClose={() => setMembersFor(null)}
          />
        </Modal>
      )}
      {setupFor && (
        <Modal open={!!setupFor} onClose={() => setSetupFor(null)} width="max-w-4xl" ariaLabel="Set up project">
          <div className="p-6 overflow-y-auto">
            <ProjectPresetSetup projectId={setupFor} onApplied={() => void reload()} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ProjectMembersPane — modal body for managing a single project's
// members + pending invites. Self-contained: owns its own data
// fetches, refreshes after every mutation.
function ProjectMembersPane({
  projectID,
  projectName,
  onClose,
}: {
  projectID: string;
  projectName: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = !!user && user.role === "admin";
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("editor");
  const [creatingInvite, setCreatingInvite] = useState(false);
  // Admin-only: full user roster fetched on modal open. Non-admins
  // can't (and shouldn't) see other users' emails — they stay on
  // the type-email-by-hand form.
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);

  // The caller's role on THIS project drives the can-edit gating. A
  // non-owner who somehow opens the modal sees a read-only view. Admins
  // are always treated as effective owners (matches server-side
  // requireProjectAccess short-circuit).
  const myRole: ProjectRole | null = user
    ? (members.find((m) => m.user_id === user.id)?.role
        || (user.role === "admin" ? "owner" : null))
    : null;
  const canManage = myRole === "owner";
  const canInvite = canManage && !!user && (isAdmin || user.capabilities.invitations);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [m, i, u] = await Promise.all([
        projectMembers.list(projectID),
        projectInvites.list(projectID),
        // /admin/users is 403 for non-admins — swallow the error so
        // the rest of the modal still loads. Empty list means "no
        // picker, just the type-email form".
        isAdmin ? adminUsers.list().catch(() => [] as AdminUser[]) : Promise.resolve([] as AdminUser[]),
      ]);
      setMembers(m);
      setInvites(i);
      setAllUsers(u);
    } catch (e: any) {
      setErr(e?.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectID]);

  // Pickable = every user on the platform minus those already in
  // this project's members list. The picker hides itself entirely
  // when the set is empty (everyone's already in) or when the
  // caller isn't an admin.
  const memberIDs = new Set(members.map((m) => m.user_id));
  const pickable = allUsers.filter((u) => !memberIDs.has(u.id));

  // notice — short-lived confirmation banner after an invite action.
  // "added" path tells the operator the existing user is in now; the
  // "invited" path is silent because the new pending invite row
  // appears in the list above and is self-explanatory.
  const [notice, setNotice] = useState<string | null>(null);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setCreatingInvite(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await projectInvites.create(projectID, inviteEmail.trim(), inviteRole);
      if (res.kind === "added") {
        setNotice(`Added ${res.email} as ${res.role}.`);
      } else {
        setNotice(`Invite sent to ${res.invite.email}. Use "Copy link" if your mail isn't auto-delivered.`);
      }
      setInviteEmail("");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to create invite");
    } finally {
      setCreatingInvite(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/login?invite=${encodeURIComponent(token)}`;
    void navigator.clipboard.writeText(url).catch(() => {});
  };

  const changeRole = async (uid: number, role: ProjectRole) => {
    setErr(null);
    try {
      await projectMembers.updateRole(projectID, uid, role);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to update role");
    }
  };

  const removeMember = async (uid: number) => {
    setErr(null);
    try {
      await projectMembers.remove(projectID, uid);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to remove member");
    }
  };

  const revokeInvite = async (token: string) => {
    setErr(null);
    try {
      await projectInvites.revoke(projectID, token);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to revoke invite");
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 w-full max-w-lg">
      <div>
        <h3 className="text-text text-base font-bold">Members of {projectName}</h3>
        <p className="text-text-muted text-xs mt-1">
          {canManage
            ? "Owners can change roles, remove members, and send invites."
            : "Read-only — only project owners can change membership."}
        </p>
      </div>

      {err && (
        <div className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
          {err}
        </div>
      )}
      {notice && (
        <div className="text-green text-xs bg-green/10 border border-green/30 rounded px-3 py-2">
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-text-muted text-sm">Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-text text-sm truncate">{m.email}</div>
                  <div className="text-text-dim text-[11px]">User #{m.user_id}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && user && m.user_id !== user.id ? (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.user_id, e.target.value as ProjectRole)}
                        className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        onClick={() => removeMember(m.user_id)}
                        className="text-[11px] text-text-muted hover:text-red transition-colors"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-text-muted capitalize">{m.role}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {invites.length > 0 && (
            <div>
              <h4 className="text-text-muted text-xs uppercase tracking-wide mb-2">Pending invites</h4>
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 border border-dashed border-border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-text text-sm truncate">{inv.email}</div>
                      <div className="text-text-dim text-[11px] capitalize">
                        {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    {canInvite && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => copyInviteLink(inv.id)}
                          className="text-[11px] text-accent hover:text-accent-hover transition-colors"
                          title="Copy invite link to clipboard"
                        >
                          Copy link
                        </button>
                        <button
                          onClick={() => revokeInvite(inv.id)}
                          className="text-[11px] text-text-muted hover:text-red transition-colors"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canInvite && pickable.length > 0 && (
            <div className="border-t border-border pt-4 space-y-2">
              <h4 className="text-text-muted text-xs uppercase tracking-wide">Add an existing user</h4>
              <div className="space-y-1.5">
                {pickable.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-1.5">
                    <div className="text-text text-sm truncate">{u.email}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        defaultValue="editor"
                        id={`role-${u.id}`}
                        className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        onClick={async () => {
                          const select = document.getElementById(`role-${u.id}`) as HTMLSelectElement | null;
                          const role = (select?.value || "editor") as ProjectRole;
                          setErr(null);
                          setNotice(null);
                          try {
                            await projectInvites.create(projectID, u.email, role);
                            setNotice(`Added ${u.email} as ${role}.`);
                            await load();
                          } catch (e: any) {
                            setErr(e?.message || "Failed to add user");
                          }
                        }}
                        className="text-[11px] text-accent hover:text-accent-hover transition-colors font-bold"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-text-dim text-[11px]">
                Existing accounts on this server. Pick a role and click <b>Add</b> — no invite link needed.
              </p>
            </div>
          )}

          {canInvite && (
            <form onSubmit={submitInvite} className="border-t border-border pt-4 space-y-2">
              <h4 className="text-text-muted text-xs uppercase tracking-wide">{pickable.length > 0 ? "Invite someone new" : "Add or invite someone"}</h4>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="flex-1 bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                  required
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                  className="bg-bg-input border border-border rounded-lg px-2 py-2 text-xs text-text focus:outline-none focus:border-accent"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingInvite}
                  className="px-3 py-2 bg-accent text-bg rounded-lg text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {creatingInvite ? "…" : "Send"}
                </button>
              </div>
              <p className="text-text-dim text-[11px]">
                If the email already has an account on this server, they're added
                immediately. Otherwise an invite link is minted — click "Copy link"
                on the pending invite to send it.
              </p>
            </form>
          )}
        </>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 border border-border rounded-lg text-text-muted hover:text-text transition-colors text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
