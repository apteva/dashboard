import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { chat, type ApprovalMessageRow, type ChatMessageRow } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { ChatComponentList } from "../apps/chatComponents";

export function ApprovalsInbox() {
  const { currentProject } = useProjects();
  const [rows, setRows] = useState<ApprovalMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!currentProject?.id) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    chat.approvalMessages(currentProject.id, "pending", 10)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [currentProject?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const updateMessage = useCallback((message: ChatMessageRow) => {
    setRows((prev) =>
      prev
        .map((row) => (row.message.id === message.id ? { ...row, message, status: approvalStatus(message) } : row))
        .filter((row) => row.status === "pending"),
    );
  }, []);

  return (
    <section className="border border-border bg-bg-card rounded-lg min-h-[240px] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-text text-sm font-bold">Approvals</h2>
          <p className="text-text-dim text-[11px] mt-0.5">
            Agent requests waiting for a decision
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-[11px] text-text-muted hover:text-text disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="flex-1 p-3 space-y-3 overflow-auto">
        {error && (
          <div className="rounded border border-red/30 bg-red/10 px-3 py-2 text-[11px] text-red">
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="h-full min-h-[150px] flex items-center justify-center text-center text-xs text-text-muted">
            No pending approvals
          </div>
        )}
        {rows.map((row) => (
          <article key={row.message.id} className="rounded-lg border border-border/70 bg-bg-subtle/35 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-text-dim">
                  {row.instance_name || `Agent #${row.instance_id}`}
                </div>
              </div>
              <Link
                to={`/agents/${row.instance_id}`}
                className="shrink-0 text-[11px] text-accent hover:text-accent-hover"
              >
                Open
              </Link>
            </div>
            <ChatComponentList
              components={row.message.components || []}
              apps={[]}
              projectId={currentProject?.id || ""}
              messageId={row.message.id}
              onMessageUpdated={updateMessage}
              onActionComplete={load}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function approvalStatus(message: ChatMessageRow): string {
  for (const c of message.components || []) {
    if (c.app === "channel-chat" && c.name === "approval-card") {
      const status = c.props?.status;
      return typeof status === "string" && status ? status : "pending";
    }
  }
  return "pending";
}
