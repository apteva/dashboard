// Left sidebar for /chat — agent list with status, unread, last
// activity and a name filter. Sorted by last-message recency (chats
// you'd care about most surface first); ties broken by name.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Agent, UnreadSummaryRow } from "../../api";

interface Props {
  instances: Agent[];
  summary: UnreadSummaryRow[];
  unreadByInstance: Map<number, number>;
  focusedChatId: string | null;
  onSelect: (chatId: string) => void;
}

export function ChatSidebar({
  instances,
  summary,
  unreadByInstance,
  focusedChatId,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");

  // Index summary rows by instance id for O(1) join.
  const summaryByInstance = useMemo(() => {
    const m = new Map<number, UnreadSummaryRow>();
    for (const s of summary) m.set(s.instance_id, s);
    return m;
  }, [summary]);

  // Sort: instances with a known latest_at come first, sorted desc.
  // Agents with no chat activity yet come last, sorted by name.
  const sorted = useMemo(() => {
    const copy = [...instances];
    copy.sort((a, b) => {
      const sa = summaryByInstance.get(a.id);
      const sb = summaryByInstance.get(b.id);
      const ta = sa?.latest_at ? Date.parse(sa.latest_at) : 0;
      const tb = sb?.latest_at ? Date.parse(sb.latest_at) : 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }, [instances, summaryByInstance]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((i) => i.name.toLowerCase().includes(q));
  }, [sorted, filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-3 md:py-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("chat.sidebar.filterAgents")}
          className="min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-base text-text placeholder:text-text-dim focus:border-accent focus:outline-none md:min-h-0 md:rounded md:px-2 md:py-1 md:text-sm"
        />
      </div>

      <div className="px-3 py-2 text-[10px] text-text-dim uppercase tracking-wide">
        {t("chat.sidebar.directMessages")}
      </div>

      <ul className="page-safe-bottom flex-1 overflow-y-auto overscroll-contain">
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-text-dim text-sm">{t("chat.sidebar.noAgents")}</li>
        ) : (
          filtered.map((inst) => {
            const s = summaryByInstance.get(inst.id);
            const chatId = `default-${inst.id}`;
            const active = focusedChatId === chatId;
            const unread = unreadByInstance.get(inst.id) || 0;
            return (
              <li key={inst.id}>
                <button
                  onClick={() => onSelect(chatId)}
                  className={`w-full min-h-16 text-left px-4 py-3 md:min-h-0 md:px-3 md:py-2 flex items-start gap-3 md:gap-2 transition-colors ${
                    active ? "bg-bg-hover" : "hover:bg-bg-hover"
                  }`}
                >
                  <span
                    className={`w-2 h-2 md:w-1.5 md:h-1.5 rounded-full shrink-0 mt-1.5 ${
                      inst.status === "running" ? "bg-green" : "bg-text-dim"
                    }`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className={`text-[15px] md:text-sm truncate flex-1 ${active ? "text-text font-medium" : "text-text"}`}>
                        {inst.name}
                      </span>
                      {s?.latest_at && (
                        <span className="text-[10px] text-text-dim shrink-0">
                          {fmtRelative(s.latest_at, t)}
                        </span>
                      )}
                    </span>
                    {s?.latest_preview && (
                      <span className="block text-xs md:text-[11px] text-text-muted truncate mt-1 md:mt-0.5">
                        {previewLabel(s, t)}
                      </span>
                    )}
                  </span>
                  {unread > 0 && (
                    <span className="shrink-0 mt-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-bold flex items-center justify-center">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function previewLabel(s: UnreadSummaryRow, t: (key: string) => string): string {
  const prefix =
    s.latest_role === "user" ? t("chat.sidebar.youPrefix") :
    s.latest_role === "system" ? "" :
    "";
  return prefix + s.latest_preview;
}

function fmtRelative(iso: string, t: (key: string) => string): string {
  const timestamp = Date.parse(iso);
  if (!timestamp) return "";
  const ms = Date.now() - timestamp;
  if (ms < 60_000) return t("chat.sidebar.now");
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h`;
  if (ms < 7 * 24 * 60 * 60_000) return `${Math.floor(ms / (24 * 60 * 60_000))}d`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
