import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, ChatRow, UnreadSummaryRow } from "../../api";
import { chatPreviewText } from "../../utils/chatPreview";

interface Props {
  instances: Agent[];
  conversations: ChatRow[];
  summary: UnreadSummaryRow[];
  unreadByChat: Map<string, number>;
  focusedChatId: string | null;
  onSelect: (chatId: string) => void;
  onNew: () => void;
}

export function ChatSidebar({
  instances,
  conversations,
  summary,
  unreadByChat,
  focusedChatId,
  onSelect,
  onNew,
}: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const agentsById = useMemo(() => new Map(instances.map((agent) => [agent.id, agent])), [instances]);
  const summaryByChat = useMemo(() => new Map(summary.map((row) => [row.chat_id, row])), [summary]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = conversations.filter((conversation) => {
      if (!q) return true;
      const participants = conversation.agent_ids.map((id) => agentsById.get(id)?.name || "").join(" ");
      return `${conversation.title} ${participants}`.toLowerCase().includes(q);
    });
    return rows.sort((a, b) => {
      const aAt = summaryByChat.get(a.id)?.latest_at || a.updated_at;
      const bAt = summaryByChat.get(b.id)?.latest_at || b.updated_at;
      return Date.parse(bAt) - Date.parse(aAt);
    });
  }, [agentsById, conversations, filter, summaryByChat]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-3 md:py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("chat.sidebar.filterConversations")}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg-input px-3 py-2 text-base text-text placeholder:text-text-dim focus:border-accent focus:outline-none md:min-h-0 md:rounded md:px-2 md:py-1 md:text-sm"
          />
          <button
            type="button"
            onClick={onNew}
            className="touch-target inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-xl text-accent hover:border-accent hover:bg-accent/10 md:h-8 md:w-8 md:rounded"
            title={t("chat.sidebar.newConversation")}
            aria-label={t("chat.sidebar.newConversation")}
          >
            +
          </button>
        </div>
      </div>

      <div className="px-3 py-2 text-[10px] uppercase text-text-dim">
        {t("chat.sidebar.conversations")}
      </div>

      <ul className="page-safe-bottom flex-1 overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-sm text-text-dim">{t("chat.sidebar.noConversations")}</li>
        ) : filtered.map((conversation) => {
          const row = summaryByChat.get(conversation.id);
          const participants = conversation.agent_ids.map((id) => agentsById.get(id)).filter(Boolean) as Agent[];
          const lead = agentsById.get(conversation.instance_id);
          const unread = unreadByChat.get(conversation.id) || 0;
          const active = conversation.id === focusedChatId;
          return (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={`flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition-colors md:min-h-0 md:gap-2 md:px-3 md:py-2 ${active ? "bg-bg-hover" : "hover:bg-bg-hover"}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full md:h-1.5 md:w-1.5 ${lead?.status === "running" ? "bg-green" : "bg-text-dim"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`flex-1 truncate text-[15px] text-text md:text-sm ${active ? "font-medium" : ""}`}>{conversation.title}</span>
                    {row?.latest_at && <span className="shrink-0 text-[10px] text-text-dim">{fmtRelative(row.latest_at, t)}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                    {participants.map((agent) => agent.name).join(", ")}
                    {conversation.kind === "room" ? ` · ${t("chat.sidebar.room")}` : ""}
                  </span>
                  {row?.latest_preview && <span className="mt-0.5 block truncate text-xs text-text-muted md:text-[11px]">{chatSidebarPreviewLabel(row, t)}</span>}
                </span>
                {unread > 0 && <span className="mt-0.5 flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">{unread > 99 ? "99+" : unread}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function chatSidebarPreviewLabel(row: UnreadSummaryRow, t: (key: string) => string): string {
  return (row.latest_role === "user" ? t("chat.sidebar.youPrefix") : "") + chatPreviewText(row.latest_preview);
}

function fmtRelative(iso: string, t: (key: string) => string): string {
  const timestamp = Date.parse(iso);
  if (!timestamp) return "";
  const ms = Date.now() - timestamp;
  if (ms < 60_000) return t("chat.sidebar.now");
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h`;
  if (ms < 7 * 24 * 60 * 60_000) return `${Math.floor(ms / (24 * 60 * 60_000))}d`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
