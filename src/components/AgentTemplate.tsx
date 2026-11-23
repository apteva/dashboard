import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { instances, type Agent, type AgentTemplateStatus } from "../api";
import { Modal } from "./Modal";

// An agent created from a template stays linked to one of its versions.
// It either follows the template (new versions are applied unless the
// agent's own instructions or mode were changed) or stays pinned to a
// version until an operator moves it. These components show that link
// on the agent page and let operators change it.

type TemplateChange = { follow_latest?: boolean; version?: number; overwrite_local_changes?: boolean };

export const templateSourceLabel: Record<string, string> = {
  builtin: "Built-in template",
  app: "App template",
  user: "Your template",
};

/** Loads an agent's template link and reloads it when the agent changes. */
export function useAgentTemplateStatus(agent: Agent) {
  const [status, setStatus] = useState<AgentTemplateStatus | null>(null);
  const reload = useCallback(() => {
    instances.template.get(agent.id).then(setStatus).catch(() => setStatus(null));
  }, [agent.id]);
  useEffect(() => {
    reload();
    const interval = window.setInterval(reload, 60_000);
    return () => window.clearInterval(interval);
    // Instructions, mode and runtime changes can all change the link's state.
  }, [reload, agent.directive, agent.mode, agent.status]);
  return { status, setStatus, reload };
}

export interface AgentTemplateNotice {
  tone: "error" | "warning" | "info";
  title: string;
  message: string;
  /** A change that is safe to apply straight from the notice. */
  apply?: { label: string; change: TemplateChange };
}

/** What the agent page should say about the agent's template, if anything. */
export function agentTemplateNotice(status: AgentTemplateStatus | null | undefined): AgentTemplateNotice | null {
  if (!status?.linked) return null;
  const name = status.template_name || "its template";
  const latest = status.latest_version || status.version || 1;
  if (status.last_error) {
    return {
      tone: "error",
      title: "Template update failed",
      message: `Version ${latest} of ${name} could not be applied: ${status.last_error}`,
      apply: status.follow_latest ? { label: "Retry", change: { follow_latest: true } } : undefined,
    };
  }
  if (!status.update_available) return null;
  if (status.changed_locally) {
    return {
      tone: "warning",
      title: status.follow_latest ? "Template update held" : "New template version",
      message: `Version ${latest} of ${name} was not applied because this agent's instructions or mode were changed here.`,
    };
  }
  if (status.follow_latest) return null; // applied within a minute
  return {
    tone: "info",
    title: "New template version",
    message: `Version ${latest} of ${name} is available. This agent is on version ${status.version}.`,
    apply: { label: `Update to version ${latest}`, change: { version: latest } },
  };
}

function conflictStatus(err: any): AgentTemplateStatus | null {
  return err?.status === 409 && err?.body?.status?.linked ? (err.body.status as AgentTemplateStatus) : null;
}

const toneClass: Record<AgentTemplateNotice["tone"], { bar: string; title: string; button: string }> = {
  error: { bar: "border-red/30 bg-red/10", title: "text-red", button: "border-red/40 text-red hover:bg-red/10" },
  warning: { bar: "border-yellow/30 bg-yellow/10", title: "text-yellow", button: "border-yellow/40 text-yellow hover:bg-yellow/10" },
  info: { bar: "border-accent/30 bg-accent/5", title: "text-accent", button: "border-accent/40 text-accent hover:bg-accent/10" },
};

