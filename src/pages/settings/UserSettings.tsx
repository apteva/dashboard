import { useState, useEffect } from "react";

import { subscriptions, channels, users as usersAPI, adminUsers, type UserRow } from "../../api";

import { Modal } from "../../components/Modal";

export function UsersTab() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const load = () => {
    usersAPI.list()
      .then((r) => { setRows(r || []); setLoaded(true); setErr(""); })
      .catch((e) => { setErr(e?.message || String(e)); setLoaded(true); });
  };

  useEffect(() => { load(); }, []);

  // toggleRole flips the user's platform role via /admin/users PATCH.
  // Server enforces the "at least one admin must remain" invariant
  // and refuses self-demotion, so we just surface errors inline.
  const toggleRole = async (u: UserRow) => {
    setErr("");
    try {
      await adminUsers.setRole(u.id, u.is_admin ? "user" : "admin");
      load();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text text-base font-bold">Users</h2>
          <p className="text-text-muted text-xs mt-1">
            Admin-only. Create additional accounts directly — no invite
            flow. Share the initial password over a trusted channel;
            the new user can change it from their own Account menu.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="touch-target shrink-0 px-3 py-1.5 bg-accent text-bg text-xs font-bold rounded-lg hover:bg-accent-hover transition-colors"
        >
          + Add user
        </button>
      </div>

      {err && (
        <div className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
          {err}
        </div>
      )}

      {!loaded ? (
        <p className="text-text-muted text-xs">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-text-muted text-xs">No users yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="divide-y divide-border md:hidden">
            {rows.map((u) => (
              <article key={`mobile-${u.id}`} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-sm text-text">{u.email}</span>
                  {u.is_admin && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">admin</span>}
                  {u.is_self && !u.is_admin && <span className="rounded bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">you</span>}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[10px] uppercase tracking-wide text-text-dim">Created</dt><dd className="mt-0.5 text-text-muted">{fmtDate(u.created_at)}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wide text-text-dim">Owned</dt><dd className="mt-0.5 text-text-muted">{u.agents} agents · {u.keys} keys · {u.projects} projects</dd></div>
                </dl>
                <div className="grid grid-cols-2 gap-2">
                  {!u.is_self && <button type="button" onClick={() => toggleRole(u)} className="touch-target rounded-lg border border-border px-2 text-xs text-text-muted">{u.is_admin ? "Demote" : "Make admin"}</button>}
                  <button type="button" onClick={() => setResetTarget(u)} className="touch-target rounded-lg border border-border px-2 text-xs text-text-muted">Reset password</button>
                  {!u.is_admin && !u.is_self && <button type="button" onClick={() => setDeleteTarget(u)} className="touch-target rounded-lg border border-red/40 px-2 text-xs text-red">Delete</button>}
                </div>
              </article>
            ))}
          </div>
          <table className="hidden w-full text-xs md:table">
            <thead className="bg-bg-hover text-text-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-normal">Email</th>
                <th className="px-3 py-2 font-normal">Created</th>
                <th className="px-3 py-2 font-normal text-right">Agents</th>
                <th className="px-3 py-2 font-normal text-right">Keys</th>
                <th className="px-3 py-2 font-normal text-right">Projects</th>
                <th className="px-3 py-2 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-text">{u.email}</span>
                      {u.is_admin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent uppercase tracking-wide">admin</span>
                      )}
                      {u.is_self && !u.is_admin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-border text-text-muted uppercase tracking-wide">you</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{fmtDate(u.created_at)}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{u.agents}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{u.keys}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{u.projects}</td>
                  <td className="px-3 py-2 text-right">
                    {/* Role toggle. Hidden for self so an admin can't
                        accidentally demote themselves (server also
                        refuses). Promotes user → admin or demotes
                        admin → user via /admin/users PATCH. */}
                    {!u.is_self && (
                      <button
                        onClick={() => toggleRole(u)}
                        className="text-[10px] text-text-muted hover:text-accent transition-colors mr-3"
                        title={u.is_admin
                          ? "Demote to user — they keep their owned projects but lose platform-admin power"
                          : "Promote to admin — implicit owner on every project"}
                      >
                        {u.is_admin ? "Demote" : "Make admin"}
                      </button>
                    )}
                    <button
                      onClick={() => setResetTarget(u)}
                      className="text-[10px] text-text-muted hover:text-accent transition-colors mr-3"
                      title="Set a new password on behalf of this user"
                    >
                      Reset password
                    </button>
                    {!u.is_admin && !u.is_self && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="text-[10px] text-text-muted hover:text-red transition-colors"
                        title="Delete this user and everything they own"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserModal
        open={showAdd}
        onClose={() => { setShowAdd(false); load(); }}
      />
      <ResetPasswordModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
      <DeleteUserModal
        target={deleteTarget}
        onClose={() => { setDeleteTarget(null); load(); }}
      />
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState<{ email: string; password: string } | null>(null);

  const reset = () => {
    setEmail(""); setPassword(""); setConfirm(""); setErr(""); setOk(null); setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      await usersAPI.create(email.trim(), password);
      setOk({ email: email.trim(), password });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }}>
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Add user</h3>
        {ok ? (
          <div className="space-y-3">
            <div className="text-green text-[11px] bg-green/10 border border-green/30 rounded px-3 py-2">
              User <span className="font-mono">{ok.email}</span> created.
            </div>
            <div className="text-text-muted leading-relaxed">
              Share this password with the user over a trusted channel.
              It isn't stored anywhere we can show you again — if they
              lose it, use <em>Reset password</em>.
            </div>
            <div className="bg-bg-input border border-border rounded px-3 py-2 font-mono text-text break-all">
              {ok.password}
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => { reset(); onClose(); }}
                className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-text-muted leading-relaxed">
              Creates a new user with the initial password you pick.
              They'll be able to change it themselves after first login.
            </p>
            <label className="block">
              <span className="text-text-muted">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text focus:outline-none focus:border-accent"
                required autoFocus disabled={busy}
              />
            </label>
            <label className="block">
              <span className="text-text-muted">Initial password</span>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
                required disabled={busy}
              />
            </label>
            <label className="block">
              <span className="text-text-muted">Confirm password</span>
              <input
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
                required disabled={busy}
              />
            </label>
            {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { reset(); onClose(); }} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
              <button type="submit" className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={busy}>
                {busy ? "Creating…" : "Create user"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ target, onClose }: { target: UserRow | null; onClose: () => void }) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (target) { setNext(""); setConfirm(""); setErr(""); setOk(false); setBusy(false); }
  }, [target]);

  if (!target) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (next.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (next !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      await usersAPI.resetPassword(target.id, next);
      setOk(true);
      setTimeout(onClose, 1500);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Reset password for {target.email}</h3>
        <p className="text-text-muted leading-relaxed">
          Sets a new password without needing the current one. Every
          active session for this user is signed out immediately.
        </p>
        <label className="block">
          <span className="text-text-muted">New password</span>
          <input type="text" value={next} onChange={(e) => setNext(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
            required autoFocus disabled={busy || ok}
          />
        </label>
        <label className="block">
          <span className="text-text-muted">Confirm</span>
          <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8}
            className="mt-1 w-full bg-bg-input border border-border rounded-lg px-3 py-1.5 text-text font-mono focus:outline-none focus:border-accent"
            required disabled={busy || ok}
          />
        </label>
        {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
        {ok && <div className="text-green text-[11px] bg-green/10 border border-green/30 rounded px-2 py-1">Password reset. User signed out of all sessions.</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
          <button type="submit" className="px-3 py-1.5 bg-accent text-bg rounded-lg font-bold hover:bg-accent-hover transition-colors disabled:opacity-50" disabled={busy || ok}>
            {busy ? "Updating…" : "Reset password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUserModal({ target, onClose }: { target: UserRow | null; onClose: () => void }) {
  const [counts, setCounts] = useState<{ agents: number; keys: number; projects: number; providers: number; connections: number; mcp_servers: number; subscriptions: number; channels: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setCounts(null); setErr(""); setBusy(false);
    if (!target) return;
    usersAPI.preview(target.id)
      .then((r) => setCounts(r.would_delete))
      .catch((e) => setErr(e?.message || String(e)));
  }, [target]);

  if (!target) return null;

  const confirm = async () => {
    setBusy(true);
    setErr("");
    try {
      await usersAPI.remove(target.id);
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose}>
      <div className="space-y-3 text-xs p-5 max-w-md">
        <h3 className="text-text text-sm font-bold">Delete user {target.email}?</h3>
        <p className="text-text-muted leading-relaxed">
          Everything this user owns will be removed. Running cores are
          stopped first. This can't be undone.
        </p>
        {counts ? (
          <ul className="text-text-muted bg-bg-input border border-border rounded px-3 py-2 space-y-0.5">
            <li>Agents: <span className="text-text">{counts.agents}</span></li>
            <li>API keys: <span className="text-text">{counts.keys}</span></li>
            <li>Projects: <span className="text-text">{counts.projects}</span></li>
            <li>Providers: <span className="text-text">{counts.providers}</span></li>
            <li>Connections: <span className="text-text">{counts.connections}</span></li>
            <li>MCP servers: <span className="text-text">{counts.mcp_servers}</span></li>
            <li>Subscriptions: <span className="text-text">{counts.subscriptions}</span></li>
          </ul>
        ) : (
          <p className="text-text-dim">Loading preview…</p>
        )}
        {err && <div className="text-red text-[11px] bg-red/10 border border-red/30 rounded px-2 py-1">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 border border-border rounded-lg text-text-muted hover:text-text transition-colors" disabled={busy}>Cancel</button>
          <button type="button" onClick={confirm} className="px-3 py-1.5 bg-red text-bg rounded-lg font-bold hover:bg-red/80 transition-colors disabled:opacity-50" disabled={busy || !counts}>
            {busy ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
