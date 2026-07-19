import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { chat, type Agent, type ChatRow } from "../../api";
import { chatConnections } from "../../state/chatConnections";
import { Modal } from "../Modal";

interface Props {
  conversation: ChatRow;
  agents: Agent[];
  onChanged: (conversation: ChatRow) => void;
  onRemoved: (conversationId: string) => void;
}

export function ConversationDetails({ conversation, agents, onChanged, onRemoved }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(conversation.title);
  const [addAgentId, setAddAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);
  const participants = useMemo(
    () => conversation.agent_ids.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean) as Agent[],
    [agents, conversation.agent_ids],
  );
  const available = useMemo(
    () => agents.filter((agent) => !conversation.agent_ids.includes(agent.id)),
    [agents, conversation.agent_ids],
  );

  useEffect(() => {
    setTitle(conversation.title);
    setAddAgentId("");
    setError(null);
    setConfirmAction(null);
  }, [conversation.id, conversation.title]);

  const run = async (operation: () => Promise<ChatRow>) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      onChanged(await operation());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const saveTitle = () => {
    const next = title.trim();
    if (next && next !== conversation.title) void run(() => chat.updateConversation(conversation.id, { title: next }));
  };

  const addParticipant = () => {
    const id = Number(addAgentId);
    if (!id) return;
    void run(async () => {
      const updated = await chat.addParticipant(conversation.id, id);
      setAddAgentId("");
      return updated;
    });
  };

  const archive = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await chat.updateConversation(conversation.id, { archived: true });
      setConfirmAction(null);
      onRemoved(conversation.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await chat.deleteConversation(conversation.id);
      chatConnections.forgetChat(conversation.id);
      setConfirmAction(null);
      onRemoved(conversation.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const askToConfirm = (action: "archive" | "delete") => {
    if (saving) return;
    setError(null);
    setConfirmAction(action);
  };

  const closeConfirmation = () => {
    if (!saving) setConfirmAction(null);
  };

  return (
    <>
      <div className="space-y-4 border-b border-border p-4">
      <div>
        <div className="mb-1 text-[10px] uppercase text-text-muted">{t("chat.details.title")}</div>
        <div className="flex gap-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveTitle(); }} maxLength={120} className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1 text-xs text-text focus:border-accent focus:outline-none" />
          <button type="button" onClick={saveTitle} disabled={saving || !title.trim() || title.trim() === conversation.title} className="rounded border border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-40">{t("chat.details.save")}</button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] uppercase text-text-muted">{t("chat.participants")}</div>
        <div className="space-y-2">
          {participants.map((agent) => (
            <div key={agent.id} className="flex min-h-7 items-center gap-2 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full ${agent.status === "running" ? "bg-green" : "bg-text-dim"}`} />
              <span className="min-w-0 flex-1 truncate text-text-muted">{agent.name}</span>
              {agent.id === conversation.instance_id ? <span className="text-[9px] uppercase text-accent">{t("chat.lead")}</span> : (
                <button type="button" onClick={() => void run(() => chat.removeParticipant(conversation.id, agent.id))} disabled={saving} className="text-[10px] text-text-dim hover:text-red">{t("chat.details.remove")}</button>
              )}
            </div>
          ))}
        </div>
        {available.length > 0 && (
          <div className="mt-2 flex gap-2">
            <select value={addAgentId} onChange={(event) => setAddAgentId(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-bg-input px-2 py-1 text-xs text-text focus:border-accent focus:outline-none">
              <option value="">{t("chat.details.addAgent")}</option>
              {available.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <button type="button" onClick={addParticipant} disabled={!addAgentId || saving} className="rounded border border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text disabled:opacity-40">{t("chat.details.add")}</button>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border pt-3">
        <button type="button" onClick={() => askToConfirm("archive")} disabled={saving} className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:border-accent hover:text-text">{t("chat.details.archive")}</button>
        <button type="button" onClick={() => askToConfirm("delete")} disabled={saving} className="rounded border border-red/40 px-2 py-1 text-xs text-red hover:bg-red/10">{t("chat.details.delete")}</button>
      </div>
      {error && <div className="text-xs text-red">{error}</div>}
      </div>

      <Modal
        open={confirmAction !== null}
        onClose={closeConfirmation}
        width="max-w-md"
        ariaLabel={confirmAction === "delete" ? t("chat.details.deleteTitle") : t("chat.details.archiveTitle")}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text">
            {confirmAction === "delete" ? t("chat.details.deleteTitle") : t("chat.details.archiveTitle")}
          </h2>
          <button
            type="button"
            onClick={closeConfirmation}
            disabled={saving}
            className="touch-target inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-40"
            aria-label={t("chat.new.close")}
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${confirmAction === "delete" ? "bg-red/10 text-red" : "bg-accent/10 text-accent"}`} aria-hidden="true">
            {confirmAction === "delete" ? "!" : "↓"}
          </div>
          <p className="text-sm leading-6 text-text-muted">
            {confirmAction === "delete" ? t("chat.details.deleteConfirm") : t("chat.details.archiveConfirm")}
          </p>
          <div className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm font-medium text-text">
            {conversation.title}
          </div>
          {error && <div className="text-xs text-red">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={closeConfirmation}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text disabled:opacity-40"
          >
            {t("chat.details.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void (confirmAction === "delete" ? remove() : archive())}
            disabled={saving}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:opacity-40 ${confirmAction === "delete" ? "bg-red text-white hover:bg-red/90" : "bg-accent text-bg hover:bg-accent-hover"}`}
          >
            {saving
              ? (confirmAction === "delete" ? t("chat.details.deleting") : t("chat.details.archiving"))
              : (confirmAction === "delete" ? t("chat.details.delete") : t("chat.details.archive"))}
          </button>
        </div>
      </Modal>
    </>
  );
}