/** A bar under the agent header when its template needs attention. */
export function AgentTemplateNoticeBar({ agent, status, onChanged, onReview }: {
  agent: Agent;
  status: AgentTemplateStatus | null;
  onChanged: (status: AgentTemplateStatus) => void;
  onReview: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notice = agentTemplateNotice(status);
  if (!notice) return null;
  const tone = toneClass[notice.tone];

  const apply = async () => {
    if (!notice.apply) return;
    setBusy(true);
    setError("");
    try {
      onChanged(await instances.template.set(agent.id, notice.apply.change));
    } catch (err: any) {
      const current = conflictStatus(err);
      if (current) {
        onChanged(current);
        onReview();
      } else {
        setError(err?.message || "Could not update the agent");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role={notice.tone === "error" ? "alert" : "status"} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs ${tone.bar}`}>
      <span className={`font-bold ${tone.title}`}>{notice.title}</span>
      <span className="min-w-0 flex-1 text-text-muted">{notice.message}</span>
      {error && <span className="text-red">{error}</span>}
      <div className="ml-auto flex gap-2">
        {notice.apply && (
          <button type="button" onClick={apply} disabled={busy} className={`rounded border px-2 py-1 font-bold disabled:opacity-50 ${tone.button}`}>
            {busy ? "Updating…" : notice.apply.label}
          </button>
        )}
        <button type="button" onClick={onReview} className="rounded border border-border px-2 py-1 text-text-muted hover:text-text">
          Review
        </button>
      </div>
    </div>
  );
}

const sectionLabel = "text-text-muted text-xs font-bold uppercase tracking-wide";
const secondaryButton = "min-h-9 rounded-lg border border-border px-3 text-xs text-text-muted hover:text-text disabled:opacity-50";
const primaryButton = "min-h-9 rounded-lg bg-accent px-3 text-xs font-bold text-bg hover:bg-accent-hover disabled:opacity-50";

/** The agent's template: which version it runs, whether it follows new ones, and saving it as a template. */
export function AgentTemplateModal({ open, onClose, agent, status, onChanged }: {
  open: boolean;
  onClose: () => void;
  agent: Agent;
  status: AgentTemplateStatus | null;
  onChanged: (status: AgentTemplateStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // A change the server refused because it would replace the agent's own edits.
  const [pending, setPending] = useState<TemplateChange | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setNotice("");
    setPending(null);
    setSaving(false);
    setConfirmUnlink(false);
    setName(agent.name);
    setDescription("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent.id]);

  useEffect(() => {
    if (open) setSelectedVersion(status?.version || 0);
  }, [open, status?.version]);

  const linked = !!status?.linked;
  const version = status?.version || 1;
  const latest = status?.latest_version || version;
  const templateName = status?.template_name || "this template";

  const change = async (next: TemplateChange, done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await instances.template.set(agent.id, next);
      onChanged(updated);
      setPending(null);
      setNotice(done);
    } catch (err: any) {
      const current = conflictStatus(err);
      if (current) {
        onChanged(current);
        setPending(next);
      } else {
        setError(err?.message || "Could not update the agent");
      }
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    setError("");
    try {
      onChanged(await instances.template.unlink(agent.id));
      setConfirmUnlink(false);
      setNotice("Unlinked. The agent keeps its current instructions and mode.");
    } catch (err: any) {
      setError(err?.message || "Could not unlink the agent");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await instances.template.save(agent.id, { name: name.trim(), description: description.trim(), icon: agent.icon });
      onChanged(result.status);
      setSaving(false);
      setNotice(`Saved as ${result.template.name}. This agent follows it.`);
    } catch (err: any) {
      setError(err?.message || "Could not save the template");
    } finally {
      setBusy(false);
    }
  };

  const target = pending?.version || latest;

  return (
    <Modal open={open} onClose={onClose} width="max-w-xl" ariaLabel="Agent template">
      <div className="max-h-[85dvh] space-y-5 overflow-y-auto p-6">
        <div>
          <h3 className="text-text text-base font-bold">Template</h3>
          <p className="mt-1 text-xs text-text-muted">
            {linked
              ? "Changes here apply to the agent right away."
              : `${agent.name} isn't linked to a template.`}
          </p>
        </div>

        {linked && status && (
          <>
            <div className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text">{status.template_name || status.template_id}</div>
                  <div className="text-xs text-text-muted">{templateSourceLabel[status.template_source || ""] || "Template"}</div>
                </div>
                <Link to={`/agent-templates/${encodeURIComponent(status.template_id || "")}`} onClick={onClose} className="text-xs text-accent hover:underline">
                  Versions and agents
                </Link>
              </div>
              <p className="mt-3 text-sm text-text">
                On version {version}
                <span className="text-text-muted">{latest > version ? ` — version ${latest} is the latest` : " — the latest"}</span>
              </p>
              {status.changed_locally && (
                <p className="mt-2 text-xs leading-relaxed text-yellow">
                  This agent's instructions or mode were changed here, so new versions are not applied over them.
                </p>
              )}
              {!!status.missing_apps?.length && (
                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                  Version {latest} lists apps this agent doesn't have: {status.missing_apps.join(", ")}. Add them from Add apps &amp; MCPs.
                </p>
              )}
              {status.last_error && <p className="mt-2 text-xs text-red">Last update failed: {status.last_error}</p>}
            </div>

            {pending ? (
              <div role="alert" className="space-y-3 rounded-lg border border-yellow/40 bg-yellow/5 p-4">
                <p className="text-sm text-text">
                  Version {target} would replace the instructions and mode changed on this agent.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => change({ ...pending, overwrite_local_changes: true }, `Moved to version ${target}.`)} className="min-h-9 rounded-lg border border-yellow/60 px-3 text-xs font-bold text-yellow hover:bg-yellow/10 disabled:opacity-50">
                    Replace with version {target}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setPending(null)} className={secondaryButton}>Keep this agent's changes</button>
                </div>
              </div>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className={sectionLabel}>Updates</legend>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                    <input type="radio" name="template-updates" className="mt-0.5 accent-accent" checked={status.follow_latest} disabled={busy}
                      onChange={() => change({ follow_latest: true }, latest > version ? `Following ${templateName}. Moved to version ${latest}.` : `Following ${templateName}.`)} />
                    <span>
                      <span className="block text-sm text-text">Follow new versions</span>
                      <span className="block text-xs text-text-muted">New versions are applied unless this agent's instructions or mode were changed here.</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
                    <input type="radio" name="template-updates" className="mt-0.5 accent-accent" checked={!status.follow_latest} disabled={busy}
                      onChange={() => change({ follow_latest: false }, `Staying on version ${version}.`)} />
                    <span>
                      <span className="block text-sm text-text">Stay on version {version}</span>
                      <span className="block text-xs text-text-muted">The agent changes version only when you move it.</span>
                    </span>
                  </label>
                </fieldset>

                {latest > 1 && (
                  <div>
                    <label htmlFor="template-version" className={`${sectionLabel} mb-1 block`}>Move to a version</label>
                    <div className="flex flex-wrap gap-2">
                      <select id="template-version" value={selectedVersion} onChange={(e) => setSelectedVersion(Number(e.target.value))}
                        className="min-h-9 rounded-lg border border-border bg-bg-input px-3 text-sm text-text focus:border-accent focus:outline-none">
                        {Array.from({ length: latest }, (_, i) => latest - i).map((n) => (
                          <option key={n} value={n}>Version {n}{n === latest ? " (latest)" : ""}{n === version ? " (current)" : ""}</option>
                        ))}
                      </select>
                      <button type="button" disabled={busy || !selectedVersion || selectedVersion === version} onClick={() => change({ version: selectedVersion }, `Moved to version ${selectedVersion}. The agent stays on it.`)} className={secondaryButton}>
                        Use version {selectedVersion || version}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">Choosing a version keeps the agent on it.</p>
                  </div>
                )}

                {status.changed_locally && (
                  <button type="button" disabled={busy}
                    onClick={() => setPending(status.follow_latest ? { version: latest, follow_latest: true } : { version })}
                    className="min-h-9 rounded-lg border border-yellow/40 px-3 text-xs text-yellow hover:bg-yellow/10 disabled:opacity-50">
                    Reset to version {status.follow_latest ? latest : version}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {saving ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <label htmlFor="template-name" className={`${sectionLabel} mb-1 block`}>Template name</label>
              <input id="template-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none" />
            </div>
            <div>
              <label htmlFor="template-description" className={`${sectionLabel} mb-1 block`}>Description</label>
              <textarea id="template-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text focus:border-accent focus:outline-none" />
            </div>
            <p className="text-xs leading-relaxed text-text-muted">
              Saves this agent's instructions, mode, background memory and apps as version 1 of a new template.
              {linked ? ` The agent moves from ${templateName} to the new template and follows it.` : " The agent follows it."}
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={save} className={primaryButton}>{busy ? "Saving…" : "Save template"}</button>
              <button type="button" disabled={busy} onClick={() => setSaving(false)} className={secondaryButton}>Cancel</button>
            </div>
          </div>
        ) : confirmUnlink ? (
          <div role="alert" className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm text-text">Unlink {agent.name} from {templateName}? It keeps its current instructions and mode and gets no more versions.</p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={unlink} className="min-h-9 rounded-lg border border-red/50 px-3 text-xs font-bold text-red hover:bg-red/10 disabled:opacity-50">Unlink</button>
              <button type="button" disabled={busy} onClick={() => setConfirmUnlink(false)} className={secondaryButton}>Cancel</button>
            </div>
          </div>
        ) : null}

        {notice && <p role="status" className="text-xs text-green">{notice}</p>}
        {error && <p role="alert" className="text-xs text-red">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {!saving && !confirmUnlink && (
            <>
              {linked && <button type="button" disabled={busy} onClick={() => setConfirmUnlink(true)} className={`${secondaryButton} mr-auto`}>Unlink</button>}
              <button type="button" disabled={busy} onClick={() => { setSaving(true); setNotice(""); }} className={secondaryButton}>
                {linked ? "Save as new template" : "Save as template"}
              </button>
            </>
          )}
          <button type="button" onClick={onClose} className={secondaryButton}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
