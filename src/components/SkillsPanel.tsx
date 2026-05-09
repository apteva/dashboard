// SkillsPanel — per-instance "Skills loaded" view.
//
// Source of truth: the agent's memory.jsonl (read server-side, surfaced
// via GET /api/instances/:id/skills). Status per row:
//   synced   — record present and matches catalog body hash
//   stale    — record present but body changed in the catalog
//   missing  — catalog row exists, no record on this agent
//   orphaned — record on this agent, no matching catalog row
//
// Mirror image of the Skills page side panel: that view says "this skill
// → which agents", this view says "this agent → which skills".

import { useEffect, useState } from "react";
import {
  instanceSkills as instanceSkillsApi,
  type InstanceSkill,
  type InstanceSkillStatus,
} from "../api";
import { StatusPill } from "../pages/Skills";

export function SkillsPanel({ instanceId }: { instanceId: number }) {
  const [rows, setRows] = useState<InstanceSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    instanceSkillsApi
      .list(instanceId)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // Group rows by status for display: assigned (synced/stale/orphaned)
  // first, then available (missing).
  const assigned = rows.filter((r) => r.status !== "missing");
  const available = rows.filter((r) => r.status === "missing");

  const action = async (
    row: InstanceSkill,
    op: "assign" | "unassign",
  ) => {
    if (row.skill_id === 0) {
      // Orphan — only unassign is meaningful, and we don't have a
      // catalog id to call /skills/:id with. Surface a hint.
      setError("Orphaned record — delete it from the agent's memory panel.");
      return;
    }
    const key = `${op}:${row.skill_id}`;
    setBusyKey(key);
    setError(null);
    try {
      if (op === "assign") {
        await instanceSkillsApi.assign(instanceId, row.skill_id);
      } else {
        await instanceSkillsApi.unassign(instanceId, row.skill_id);
      }
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-text-dim text-sm">Loading skills…</div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <header className="px-5 py-3 border-b border-border flex items-center gap-3 sticky top-0 bg-bg-card z-10">
        <h2 className="text-text text-sm font-medium">Skills loaded</h2>
        <span className="text-text-dim text-xs">
          {assigned.length} assigned, {available.length} available
        </span>
        <button
          type="button"
          onClick={refresh}
          className="ml-auto text-xs text-text-muted hover:text-text"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="px-5 py-2 text-error text-xs border-b border-border">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-12 text-center text-text-muted text-sm">
          No skills in this project yet. Create one in{" "}
          <code className="text-text">Skills</code> or install an app that ships skills.
        </div>
      ) : (
        <>
          <Section title="Assigned">
            {assigned.length === 0 ? (
              <div className="px-5 py-4 text-text-dim text-xs">
                No skills assigned to this agent yet — toggle one below.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {assigned.map((row) => (
                  <SkillRow
                    key={`assigned-${row.skill_id}-${row.slug}`}
                    row={row}
                    op="unassign"
                    busy={busyKey === `unassign:${row.skill_id}`}
                    onAction={() => action(row, "unassign")}
                    onResync={
                      row.status === "stale"
                        ? () => action(row, "assign")
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </Section>
          {available.length > 0 && (
            <Section title="Available in this project">
              <ul className="divide-y divide-border">
                {available.map((row) => (
                  <SkillRow
                    key={`avail-${row.skill_id}-${row.slug}`}
                    row={row}
                    op="assign"
                    busy={busyKey === `assign:${row.skill_id}`}
                    onAction={() => action(row, "assign")}
                  />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="px-5 pt-4 pb-2 text-text-dim text-[10px] uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SkillRow({
  row,
  op,
  busy,
  onAction,
  onResync,
}: {
  row: InstanceSkill;
  op: "assign" | "unassign";
  busy: boolean;
  onAction: () => void;
  onResync?: () => void;
}) {
  return (
    <li className="px-5 py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-text text-sm font-medium">{row.name}</span>
          {row.app_name && (
            <span className="text-[10px] text-text-dim">
              From <span className="text-text-muted font-medium">{row.app_name}</span>
            </span>
          )}
          {row.source === "user" && (
            <span className="text-[10px] uppercase tracking-wide text-text-dim">
              My skill
            </span>
          )}
          <StatusBadge status={row.status} />
        </div>
        {row.description && (
          <p className="text-text-muted text-xs mt-0.5 line-clamp-2">
            {row.description}
          </p>
        )}
        <div className="text-text-dim text-[10px] mt-1 font-mono truncate">
          {row.slug}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onResync && (
          <button
            type="button"
            onClick={onResync}
            disabled={busy}
            className="px-2 py-1 text-xs rounded border border-warn text-warn hover:bg-warn/10"
          >
            {busy ? "…" : "Re-sync"}
          </button>
        )}
        <button
          type="button"
          onClick={onAction}
          disabled={busy || row.skill_id === 0}
          title={row.skill_id === 0 ? "Orphan — manage from the memory panel" : undefined}
          className={`px-2 py-1 text-xs rounded border ${
            op === "assign"
              ? "border-accent text-accent hover:bg-accent/10"
              : "border-border text-text-muted hover:bg-bg-input"
          } disabled:opacity-40`}
        >
          {busy ? "…" : op === "assign" ? "Assign" : "Remove"}
        </button>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: InstanceSkillStatus }) {
  return <StatusPill status={status} />;
}
