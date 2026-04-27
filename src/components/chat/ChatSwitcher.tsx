// ⌘K switch-chat palette. Opens as a centred overlay; type to filter
// agents by name, ↑/↓ to move, Enter to switch, Esc to close.
//
// Sort priority — same as the sidebar default but with one twist:
// agents with unread messages always come first. The point of the
// palette is "jump to the chat that needs me", so unread > recency.
//
// We don't open a new EventSource here; the palette is purely a
// switcher over data the page already has loaded.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Instance, UnreadSummaryRow } from "../../api";

interface Props {
  instances: Instance[];
  summary: UnreadSummaryRow[];
  unreadByInstance: Map<number, number>;
  onSelect: (chatId: string) => void;
  onClose: () => void;
}

export function ChatSwitcher({
  instances,
  summary,
  unreadByInstance,
  onSelect,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const summaryByInstance = useMemo(() => {
    const m = new Map<number, UnreadSummaryRow>();
    for (const s of summary) m.set(s.instance_id, s);
    return m;
  }, [summary]);

  // Filter + rank. Unread first, then last-message recency, then name.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? instances.filter((i) => i.name.toLowerCase().includes(q))
      : [...instances];
    list.sort((a, b) => {
      const ua = unreadByInstance.get(a.id) || 0;
      const ub = unreadByInstance.get(b.id) || 0;
      if (ua !== ub) return ub - ua;
      const sa = summaryByInstance.get(a.id);
      const sb = summaryByInstance.get(b.id);
      const ta = sa?.latest_at ? Date.parse(sa.latest_at) : 0;
      const tb = sb?.latest_at ? Date.parse(sb.latest_at) : 0;
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [instances, query, unreadByInstance, summaryByInstance]);

  // Reset cursor when filter changes; clamp to bounds.
  useEffect(() => {
    setCursor((c) => {
      if (filtered.length === 0) return 0;
      return Math.min(c, filtered.length - 1);
    });
  }, [filtered]);

  // Autofocus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[cursor];
      if (target) onSelect(`default-${target.id}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-bg border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-border">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Switch chat…"
            className="w-full bg-transparent text-text text-sm focus:outline-none placeholder:text-text-dim"
          />
        </div>

        <ul className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-text-dim text-sm">No matches</li>
          ) : (
            filtered.map((inst, i) => {
              const s = summaryByInstance.get(inst.id);
              const unread = unreadByInstance.get(inst.id) || 0;
              const active = i === cursor;
              return (
                <li key={inst.id}>
                  <button
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => onSelect(`default-${inst.id}`)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                      active ? "bg-bg-hover" : ""
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        inst.status === "running" ? "bg-green" : "bg-text-dim"
                      }`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm text-text truncate">{inst.name}</span>
                      {s?.latest_preview && (
                        <span className="block text-[11px] text-text-muted truncate">
                          {s.latest_preview}
                        </span>
                      )}
                    </span>
                    {unread > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-bold flex items-center justify-center">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t border-border px-3 py-1.5 flex items-center justify-between text-[10px] text-text-dim">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
