import { useEffect, useState, useMemo } from "react";
import { core, type MemoryItem } from "../api";
import { Modal } from "./Modal";

// MemoryPanel — viewer + editor for what the agent has remembered.
//
// Memories are auto-recalled by vector similarity, so this panel is
// where users actually *manage* the learn-mode safety profile: see
// what the agent picked up, correct badly-worded rules, prune noise.
//
// Layout: filter bar on top, row-per-memory below. Click a row to
// edit. Click the trash icon to delete with confirm. Tag extracted
// by the server (the bracketed prefix the remember-tool guidance
// asks the agent to use) colors the row and fuels the filter.
interface Props {
  instanceId: number;
}

// Stable color mapping per tag. Using the existing CSS tokens so
// we don't ship a new palette — accent, blue, green, red. Tags
// outside this set fall back to neutral text-muted.
const TAG_COLORS: Record<string, string> = {
  preference: "text-green",
  correction: "text-red",
  decision: "text-blue",
  fact: "text-accent",
  user: "text-accent",
};

function tagClass(tag?: string): string {
  if (!tag) return "text-text-muted";
  return TAG_COLORS[tag.toLowerCase()] || "text-text-muted";
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / 3_600_000;
    if (diffH < 1) return `${Math.max(1, Math.round(diffMs / 60_000))}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    const diffD = diffH / 24;
    if (diffD < 30) return `${Math.round(diffD)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function MemoryPanel({ instanceId }: Props) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MemoryItem | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await core.listMemory(instanceId);
      setItems(data);
    } catch (e: any) {
      setError(e?.message || "failed to load memories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Poll every 10s so new remembers show up while the agent is
    // working without hammering the core. The embedding recompute on
    // update is already the expensive part of a write; the read is cheap.
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [instanceId]);

  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.tag) s.add(it.tag.toLowerCase());
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((it) => {
      if (tagFilter && it.tag?.toLowerCase() !== tagFilter) return false;
      if (q && !it.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, filter, tagFilter]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await core.deleteMemory(instanceId, deleting.index);
      // Indices shift after a delete — reload the whole list to resync.
      // Cheap (<5KB typically) and avoids off-by-one bugs for rapid
      // multi-deletes.
      setDeleting(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "delete failed");
    } finally {
      setDeletingBusy(false);
    }
  };

  const openEdit = (item: MemoryItem) => {
    setEditing(item);
    setEditText(item.text);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const text = editText.trim();
    if (!text) return;
    setSaving(true);
    try {
      await core.updateMemory(instanceId, editing.index, text);
      setEditing(null);
      setEditText("");
      await load();
    } catch (e: any) {
      setError(e?.message || "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex items-center gap-3">
        <span className="text-text-muted text-xs">// MEMORY</span>
        <span className="text-text-dim text-xs">{items.length} total</span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="ml-auto bg-bg-input border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent w-48"
        />
        <button
          onClick={load}
          className="text-text-muted text-xs hover:text-text"
          title="reload"
        >
          ↻
        </button>
      </div>

      {tags.length > 0 && (
        <div className="border-b border-border px-4 py-2 flex gap-2 flex-wrap">
          <button
            onClick={() => setTagFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded border ${tagFilter === null ? "border-accent text-accent" : "border-border text-text-muted hover:text-text"}`}
          >
            all
          </button>
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
              className={`text-[10px] px-2 py-0.5 rounded border lowercase ${tagFilter === t ? "border-accent text-accent" : "border-border " + tagClass(t)}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && items.length === 0 && (
          <div className="p-4 text-text-muted text-xs">loading…</div>
        )}
        {error && (
          <div className="p-4 text-red text-xs">error: {error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="p-4 text-text-muted text-xs">
            {items.length === 0
              ? "no memories yet — the agent hasn't remembered anything"
              : "no matches"}
          </div>
        )}
        {filtered.map((it) => (
          <div
            key={it.index}
            className="border-b border-border-subtle px-4 py-2 hover:bg-bg-hover group cursor-pointer"
            onClick={() => openEdit(it)}
          >
            <div className="flex items-start gap-2">
              {it.tag && (
                <span className={`text-[10px] uppercase tracking-wide ${tagClass(it.tag)} shrink-0 mt-0.5`}>
                  [{it.tag}]
                </span>
              )}
              <div className="flex-1 text-sm text-text leading-snug whitespace-pre-wrap break-words">
                {it.tag ? it.text.replace(/^\s*\[[^\]]+\]\s*/, "") : it.text}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleting(it);
                }}
                className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red text-xs transition-opacity shrink-0"
                title="delete"
              >
                ✕
              </button>
            </div>
            <div className="text-text-dim text-[10px] mt-1 flex gap-2">
              <span>#{it.index}</span>
              <span>·</span>
              <span>{fmtTime(it.time)}</span>
              {it.namespace && (
                <>
                  <span>·</span>
                  <span>ns:{it.namespace}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}>
        <div className="p-6 w-[560px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">Edit memory #{editing?.index}</h2>
          <p className="text-text-dim text-xs leading-snug">
            Saving will recompute the embedding, so recall will surface the
            new wording instead of the old one. Keep the bracketed tag at the
            start ([preference], [correction], etc.) so tag-based filtering
            still works.
          </p>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={6}
            className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-accent resize-none font-mono"
          />
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={saveEdit}
              disabled={saving || !editText.trim()}
              className="px-4 py-2 bg-accent text-bg font-bold rounded-lg text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => !deletingBusy && setDeleting(null)}>
        <div className="p-6 w-[480px] max-w-full space-y-3">
          <h2 className="text-text text-base font-bold">Delete memory #{deleting?.index}?</h2>
          <p className="text-text-dim text-xs leading-snug">
            The agent will forget this immediately. Future recall will no
            longer surface it. This can't be undone.
          </p>
          {deleting && (
            <div className="bg-bg-input border border-border rounded-lg px-3 py-2 text-xs text-text-muted font-mono max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
              {deleting.text}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setDeleting(null)}
              disabled={deletingBusy}
              className="px-4 py-2 border border-border rounded-lg text-sm text-text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deletingBusy}
              className="px-4 py-2 bg-red text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
            >
              {deletingBusy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
