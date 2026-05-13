import { useEffect, useState } from "react";
import { evals as evalsAPI, type Eval, type EvalRun } from "../api";

// EvalsPanel — agent detail page surface for behavioural tests.
// Lists every eval attached to this agent (seeded from the
// template at create time + any operator-added), with last status
// + a Run button per row. Selecting a row reveals the run history
// + the trajectory pane.
//
// Pairs with the wizard's Verify step (which uses the stateless
// /evals/preview endpoint against a draft directive). Once the
// agent exists, this panel takes over: edits + runs land in
// agent_evals / agent_eval_runs and persist across reloads.
export function EvalsPanel({ agentID }: { agentID: number }) {
  const [list, setList] = useState<Eval[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<EvalRun[]>([]);
  const [activeRun, setActiveRun] = useState<EvalRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // When the selected eval changes, fetch its run history. PR-1
  // returns up to 10 most-recent runs.
  useEffect(() => {
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
    try {
      const run = await evalsAPI.run(agentID, evalID);
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

  if (!list) {
    return <div className="p-4 text-text-muted text-sm">Loading evals…</div>;
  }
  if (list.length === 0) {
    return (
      <div className="p-4 flex flex-col gap-2 text-text-muted text-sm">
        <div className="text-text font-medium">No evals yet</div>
        <p>
          This agent has no behavioural tests attached. Evals normally come from the template you used to create the agent — if you skipped the wizard or picked Empty, you can add one manually here in a future release.
        </p>
      </div>
    );
  }

  const selectedEval = list.find((e) => e.id === selected) ?? list[0]!;

  return (
    <div className="h-full flex flex-col">
      {/* Eval list */}
      <div className="border-b border-border p-3">
        <ul className="flex flex-col gap-1">
          {list.map((ev) => (
            <li key={ev.id}>
              <button
                onClick={() => setSelected(ev.id)}
                className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded transition-colors ${
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRun(ev.id);
                  }}
                  disabled={running}
                  className="px-3 py-1 bg-accent text-bg rounded text-xs font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {running && selected === ev.id ? "Running…" : "Run"}
                </button>
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <div className="text-red text-xs mt-2 border-l-2 border-red pl-2">{error}</div>
        )}
      </div>

      {/* Detail pane for the selected eval */}
      <div className="flex-1 overflow-auto p-4">
        <h3 className="text-text font-medium mb-3">{selectedEval.name}</h3>

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

        {activeRun ? (
          <RunResult run={activeRun} />
        ) : (
          <div className="text-text-muted text-sm">
            No runs yet. Click <span className="text-text font-medium">Run</span> above to test this eval.
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
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
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

// RunResult is a compact version of the wizard's VerifyRunPane —
// kept self-contained in this file so the agent detail page doesn't
// have to import wizard internals.
function RunResult({ run }: { run: EvalRun }) {
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

      <details className="text-text-muted text-xs">
        <summary className="cursor-pointer hover:text-text">
          Trajectory ({run.trajectory.turns.length} turns)
        </summary>
        <div className="mt-2 flex flex-col gap-1.5 max-h-96 overflow-y-auto font-mono">
          {run.trajectory.turns.map((turn, i) => (
            <div key={i} className="text-xs border-l-2 border-border pl-2">
              <span className="text-accent">{turn.role.toUpperCase()}</span>
              {turn.content && (
                <span className="text-text ml-2 whitespace-pre-wrap">{turn.content}</span>
              )}
              {turn.tool_call && (
                <span className="text-text ml-2">
                  {turn.tool_call.app}.{turn.tool_call.tool}
                  {turn.tool_call.warning && (
                    <span className="text-amber ml-1">[{turn.tool_call.warning}]</span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
