import type { ChatMessageRow } from "../api";

// Merge every durable source (initial history, POST responses, SSE, and the
// REST reconciliation backstop) by database id. Delivery channels can race:
// a very fast agent reply may arrive over SSE before the user's POST response
// resolves. Cursor-only filtering would drop that lower-id user row forever.
export function mergeChatMessages(
  current: ChatMessageRow[],
  incoming: ChatMessageRow[],
): ChatMessageRow[] {
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((row) => [row.id, row]));
  let changed = false;
  for (const row of incoming) {
    if (!row || typeof row.id !== "number") continue;
    if (byId.has(row.id)) continue;
    byId.set(row.id, row);
    changed = true;
  }
  if (!changed) return current;
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
