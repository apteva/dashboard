import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { chat, type Agent, type ChatRow } from "../../api";
import { Modal } from "../Modal";

interface Props {
  open: boolean;
  projectId: string;
  agents: Agent[];
  onClose: () => void;
  onCreated: (conversation: ChatRow) => void;
}

export function NewConversationModal({ open, projectId, agents, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number[]>([]);
  const [leadAgentId, setLeadAgentId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? agents.filter((agent) => agent.name.toLowerCase().includes(q)) : agents;
  }, [agents, filter]);

  const toggle = (agentId: number) => {
    setSelected((current) => {
      const next = current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId];
      setLeadAgentId((lead) => next.length === 0 ? null : lead && next.includes(lead) ? lead : next[0]!);
      return next;
    });
  };

  const close = () => {
    if (saving) return;
    setSelected([]);
    setLeadAgentId(null);
    setTitle("");
    setFilter("");
    setError(null);
    onClose();
  };

  const create = async () => {
    if (selected.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const conversation = await chat.createConversation(projectId, selected, title.trim() || undefined, leadAgentId || undefined);
      closeAfterCreate();
      onCreated(conversation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const closeAfterCreate = () => {
    setSelected([]);
    setLeadAgentId(null);
    setTitle("");
    setFilter("");
    setError(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} width="max-w-lg" ariaLabel={t("chat.new.title")}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-text">{t("chat.new.title")}</h2>
        <button type="button" onClick={close} className="touch-target inline-flex h-11 w-11 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-hover hover:text-text" aria-label={t("chat.new.close")}>×</button>
      </div>
      <div className="space-y-4 p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-text-muted">{t("chat.new.conversationTitle")}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("chat.new.optionalTitle")} className="w-full rounded border border-border bg-bg-input px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none" />
        </label>
        <div>
          <div className="mb-1 text-[10px] uppercase text-text-muted">{t("chat.new.agents")}</div>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t("chat.new.searchAgents")} className="mb-2 w-full rounded border border-border bg-bg-input px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none" />
          <div className="max-h-64 divide-y divide-border overflow-y-auto border border-border">
            {visible.map((agent) => {
              const checked = selected.includes(agent.id);
              return (
                <div key={agent.id} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-bg-hover">
                  <input type="checkbox" checked={checked} onChange={() => toggle(agent.id)} className="h-4 w-4 accent-[var(--color-accent)]" aria-label={agent.name} />
                  <button type="button" onClick={() => toggle(agent.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm text-text">{agent.name}</span>
                    <span className="block text-[10px] text-text-muted">#{agent.id} · {agent.status}</span>
                  </button>
                  {selected.length > 1 && checked && (
                    <label className="flex items-center gap-1 text-[10px] text-text-muted">
                      <input type="radio" name="lead-agent" checked={leadAgentId === agent.id} onChange={() => setLeadAgentId(agent.id)} />
                      {t("chat.new.lead")}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {error && <div className="text-xs text-red">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={close} className="rounded border border-border px-4 py-2 text-sm text-text-muted hover:bg-bg-hover hover:text-text">{t("chat.new.cancel")}</button>
        <button type="button" onClick={create} disabled={selected.length === 0 || saving} className="rounded border border-accent bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40">{saving ? t("chat.new.creating") : t("chat.new.create")}</button>
      </div>
    </Modal>
  );
}
