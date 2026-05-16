import { useEffect, useState } from "react";
import {
  evals as evalsAPI,
  type Eval,
  type EvalRun,
  type EvalMock,
  type DirectiveEditSuggestion,
} from "../api";

// EvalsPanel — agent detail page surface for behavioural tests.
//
// Lists every eval attached to this agent (seeded from the template
// at create time + any operator-added), with last status + a Run
// button per row. Selecting a row reveals the editor + run history
// + the trajectory pane.
//
// Runs here are always strict single-shot: one attempt, one judge
// pass, pass/fail. This is the right shape for live-agent
// monitoring — the question is "does the live agent still
// behave?", not "what would help it pass". The wizard's Verify
// step is where the improvement loop lives; once an agent is
// running, evals are a regression check.
export function EvalsPanel({ agentID }: { agentID: number }) {
  const [list, setList] = useState<Eval[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<EvalRun[]>([]);
  const [activeRun, setActiveRun] = useState<EvalRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Eval | null>(null);
  // Suggestion-apply state: each row tracks which directive_edit
  // ids the operator has checked. Keyed by run id. Defensive
  // cover for the case where a run somehow carries suggestions
  // (e.g. an API call from elsewhere) — strict runs from this
  // panel produce none.
  const [pendingApply, setPendingApply] = useState<Record<number, Set<string>>>({});
  const [applying, setApplying] = useState(false);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);

  const load = () => {
    evalsAPI
      .list(agentID)
      .then((evs) => {
        setList(evs);
        if (!selected && evs.length > 0) setSelected(evs[0]!.id);
      })
      .catch((e) => setError(e?.message || "failed to load evals"));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentID]);

  // When the selected eval changes, fetch its run history + reset
  // editor state so a stale draft from another eval doesn't leak.
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setApplyNotice(null);
    if (!selected) {
      setRunHistory([]);
      setActiveRun(null);
      return;
    }
    evalsAPI
      .runs(agentID, selected)
      .then((rs) => {
        setRunHistory(rs);
        setActiveRun(rs[0] ?? null);
      })
      .catch(() => {
        setRunHistory([]);
        setActiveRun(null);
      });
  }, [agentID, selected]);

  const onRun = async (evalID: string) => {
    setRunning(true);
    setError(null);
    setApplyNotice(null);
    try {
      // Strict single-shot. No iteration loop for live-agent
      // monitoring — the run measures the agent as-is, with no
      // ephemeral directive edits or judge hand-holding.
      const run = await evalsAPI.run(agentID, evalID, { max_iterations: 1 });
      setActiveRun(run);
      // Push to the front of the history without a full refetch.
      setRunHistory((prev) => [run, ...prev].slice(0, 10));
      // Refresh the list so last_status updates without a manual reload.
      load();
    } catch (e: any) {
      setError(e?.message || "eval run failed");
    } finally {
      setRunning(false);
    }
  };

  const onAdd = async () => {
    const blank: Partial<Eval> = {
      name: "New eval",
      description: "",
      goals: [""],
      mocks: [],
      max_turns: 5,
    };
    try {
      const created = await evalsAPI.create(agentID, blank);
      await load();
      setSelected(created.id);
      setEditing(true);
      setDraft(created);
    } catch (e: any) {
      setError(e?.message || "create eval failed");
    }
  };

  const onSaveDraft = async () => {
    if (!draft) return;
    try {
      const updated = await evalsAPI.update(agentID, draft.id, {
        name: draft.name,
        description: draft.description,
        goals: draft.goals.filter((g) => g.trim()),
        mocks: draft.mocks,
        max_turns: draft.max_turns,
      });
      // Splice the updated row back into the list to avoid a refetch.
      setList((prev) => prev?.map((e) => (e.id === updated.id ? updated : e)) ?? null);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || "save eval failed");
    }
  };

  const onDelete = async (evalID: string) => {
    if (!confirm("Delete this eval and its run history?")) return;
    try {
      await evalsAPI.delete(agentID, evalID);
      setSelected(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "delete eval failed");
    }
  };

  // toggleApply queues / unqueues a directive_edit id for the
  // currently-selected active run. The apply button uses this set
  // to POST the chosen subset to the /apply endpoint.
  const toggleApply = (runID: number, suggID: string) => {
    setPendingApply((prev) => {
      const cur = new Set(prev[runID] ?? []);
      if (cur.has(suggID)) cur.delete(suggID);
      else cur.add(suggID);
      return { ...prev, [runID]: cur };
    });
  };

  const onApply = async () => {
    if (!activeRun || !selected) return;
    const ids = Array.from(pendingApply[activeRun.id] ?? []);
    if (ids.length === 0) return;
    setApplying(true);
    setApplyNotice(null);
    try {
      const res = await evalsAPI.applySuggestions(agentID, selected, activeRun.id, {
        directive_edit_ids: ids,
      });
      setApplyNotice(
        `Applied ${res.edits_applied} edit${res.edits_applied === 1 ? "" : "s"} to the agent's directive.`,
      );
      // Clear the queue for this run so the operator can't double-apply.
      setPendingApply((prev) => ({ ...prev, [activeRun.id]: new Set() }));
    } catch (e: any) {
      setError(e?.message || "apply failed");
    } finally {
      setApplying(false);
    }
  };

  if (!list) {
    return <div className="p-4 text-text-muted text-sm">Loading evals…</div>;
  }

  const selectedEval = list.find((e) => e.id === selected);

  return (
    <div className="h-full flex flex-col">
      {/* Eval list */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-text-muted text-xs uppercase tracking-wide">Evals</h3>
          <button
            onClick={onAdd}
            className="text-accent text-xs hover:underline"
          >
            + Add eval
          </button>
        </div>
        {list.length === 0 ? (
          <p className="text-text-muted text-sm py-2">
            No evals yet. Click <span className="text-text font-medium">+ Add eval</span> to author one.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((ev) => (
              <li key={ev.id}>
                <div
                  onClick={() => setSelected(ev.id)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-colors cursor-pointer ${
                    selected === ev.id ? "bg-bg-card border border-border" : "hover:bg-bg-card"
                  }`}
                >
                  <StatusDot status={ev.last_status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-text text-sm">{ev.name}</div>
                    <div className="text-text-muted text-xs">
                      {ev.source}
                      {ev.last_run_at && ` · last run ${formatAgo(ev.last_run_at)}`}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <div className="text-red text-xs mt-2 border-l-2 border-red pl-2">{error}</div>
        )}
      </div>

      {/* Detail pane for the selected eval */}
      {selectedEval && (
        <div className="flex-1 overflow-auto p-4">
          {editing && draft ? (
            <EvalEditor
              draft={draft}
              setDraft={setDraft}
              onSave={onSaveDraft}
              onCancel={() => {
                setEditing(false);
                setDraft(null);
              }}
            />
          ) : (
            <>
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-text font-medium">{selectedEval.name}</h3>
                  {selectedEval.description && (
                    <p className="text-text-muted text-sm mt-1 whitespace-pre-wrap">
                      {selectedEval.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setDraft(selectedEval);
                      setEditing(true);
                    }}
                    className="text-text-muted text-xs hover:text-text"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(selectedEval.id)}
                    className="text-text-muted text-xs hover:text-red"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <details open className="mb-4 text-text-muted text-xs">
                <summary className="cursor-pointer hover:text-text">
                  Goals ({selectedEval.goals.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {selectedEval.goals.map((g, i) => (
                    <li key={i} className="text-text text-sm">
                      · {g}
                    </li>
                  ))}
                </ul>
              </details>

              {/* Run button — one attempt, pass/fail. Live-agent
                  monitoring shouldn't iterate or hand-hold; that's
                  what the wizard's Verify step is for. */}
              <div className="mb-4 flex items-center gap-3">
                <button
                  onClick={() => onRun(selectedEval.id)}
                  disabled={running}
                  className="px-4 py-2 bg-accent text-bg rounded font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {running ? "Running…" : "Run eval"}
                </button>
                <span className="text-text-muted text-xs">
                  Single attempt · checks the live agent passes today
                </span>
              </div>

              {activeRun ? (
                <RunResult
                  run={activeRun}
                  pendingIds={pendingApply[activeRun.id] ?? new Set()}
                  onToggleApply={(suggID) => toggleApply(activeRun.id, suggID)}
                  onApply={onApply}
                  applying={applying}
                  applyNotice={applyNotice}
                />
              ) : (
                <div className="text-text-muted text-sm">
                  No runs yet. Click <span className="text-text font-medium">Run eval</span> above.
                </div>
              )}

              {runHistory.length > 1 && (
                <details className="mt-4 text-text-muted text-xs">
                  <summary className="cursor-pointer hover:text-text">
                    Run history ({runHistory.length})
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {runHistory.map((r) => (
                      <li
                        key={r.id}
                        className={`flex items-center gap-2 cursor-pointer hover:text-text ${
                          activeRun?.id === r.id ? "text-text" : ""
                        }`}
                        onClick={() => setActiveRun(r)}
                      >
                        <StatusDot status={r.status} />
                        <span>{formatAgo(r.started_at)}</span>
                        <span>·</span>
                        <span>{(r.duration_ms / 1000).toFixed(1)}s</span>
                        {r.iterations_used > 1 && (
                          <>
                            <span>·</span>
                            <span>{r.iterations_used} iters</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// EvalEditor — full-row editor for name + description + goals +
// mocks + max_turns. Mocks are edited as raw JSON because the
// shape is open (args_match is an arbitrary subset, return is an
// arbitrary blob). A structured editor would lie about that
// flexibility; the JSON textarea is honest about it.
function EvalEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: Eval;
  setDraft: React.Dispatch<React.SetStateAction<Eval | null>>;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (patch: Partial<Eval>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));
  const setGoal = (i: number, value: string) => {
    const goals = draft.goals.slice();
    goals[i] = value;
    update({ goals });
  };
  const addGoal = () => update({ goals: [...draft.goals, ""] });
  const removeGoal = (i: number) => update({ goals: draft.goals.filter((_, j) => j !== i) });

  const canSave = !!draft.description.trim() && draft.goals.some((g) => g.trim());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-text-muted text-xs uppercase tracking-wide block mb-1">Name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => update({ name: (e.target as HTMLInputElement).value })}
          className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="text-text-muted text-xs uppercase tracking-wide block mb-1">Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => update({ description: (e.target as HTMLTextAreaElement).value })}
          rows={5}
          placeholder="What the agent should do."
          className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text font-mono resize-y focus:outline-none focus:border-accent"
        />
        <p className="text-text-dim text-[11px] mt-1">
          The agent reads this as its opening event.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-text-muted text-xs uppercase tracking-wide">Goals</label>
          <button onClick={addGoal} className="text-accent text-xs hover:underline">
            + Add goal
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {draft.goals.map((g, i) => (
            <li key={i} className="flex items-start gap-2">
              <textarea
                value={g}
                onChange={(e) => setGoal(i, e.target.value)}
                rows={2}
                placeholder="A behaviour the agent should demonstrate"
                className="flex-1 bg-bg-input border border-border rounded p-2 text-text text-sm font-mono resize-y focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => removeGoal(i)}
                className="text-text-muted hover:text-red text-xs mt-2"
                title="Remove goal"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <p className="text-text-dim text-[11px] mt-1">
          The judge grades each goal pass/fail. The agent doesn't see this list.
        </p>
      </div>
      <MocksEditor mocks={draft.mocks} onChange={(mocks) => update({ mocks })} />
      <div>
        <label className="text-text-muted text-xs uppercase tracking-wide block mb-1">Max turns per attempt</label>
        <input
          type="number"
          min={1}
          max={50}
          value={draft.max_turns}
          onChange={(e) =>
            update({ max_turns: Math.max(1, Number((e.target as HTMLInputElement).value) || 1) })
          }
          className="w-24 bg-bg-input border border-border rounded-md px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
        />
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="px-4 py-2 bg-accent text-bg rounded font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          Save
        </button>
        <button onClick={onCancel} className="text-text-muted text-xs hover:text-text">
          Cancel
        </button>
      </div>
    </div>
  );
}

// MocksEditor edits the array as JSON. Same rationale as in
// EvalEditor — the shape is flexible enough that a structured
// form would be lossy. Parse errors are shown inline; the parent
// receives only valid arrays.
function MocksEditor({ mocks, onChange }: { mocks: EvalMock[]; onChange: (m: EvalMock[]) => void }) {
  const [text, setText] = useState(() => JSON.stringify(mocks, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <label className="text-text-muted text-xs uppercase tracking-wide block mb-1">
        Pinned mocks (JSON)
      </label>
      <textarea
        value={text}
        onChange={(e) => {
          const v = (e.target as HTMLTextAreaElement).value;
          setText(v);
          try {
            const parsed = JSON.parse(v);
            if (!Array.isArray(parsed)) throw new Error("must be an array");
            setErr(null);
            onChange(parsed);
          } catch (er: any) {
            setErr(er?.message || "invalid JSON");
          }
        }}
        rows={6}
        spellCheck={false}
        className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-xs text-text font-mono resize-y focus:outline-none focus:border-accent"
      />
      {err && <p className="text-red text-[11px] mt-1">{err}</p>}
      <p className="text-text-dim text-[11px] mt-1">
        Each entry: <code>{`{"app": "...", "tool": "...", "return": {...}}`}</code> or <code>{`{"error": "..."}`}</code>. Unmocked tool calls fall back to a stub unless Strict mocks is on.
      </p>
    </div>
  );
}

function StatusDot({ status }: { status?: string }) {
  const color =
    status === "pass"
      ? "bg-green"
      : status === "fail"
        ? "bg-red"
        : status === "error"
          ? "bg-amber"
          : "bg-border";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
}

function formatAgo(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// RunResult renders one EvalRun's verdict + suggestions + trajectory.
// Suggestion checkboxes are wired through the parent's pendingIds
// + onToggleApply + onApply so the apply call can POST a single
// batch.
function RunResult({
  run,
  pendingIds,
  onToggleApply,
  onApply,
  applying,
  applyNotice,
}: {
  run: EvalRun;
  pendingIds: Set<string>;
  onToggleApply: (suggID: string) => void;
  onApply: () => void;
  applying: boolean;
  applyNotice: string | null;
}) {
  const isPass = run.status === "pass";
  const isError = run.status === "error";
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`px-3 py-2 rounded border text-sm inline-flex items-center gap-2 ${
          isPass
            ? "border-green/40 bg-green/5 text-green"
            : isError
              ? "border-amber/40 bg-amber/5 text-amber"
              : "border-red/40 bg-red/5 text-red"
        }`}
      >
        {isPass ? "Pass" : isError ? "Error" : "Fail"}
        <span className="text-text-muted text-xs">
          {(run.duration_ms / 1000).toFixed(1)}s · {run.turns_used} turn{run.turns_used === 1 ? "" : "s"}
          {run.iterations_used > 1 && ` · ${run.iterations_used} iters`}
        </span>
      </div>

      {run.error_message && (
        <div className="text-amber text-xs border-l-2 border-amber pl-3 whitespace-pre-wrap">
          {run.error_message}
        </div>
      )}

      {run.verdict && (
        <div className="flex flex-col gap-2">
          {run.verdict.reasoning && (
            <p className="text-text-muted text-xs italic">{run.verdict.reasoning}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {run.verdict.per_goal.map((g, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`inline-block w-3 h-3 rounded-full mt-1 shrink-0 ${
                    g.verdict === "pass" ? "bg-green" : "bg-red"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-text text-sm">{g.goal}</div>
                  <div className="text-text-muted text-xs mt-0.5">{g.why}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Directive-edit suggestions with apply UX. Only renders
          when the run actually proposed any (improvement mode +
          fail verdict). */}
      {run.suggestions?.directive_edits && run.suggestions.directive_edits.length > 0 && (
        <div className="border border-border rounded-md p-3 bg-bg-card flex flex-col gap-2">
          <div className="text-text-muted text-xs uppercase tracking-wide">
            Directive suggestions
          </div>
          <p className="text-text-dim text-[11px]">
            Check the edits you want to append to the live agent's directive. Each accepted edit is added to <code>agent_directive_history</code> with this run as the source.
          </p>
          <ul className="flex flex-col gap-2 mt-1">
            {run.suggestions.directive_edits.map((sugg) => (
              <SuggestionRow
                key={sugg.id}
                sugg={sugg}
                checked={pendingIds.has(sugg.id)}
                onToggle={() => onToggleApply(sugg.id)}
              />
            ))}
          </ul>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={onApply}
              disabled={applying || pendingIds.size === 0}
              className="px-3 py-1.5 bg-accent text-bg rounded text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {applying ? "Applying…" : `Apply ${pendingIds.size} edit${pendingIds.size === 1 ? "" : "s"}`}
            </button>
            {applyNotice && <span className="text-green text-xs">{applyNotice}</span>}
          </div>
        </div>
      )}

      <details className="text-text-muted text-xs">
        <summary className="cursor-pointer hover:text-text">
          Trajectory ({run.trajectory.turns.length} turns)
        </summary>
        <div className="mt-2 flex flex-col gap-1.5 max-h-96 overflow-y-auto font-mono">
          {run.trajectory.turns.map((turn, i) => {
            const isJudge = turn.role === "judge";
            const isSystem = turn.role === "system";
            return (
              <div
                key={i}
                className={`text-xs border-l-2 pl-2 ${
                  isJudge
                    ? "border-amber"
                    : isSystem
                      ? "border-text-dim"
                      : "border-border"
                }`}
              >
                <span className={isJudge ? "text-amber" : isSystem ? "text-text-dim" : "text-accent"}>
                  {turn.role.toUpperCase()}
                  {turn.iteration ? ` (iter ${turn.iteration})` : ""}
                </span>
                {turn.content && (
                  <span className="text-text ml-2 whitespace-pre-wrap">{turn.content}</span>
                )}
                {turn.tool_call && (
                  <span className="text-text ml-2">
                    {turn.tool_call.app}.{turn.tool_call.tool}
                    {turn.tool_call.warning && (
                      <span className="text-amber ml-1">[{turn.tool_call.warning}]</span>
                    )}
                    {turn.tool_call.error && (
                      <span className="text-red ml-1">error: {turn.tool_call.error}</span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function SuggestionRow({
  sugg,
  checked,
  onToggle,
}: {
  sugg: DirectiveEditSuggestion;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-text text-sm whitespace-pre-wrap">{sugg.add}</div>
        {sugg.reason && (
          <div className="text-text-muted text-xs mt-0.5 italic">{sugg.reason}</div>
        )}
        {sugg.helped && (
          <div className="text-green text-[11px] mt-0.5">✓ helped a later iteration pass</div>
        )}
      </div>
    </li>
  );
}
