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
import { useTranslation } from "react-i18next";
import type { Agent, UnreadSummaryRow } from "../../api";

interface Props {
  instances: Agent[];
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
  const { t } = useTranslation();
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
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      inputRef.current?.focus();
    }
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-start sm:pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Switch conversation"
    >
      <div
        className="safe-area-y flex h-full w-full flex-col overflow-hidden bg-bg shadow-2xl sm:h-auto sm:max-h-[64vh] sm:max-w-md sm:rounded-lg sm:border sm:border-border sm:p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-14 items-center gap-2 border-b border-border px-3 sm:hidden">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-text">Find a conversation</div>
            <div className="text-[11px] text-text-muted">Search agents in this project</div>
          </div>
          <button type="button" onClick={onClose} className="touch-target inline-flex h-11 w-11 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-hover hover:text-text" aria-label="Close conversation search">
            ×
          </button>
        </div>
        <div className="border-b border-border px-3 py-3 sm:py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("chat.switcher.placeholder")}
            className="min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 text-base text-text placeholder:text-text-dim focus:border-accent focus:outline-none sm:min-h-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:text-sm"
          />
        </div>

        <ul className="page-safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-[50vh]">
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-text-dim text-sm">{t("chat.switcher.noMatches")}</li>
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
                    className={`w-full min-h-16 px-4 py-3 text-left flex items-center gap-3 sm:min-h-0 sm:px-3 sm:py-2 sm:gap-2 ${
                      active ? "bg-bg-hover" : ""
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        inst.status === "running" ? "bg-green" : "bg-text-dim"
                      }`}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-[15px] text-text truncate sm:text-sm">{inst.name}</span>
                      {s?.latest_preview && (
                        <span className="mt-0.5 block truncate text-xs text-text-muted sm:text-[11px]">
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

        <div className="hidden border-t border-border px-3 py-1.5 items-center justify-between text-[10px] text-text-dim sm:flex">
          <span>{t("chat.switcher.navigate")}</span>
          <span>{t("chat.switcher.select")}</span>
          <span>{t("chat.switcher.close")}</span>
        </div>
      </div>
    </div>
  );
}
