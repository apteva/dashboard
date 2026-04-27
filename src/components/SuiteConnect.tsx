import { useState, useEffect, useCallback } from "react";
import { integrations } from "../api";
import { Modal } from "./Modal";

// Two-screen connect flow for credential-group suites (OmniKit, SocialCast, ...).
// Always project-scoped on the output side — every "Save" click creates
// one child connection per checked (service × external-project) cell, so
// the connections list keeps its one-row-per-MCP shape. The master
// credential lives invisibly behind those rows.
//
// Screen 1: paste key. Server validates by running discovery.
// Screen 2: service × project matrix. Save fans out.

type Group = {
  id: string;
  name: string;
  logo?: string | null;
  description?: string;
  members: Array<{ slug: string; name: string; tool_count: number; logo?: string | null }>;
  has_account_scope: boolean;
  has_project_scope: boolean;
};

type CredentialField = { name: string; label: string; description?: string; type?: string };

interface Props {
  group: Group;
  projectId?: string;
  onClose: () => void;
  /** Called after a successful save so the caller can refresh its connection list. */
  onConnectionsChanged?: () => void;
}

export function SuiteConnect({ group, projectId, onClose, onConnectionsChanged }: Props) {
  // ---- Catalog metadata (credential fields + scopes) ----
  const [accountFields, setAccountFields] = useState<CredentialField[]>([]);
  const [projectFields, setProjectFields] = useState<CredentialField[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  // ---- Scope picker (Screen 1 only) ----
  // Which key flavor the user is about to paste. Defaults to "account"
  // when both are available (that's the whole point of the suite
  // modal) but the toggle lets the user switch to the legacy
  // single-workspace path without leaving the modal. When only one
  // scope is declared, the radio UI is suppressed.
  const [scope, setScope] = useState<"account" | "project">("account");

  // ---- Existing master (if any) ----
  const [masterId, setMasterId] = useState<number | null>(null);
  const [maskedCreds, setMaskedCreds] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Array<{ id: string; label: string }>>([]);
  const [existingCells, setExistingCells] = useState<Set<string>>(new Set());

  // ---- Add-key form state ----
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [credsError, setCredsError] = useState("");
  const [credsBusy, setCredsBusy] = useState(false);

  // ---- Project-scope form state ----
  // Used only when scope === "project". The user picks one or more
  // suite members to connect the key to. A single project-scoped
  // credential can reach every service in its suite (OmniKit project
  // keys authorize Storage + Jobs + Social alike) — checking multiple
  // fans out one connection row per service, all backed by the same
  // key. Default to NOTHING selected: most operators only need one or
  // two services, and "all of OmniKit" is too broad a tool surface to
  // pre-commit to.
  const [projectMembers, setProjectMembers] = useState<Set<string>>(
    () => new Set(),
  );
  const [projectConnName, setProjectConnName] = useState("");

  // ---- Matrix state ----
  const [selected, setSelected] = useState<Set<string>>(new Set()); // key = "slug|projectId"
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [replace, setReplace] = useState(false);

  // ---- Project-picker state (Screen 2) ----
  // Which project is showing its service checklist on the right pane.
  // Defaults to the first project that already has any active connections
  // (so re-opening the modal lands where the user was last working); falls
  // back to the first project otherwise. Set once projects load.
  const [focusedProject, setFocusedProject] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState("");

  const fingerprint = useCallback((slug: string, extId: string) => `${slug}|${extId}`, []);

  // Load group detail + existing master on mount.
  useEffect(() => {
    let cancelled = false;
    setMetaLoading(true);
    Promise.all([integrations.getGroup(group.id), integrations.getGroupMaster(group.id, projectId).catch(() => null)])
      .then(([detail, masterResp]) => {
        if (cancelled) return;
        setAccountFields(detail.account_scope?.credential_fields || []);
        setProjectFields(detail.project_scope?.credential_fields || []);
        // Auto-pick the only available scope when the suite declares
        // just one of them. When both exist, keep the default
        // ("account") so the user lands on the matrix flow unless
        // they switch manually.
        if (!detail.account_scope && detail.project_scope) setScope("project");
        if (detail.account_scope && !detail.project_scope) setScope("account");
        if (masterResp && masterResp.master) {
          setMasterId(masterResp.master.id);
          setMaskedCreds(masterResp.master.credentials_masked || {});
          setProjects(masterResp.projects || []);
          const cells = new Set<string>();
          for (const c of masterResp.children || []) {
            cells.add(fingerprint(c.app_slug, c.project_id));
          }
          setExistingCells(cells);
          setSelected(new Set(cells));
          // Focus the first project that has any existing cells, else
          // fall back to the first project in the list.
          const projs = masterResp.projects || [];
          const firstWithCells = projs.find((p: { id: string }) =>
            (masterResp.children || []).some((c: { project_id: string }) => c.project_id === p.id),
          );
          setFocusedProject((firstWithCells || projs[0])?.id || "");
        }
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [group.id, projectId, fingerprint]);

  // Project-scope submit: creates a regular legacy-style connection
  // by going through POST /connections. No master/child indirection,
  // no discovery call — the key is already bound to one workspace
  // upstream, so we just store it and exit. Mirrors exactly what the
  // old per-app Connect flow would have done before the suite
  // collapse hid those cards.
  const submitProjectKey = async () => {
    const slugs = Array.from(projectMembers);
    if (slugs.length === 0) {
      setCredsError("Pick at least one service to connect");
      return;
    }
    setCredsBusy(true);
    setCredsError("");
    try {
      // Same credentials payload fans out to N connection rows, one per
      // service. If any fail after the first, we surface that error but
      // keep whatever succeeded — the backend is the source of truth.
      const customName = projectConnName.trim();
      for (const slug of slugs) {
        const member = group.members.find((m) => m.slug === slug);
        const name = customName || member?.name || group.name;
        await integrations.connect(slug, name, creds, "api_key", projectId);
      }
      onConnectionsChanged?.();
      onClose();
    } catch (err) {
      setCredsError((err as Error)?.message || "failed");
    } finally {
      setCredsBusy(false);
    }
  };

  const submitKey = async () => {
    if (scope === "project") {
      await submitProjectKey();
      return;
    }
    setCredsBusy(true);
    setCredsError("");
    try {
      const resp = await integrations.addGroupMaster(group.id, creds, projectId);
      setMasterId(resp.master_id);
      setProjects(resp.projects || []);
      // Default: nothing selected. The matrix is for explicit opt-in —
      // pre-checking everything pre-commits the agent to the suite's
      // entire tool surface (e.g. all 15 OmniKit services × every
      // project), which is almost never what you want. The operator
      // ticks the cells they actually need.
      setSelected(new Set());
      setFocusedProject((resp.projects || [])[0]?.id || "");
    } catch (err) {
      setCredsError((err as Error)?.message || "failed");
    } finally {
      setCredsBusy(false);
    }
  };

  const refreshProjects = async () => {
    try {
      const resp = await integrations.refreshGroupProjects(group.id, projectId);
      setProjects(resp.projects || []);
    } catch (err) {
      setSaveErr((err as Error)?.message || "refresh failed");
    }
  };

  const toggle = (slug: string, extId: string) => {
    const key = fingerprint(slug, extId);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaveBusy(true);
    setSaveErr("");
    const selections: Array<{ app_slug: string; external_project_id: string; label: string }> = [];
    for (const key of selected) {
      const parts = key.split("|");
      const slug = parts[0] || "";
      const extId = parts[1] || "";
      if (!slug || !extId) continue;
      const proj = projects.find((p) => p.id === extId);
      selections.push({ app_slug: slug, external_project_id: extId, label: proj?.label || extId });
    }
    try {
      await integrations.enableGroupApps(group.id, selections, { projectId, replace });
      onConnectionsChanged?.();
      onClose();
    } catch (err) {
      setSaveErr((err as Error)?.message || "save failed");
    } finally {
      setSaveBusy(false);
    }
  };

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);

  const disconnectAll = async () => {
    setDisconnectBusy(true);
    setSaveErr("");
    try {
      await integrations.deleteGroupMaster(group.id, projectId);
      onConnectionsChanged?.();
      onClose();
    } catch (err) {
      setSaveErr((err as Error)?.message || "delete failed");
    } finally {
      setDisconnectBusy(false);
    }
  };

  // --- Render -------------------------------------------------------------
  //
  // Three-row flex layout inside the Modal (header / body / footer):
  //  * Header and footer are sticky (don't scroll).
  //  * Body is the only scroll region, so the matrix can grow
  //    vertically AND horizontally without clipping either axis.
  //  * Modal width switches based on screen — wide for the matrix
  //    (room for many columns), narrower for the key-paste form.

  const wide = masterId !== null; // Screen 2 needs width for the matrix
  const modalWidth = wide ? "max-w-[min(96vw,1400px)]" : "max-w-xl";

  // --- Bulk toggle helpers for the matrix ---
  //
  // Column toggle: picks/unpicks every cell in one service column
  // (e.g. "enable Storage for every visible project"). Row toggle:
  // same idea per-project. The checkbox in the header reflects the
  // current selection state — full = checked, partial = indeterminate,
  // empty = unchecked. Cheap to compute; projects × members is tiny.
  const toggleColumn = useCallback(
    (slug: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const keysInCol = projects.map((p) => fingerprint(slug, p.id));
        const allOn = keysInCol.every((k) => next.has(k));
        if (allOn) keysInCol.forEach((k) => next.delete(k));
        else keysInCol.forEach((k) => next.add(k));
        return next;
      });
    },
    [projects, fingerprint],
  );

  const toggleRow = useCallback(
    (extId: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const keysInRow = group.members.map((m) => fingerprint(m.slug, extId));
        const allOn = keysInRow.every((k) => next.has(k));
        if (allOn) keysInRow.forEach((k) => next.delete(k));
        else keysInRow.forEach((k) => next.add(k));
        return next;
      });
    },
    [group.members, fingerprint],
  );

  // Column-state classifier — drives the header checkbox's three-way
  // appearance (all / some / none). Stored as a helper instead of
  // inlined so the same logic can tag the row checkbox too.
  const colState = (slug: string): "all" | "some" | "none" => {
    const keys = projects.map((p) => fingerprint(slug, p.id));
    const on = keys.filter((k) => selected.has(k)).length;
    if (on === 0) return "none";
    if (on === keys.length) return "all";
    return "some";
  };
  const rowState = (extId: string): "all" | "some" | "none" => {
    const keys = group.members.map((m) => fingerprint(m.slug, extId));
    const on = keys.filter((k) => selected.has(k)).length;
    if (on === 0) return "none";
    if (on === keys.length) return "all";
    return "some";
  };

  return (
    <Modal open={true} onClose={onClose} width={modalWidth}>
      {/* Header — stays pinned at top while body scrolls. */}
      <div className="flex items-start gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        {group.logo && (
          <img
            src={group.logo}
            alt=""
            className="w-8 h-8 rounded flex-shrink-0 bg-bg-input p-0.5"
          />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-text text-base font-bold">{group.name}</h2>
          {group.description && (
            <p className="text-text-dim text-xs leading-snug mt-0.5 line-clamp-2">
              {group.description}
            </p>
          )}
          <p className="text-text-muted text-xs mt-1">
            {group.members.length} {group.members.length === 1 ? "service" : "services"}
            {" · "}
            {group.has_account_scope && group.has_project_scope
              ? "account & project keys"
              : group.has_account_scope
                ? "account keys only"
                : "project keys only"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-text-dim hover:text-text text-xl leading-none flex-shrink-0"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Body — the only scrollable region. */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {metaLoading ? (
          <div className="py-8 text-center text-text-dim text-sm">Loading…</div>
        ) : masterId === null ? (
          // ------- Screen 1: paste key -------
          <div>
            {/*
              Scope selector — only rendered when the template
              declares BOTH account + project scopes. Hidden
              otherwise (whichever scope exists is auto-selected on
              load so the user doesn't see an irrelevant toggle).
            */}
            {accountFields.length > 0 && projectFields.length > 0 && (
              <div className="mb-4 border border-border bg-bg-input/40 rounded-lg divide-y divide-border">
                <label className="flex items-start gap-3 cursor-pointer p-3">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "account"}
                    onChange={() => setScope("account")}
                    className="mt-0.5 accent-accent"
                  />
                  <span className="text-sm">
                    <span className="text-text font-medium">Account key</span>
                    <span className="text-text-muted ml-2">
                      — lists every project, enable services across many
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer p-3">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === "project"}
                    onChange={() => setScope("project")}
                    className="mt-0.5 accent-accent"
                  />
                  <span className="text-sm">
                    <span className="text-text font-medium">Project key</span>
                    <span className="text-text-muted ml-2">
                      — scoped to one project, enables one or more services
                    </span>
                  </span>
                </label>
              </div>
            )}

            <p className="text-text-muted text-xs leading-snug mb-4">
              {scope === "account"
                ? `Paste an account-wide credential to unlock every service in ${group.name} across all projects it can see.`
                : `Paste a project-scoped credential. Pick which ${group.name} services to enable — the same key is reused across all of them.`}
            </p>

            <div className="space-y-3">
              {/*
                Fields switch based on scope since templates can
                declare different descriptions for the two key
                flavors (e.g. "okt_acc_..." vs "okt_..."). Falls
                back to the other set if the active one is empty.
              */}
              {(scope === "account"
                ? accountFields.length > 0 ? accountFields : projectFields
                : projectFields.length > 0 ? projectFields : accountFields
              ).map((f) => (
                <div key={f.name}>
                  <label className="block text-text text-xs font-medium mb-1">{f.label}</label>
                  <input
                    type={f.type === "text" ? "text" : "password"}
                    className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 font-mono text-sm text-text focus:outline-none focus:border-accent"
                    value={creds[f.name] || ""}
                    onChange={(e) => setCreds({ ...creds, [f.name]: e.target.value })}
                    placeholder={f.description || ""}
                  />
                  {f.description && (
                    <p className="text-text-dim text-xs mt-1 leading-snug">{f.description}</p>
                  )}
                </div>
              ))}

              {/* Project-scope extras: which services + optional name. */}
              {scope === "project" && (
                <>
                  {group.members.length > 1 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-text text-xs font-medium">Services</label>
                        <div className="flex gap-2 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setProjectMembers(new Set(group.members.map((m) => m.slug)))}
                            className="text-accent hover:underline"
                          >
                            all
                          </button>
                          <button
                            type="button"
                            onClick={() => setProjectMembers(new Set())}
                            className="text-text-muted hover:text-text"
                          >
                            none
                          </button>
                        </div>
                      </div>
                      <div className="border border-border bg-bg-input/40 rounded-lg divide-y divide-border max-h-48 overflow-auto">
                        {group.members.map((m) => {
                          const on = projectMembers.has(m.slug);
                          return (
                            <label
                              key={m.slug}
                              className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-bg-hover"
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  setProjectMembers((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(m.slug)) next.delete(m.slug);
                                    else next.add(m.slug);
                                    return next;
                                  });
                                }}
                                className="accent-accent"
                              />
                              <span className="text-sm text-text flex-1">{m.name}</span>
                              <span className="text-[10px] text-text-dim">
                                {m.tool_count} {m.tool_count === 1 ? "tool" : "tools"}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-text-dim text-xs mt-1 leading-snug">
                        The same key is reused across every checked service — one connection row per service.
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="block text-text text-xs font-medium mb-1">Connection name</label>
                    <input
                      type="text"
                      className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                      value={projectConnName}
                      onChange={(e) => setProjectConnName(e.target.value)}
                      placeholder="leave blank to use each service's default"
                    />
                  </div>
                </>
              )}
            </div>
            {credsError && (
              <div className="mt-3 text-sm text-red">{credsError}</div>
            )}
          </div>
        ) : (
          // ------- Screen 2: service × project matrix -------
          <div>
            {Object.keys(maskedCreds).length > 0 && (
              <div className="text-text-dim text-xs mb-3 flex items-center flex-wrap gap-x-3 gap-y-1">
                <span>
                  Using key
                  {Object.entries(maskedCreds).map(([k, v]) => (
                    <span key={k} className="font-mono ml-1 text-text-muted">
                      {v}
                    </span>
                  ))}
                </span>
                <button onClick={refreshProjects} className="text-accent hover:underline">
                  refresh projects
                </button>
                {confirmDisconnect ? (
                  <span className="flex items-center gap-2 bg-red/10 border border-red/40 rounded px-2 py-1">
                    <span className="text-red">
                      Remove key and {existingCells.size} {existingCells.size === 1 ? "connection" : "connections"}?
                    </span>
                    <button
                      onClick={disconnectAll}
                      disabled={disconnectBusy}
                      className="text-red font-medium hover:underline disabled:opacity-50"
                    >
                      {disconnectBusy ? "removing…" : "confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmDisconnect(false)}
                      disabled={disconnectBusy}
                      className="text-text-muted hover:text-text"
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDisconnect(true)}
                    className="text-red hover:underline"
                  >
                    disconnect all
                  </button>
                )}
              </div>
            )}
            {projects.length === 0 ? (
              <div className="py-6 text-center text-text-dim text-sm">
                No projects visible to this key.
              </div>
            ) : (
              <>
                <p className="text-text-dim text-xs mb-2">
                  Pick a project, then toggle which services run against it.
                </p>
                <div className="border border-border rounded-lg flex h-[60vh] min-h-[320px] overflow-hidden">
                  {/* Left pane: filter + project list */}
                  <div className="w-72 flex-shrink-0 border-r border-border flex flex-col bg-bg-input/30">
                    <div className="p-2 border-b border-border">
                      <input
                        type="text"
                        value={projectFilter}
                        onChange={(e) => setProjectFilter(e.target.value)}
                        placeholder={`Filter ${projects.length} projects…`}
                        className="w-full bg-bg-input border border-border rounded px-2 py-1 text-xs text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      {projects
                        .filter((p) => {
                          const q = projectFilter.trim().toLowerCase();
                          if (!q) return true;
                          return (
                            p.label.toLowerCase().includes(q) ||
                            p.id.toLowerCase().includes(q)
                          );
                        })
                        .map((p) => {
                          const rst = rowState(p.id);
                          const checkedCount = group.members.filter((m) =>
                            selected.has(fingerprint(m.slug, p.id)),
                          ).length;
                          const isFocused = p.id === focusedProject;
                          return (
                            <button
                              key={p.id}
                              onClick={() => setFocusedProject(p.id)}
                              className={`w-full text-left px-3 py-2 border-b border-border/50 flex items-center gap-2 text-xs transition-colors ${
                                isFocused
                                  ? "bg-accent/15 text-accent"
                                  : "text-text hover:bg-bg-hover"
                              }`}
                              title={p.id}
                            >
                              <span
                                className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                  rst === "all"
                                    ? "bg-green"
                                    : rst === "some"
                                      ? "bg-yellow"
                                      : "bg-border"
                                }`}
                              />
                              <span className="flex-1 truncate">{p.label}</span>
                              <span className="text-text-dim">
                                {checkedCount}/{group.members.length}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* Right pane: services for the focused project */}
                  <div className="flex-1 flex flex-col min-w-0">
                    {(() => {
                      const focused = projects.find((p) => p.id === focusedProject);
                      if (!focused) {
                        return (
                          <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
                            Pick a project on the left.
                          </div>
                        );
                      }
                      const rst = rowState(focused.id);
                      return (
                        <>
                          <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-text text-sm font-medium truncate">{focused.label}</div>
                              <div className="text-text-dim text-[10px] font-mono truncate">{focused.id}</div>
                            </div>
                            <button
                              onClick={() => toggleRow(focused.id)}
                              className="text-[10px] text-accent hover:underline flex-shrink-0"
                            >
                              {rst === "all" ? "uncheck all" : "check all"}
                            </button>
                          </div>
                          <div className="flex-1 overflow-y-auto divide-y divide-border/50">
                            {group.members.map((m) => {
                              const key = fingerprint(m.slug, focused.id);
                              const isExisting = existingCells.has(key);
                              const isChecked = selected.has(key);
                              return (
                                <label
                                  key={m.slug}
                                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggle(m.slug, focused.id)}
                                    className={isExisting ? "accent-green" : "accent-accent"}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm text-text truncate">{m.name}</div>
                                    <div className="text-[10px] text-text-dim">
                                      {m.tool_count} {m.tool_count === 1 ? "tool" : "tools"}
                                      {isExisting && <span className="ml-2 text-green">connected</span>}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                          {/* Bulk-service shortcut: "enable this service for every project" */}
                          <div className="px-4 py-2 border-t border-border text-[10px] text-text-dim flex items-center gap-3 flex-wrap">
                            <span>Apply across every project:</span>
                            {group.members.map((m) => {
                              const st = colState(m.slug);
                              return (
                                <button
                                  key={m.slug}
                                  onClick={() => toggleColumn(m.slug)}
                                  className={`px-1.5 py-0.5 rounded border transition-colors ${
                                    st === "all"
                                      ? "border-green text-green"
                                      : st === "some"
                                        ? "border-yellow text-yellow"
                                        : "border-border text-text-muted hover:text-text hover:border-text-muted"
                                  }`}
                                >
                                  {m.name.replace(/^OmniKit\s+/, "").replace(/^SocialCast\s+/, "")}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}
            {saveErr && <div className="mt-2 text-sm text-red">{saveErr}</div>}
          </div>
        )}
      </div>

      {/* Footer — sticky bottom, always visible. */}
      {!metaLoading && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-border flex-shrink-0 bg-bg-card">
          {masterId === null ? (
            <>
              <span className="text-text-dim text-xs">
                {scope === "account"
                  ? "discovers projects on save"
                  : `stores the key for ${projectMembers.size} ${projectMembers.size === 1 ? "service" : "services"}`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitKey}
                  disabled={credsBusy || Object.values(creds).every((v) => !v)}
                  className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
                >
                  {credsBusy
                    ? scope === "account"
                      ? "Validating…"
                      : "Connecting…"
                    : scope === "account"
                      ? "Continue →"
                      : "Connect"}
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-text-dim text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                  className="accent-accent"
                />
                Remove connections not selected
              </label>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-sm text-text-muted hover:text-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saveBusy}
                  className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110"
                >
                  {saveBusy ? "Saving…" : `Save ${selected.size}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
