import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { chat, type ReportMessageRow } from "../../api";
import { useProjects } from "../../hooks/useProjects";
import { ChatComponentList } from "../apps/chatComponents";

export function ReportsInbox({ allProjects = false, limit = 5 }: { allProjects?: boolean; limit?: number }) {
  const { currentProject } = useProjects();
  const [rows, setRows] = useState<ReportMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const projectId = allProjects ? undefined : currentProject?.id;
    if (!allProjects && !projectId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    chat.reportMessages(projectId, limit)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [allProjects, currentProject?.id, limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="border border-border bg-bg-card rounded-lg min-h-[240px] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-text text-sm font-bold">Reports</h2>
          <p className="text-text-dim text-[11px] mt-0.5">
            Agent reports and summaries
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
            No reports yet
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
            />
          </article>
        ))}
      </div>
    </section>
  );
}
