// Left sidebar for /chat — agent list with status, unread, last
// activity and a name filter. Sorted by last-message recency (chats
// you'd care about most surface first); ties broken by name.

import { useMemo, useState } from "react";
import type { Instance, UnreadSummaryRow } from "../../api";

interface Props {
  instances: Instance[];
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
  const [filter, setFilter] = useState("");

  // Index summary rows by instance id for O(1) join.
  const summaryByInstance = useMemo(() => {
    const m = new Map<number, UnreadSummaryRow>();
    for (const s of summary) m.set(s.instance_id, s);
    return m;
  }, [summary]);

  // Sort: instances with a known latest_at come first, sorted desc.
  // Instances with no chat activity yet come last, sorted by name.
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
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter agents…"
          className="w-full bg-bg-input border border-border rounded px-2 py-1 text-sm text-text focus:outline-none focus:border-accent placeholder:text-text-dim"
        />
      </div>

      <div className="px-3 py-2 text-[10px] text-text-dim uppercase tracking-wide">
        Direct messages
      </div>

      <ul className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-text-dim text-sm">No agents</li>
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
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${
                    active ? "bg-bg-hover" : "hover:bg-bg-hover"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                      inst.status === "running" ? "bg-green" : "bg-text-dim"
                    }`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className={`text-sm truncate flex-1 ${active ? "text-text font-medium" : "text-text"}`}>
                        {inst.name}
                      </span>
                      {s?.latest_at && (
                        <span className="text-[10px] text-text-dim shrink-0">
                          {fmtRelative(s.latest_at)}
                        </span>
                      )}
                    </span>
                    {s?.latest_preview && (
                      <span className="block text-[11px] text-text-muted truncate mt-0.5">
                        {previewLabel(s)}
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

function previewLabel(s: UnreadSummaryRow): string {
  const prefix =
    s.latest_role === "user" ? "you: " :
    s.latest_role === "system" ? "" :
    "";
  return prefix + s.latest_preview;
}

function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!t) return "";
  const ms = Date.now() - t;
  if (ms < 60_000) return "now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h`;
  if (ms < 7 * 24 * 60 * 60_000) return `${Math.floor(ms / (24 * 60 * 60_000))}d`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
