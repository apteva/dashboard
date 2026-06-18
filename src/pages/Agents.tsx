import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { instances, core, subscriptions, type Agent, type RunMode, type Status, type SubscriptionInfo, type TelemetryEvent } from "../api";
import { useProjects } from "../hooks/useProjects";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";
import { usePageTitle } from "../hooks/usePageTitle";
import { Modal } from "../components/Modal";

// Per-instance live activity snapshot built from the all-instances SSE
// stream. We keep just enough to render the row strip — the latest
// thought line, the latest tool invocation (with done state), the most
// recent llm.done iter/cost, and a "lastEventAt" timestamp so the UI
// can mark instances as quiet after a few seconds of silence.
interface LiveActivity {
  lastThought?: string;
  lastThoughtAt?: number;
  // The most recent visible tool call, kept around after completion so the
  // row strip shows "what just happened" rather than going blank. `toolDone`
  // flips from false → true on tool.result so the chip can switch from a
  // spinner to a checkmark, but the label stays visible until either a
  // newer tool call replaces it or the 30s row-expiry kicks in.
  activeTool?: string;
  activeToolReason?: string;  // free-text "why" the agent supplied at call time
  activeToolAt?: number;
  toolDone?: boolean;
  lastIter?: number;
  lastModel?: string;
  lastEventAt: number;
  threadCount: number;
}

// Agents is the fleet-list view: all instances in the current project,
// with status + quick lifecycle actions + a create form. Clicking a row
// navigates to /instances/:id which renders the full AgentView.
export function Agents() {
  usePageTitle("Agents");

  const { currentProject } = useProjects();
  const projectId = currentProject?.id;
  const navigate = useNavigate();

  const [list, setList] = useState<Agent[]>([]);
  const [agentSubscriptions, setAgentSubscriptions] = useState<Record<number, SubscriptionInfo[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [directive, setDirective] = useState("");
  // Default new instances to "learn" — safest default for a fresh agent:
  // it asks before every new kind of action and remembers answers, so
  // users building their first agent can watch it ask rather than act.
  // Can be changed to cautious/autonomous before create, or later in
  // AgentView / the ActivityPanel header toggle.
  const [createMode, setCreateMode] = useState<RunMode>("learn");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Per-instance live thread count, keyed by instance id. Updated every
  // poll from core.status so the list reflects how active each instance is
  // without needing full thread data.
  const [liveStatus, setLiveStatus] = useState<Record<number, { threads: number; iter: number; rate: string } | null>>({});
  // Per-instance list of sub-threads (excluding "main") so the card can
  // show what's actually running — id + pace + iter. Refreshed on the
  // same 5s cadence as status. Empty array = no sub-threads.
  const [subThreads, setSubThreads] = useState<Record<number, Array<{ id: string; rate: string; iter: number; mcpNames: string[] }>>>({});
  // Per-instance MCP names attached to main (native access, not
  // catalog-only). Sourced from core /threads where the "main" row
  // carries its own mcp_names. Catalog-only MCPs show up on
  // individual sub-thread rows instead, so we don't double-count.
  const [mainMCPs, setMainMCPs] = useState<Record<number, string[]>>({});

  // Live activity strip — driven by the all-instances SSE stream below.
  // Single connection, server-side fan-out, so the page scales to many
  // instances without N concurrent EventSources. Keyed by instance id.
  const [liveActivity, setLiveActivity] = useState<Record<number, LiveActivity>>({});
  // Force a 1Hz re-render so the "Xs ago" badges update without an event.
  const [, tickRender] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tickRender((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Inline-rename state. Only one row is editable at a time; null means
  // no row is in edit mode. We store the draft separately so canceling
  // restores the original without an extra fetch.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  // Quick-edit modal state. editTarget = the agent being edited; null
  // = modal closed. We deliberately keep this separate from the
  // legacy inline-rename so a rename in progress (renamingId) and the
  // modal don't compete for the same row's name field.
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [editName, setEditName] = useState("");
  const [editDirective, setEditDirective] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const openEditModal = (inst: Agent) => {
    setEditTarget(inst);
    setEditName(inst.name);
    setEditDirective(inst.directive || "");
    setEditError("");
  };
  const closeEditModal = () => {
    setEditTarget(null);
    setEditName("");
    setEditDirective("");
    setEditError("");
    setEditSaving(false);
  };
  const saveEdit = async () => {
    if (!editTarget) return;
    const trimmedName = editName.trim();
    const trimmedDirective = editDirective.trim();
    if (!trimmedName) { setEditError("Name cannot be empty"); return; }
    setEditSaving(true);
    setEditError("");
    try {
      // Two independent endpoints — name via /agents/:id, directive
      // via /agents/:id/config — fire only the ones that actually
      // changed to avoid spurious history rows on the directive
      // audit trail.
      const nameChanged = trimmedName !== editTarget.name;
      const directiveChanged = trimmedDirective !== (editTarget.directive || "").trim();
      if (nameChanged) await instances.rename(editTarget.id, trimmedName);
      if (directiveChanged) await instances.updateConfig(editTarget.id, { directive: trimmedDirective });
      closeEditModal();
      load();
    } catch (err: any) {
      setEditError(err?.message || "Save failed");
      setEditSaving(false);
    }
  };
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");

  // load() is also called by imperative callsites below (rename
  // commit, start/stop, delete) where the response is the user's
  // intent and no cancellation is needed. The polling effect uses a
  // ref-tracked generation so its async responses don't write into a
  // newer project's state — see the effect below.
  const loadGen = useRef(0);
  const load = () => {
    const myGen = loadGen.current;
    Promise.all([
      instances.list(projectId),
      subscriptions.list(projectId).catch(() => [] as SubscriptionInfo[]),
    ])
      .then(([items, subs]) => {
        // Drop the response if a new project was selected (or the
        // component unmounted) since this fetch fired.
        if (myGen !== loadGen.current) return;
        setList(items || []);
        setAgentSubscriptions(groupSubscriptionsByAgent(subs || []));
        setLoaded(true);
      })
      .catch(() => {
        if (myGen !== loadGen.current) return;
        setLoaded(true);
      });
  };

  useEffect(() => {
    if (!projectId) return;
    // Bump the generation so any in-flight load() from the previous
    // projectId stops writing state.
    loadGen.current += 1;
    setList([]);
    setAgentSubscriptions({});
    setLoaded(false);
    setLiveStatus({});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Poll core status for running instances so the list shows live activity.
  // The status endpoint gives us thread count + iter + pace, which the SSE
  // stream alone wouldn't reveal until a new event landed. We keep this as
  // a 5-second backstop; the SSE handler below overlays sub-second updates
  // on top whenever the cores are actively working.
  useEffect(() => {
    if (list.length === 0) return;
    const refresh = () => {
      list.forEach((inst) => {
        if (inst.status !== "running") {
          setLiveStatus((prev) => ({ ...prev, [inst.id]: null }));
          // DO fetch threads + MCPs for stopped instances — the server
          // falls back to config.json on disk via serveStoppedInstanceData,
          // so the card can still show persisted sub-threads, attached
          // MCPs, and directive even without a live core. Only the
          // live /status (iter/rate) is absent; we handle that via the
          // null liveStatus above, which renders as "stopped".
          core
            .threads(inst.id)
            .then((threads) => {
              const subs = (threads || [])
                .filter((t) => t.id !== "main")
                .map((t) => ({
                  id: t.id,
                  rate: "stopped",
                  iter: 0,
                  mcpNames: t.mcp_names || [],
                }));
              setSubThreads((prev) => ({ ...prev, [inst.id]: subs }));
              const main = (threads || []).find((t) => t.id === "main");
              setMainMCPs((prev) => ({
                ...prev,
                [inst.id]: (main && main.mcp_names) || [],
              }));
            })
            .catch(() => {
              setSubThreads((prev) => ({ ...prev, [inst.id]: [] }));
              setMainMCPs((prev) => ({ ...prev, [inst.id]: [] }));
            });
          return;
        }
        core
          .status(inst.id)
          .then((s: Status) => {
            setLiveStatus((prev) => ({
              ...prev,
              [inst.id]: { threads: s.threads, iter: s.iteration, rate: s.rate },
            }));
          })
          .catch(() => {});
        // Thread list — only if status says there are sub-threads, else
        // skip the extra request to keep the list scan cheap. Filter out
        // "main" since it's already surfaced via liveStatus.
        core
          .threads(inst.id)
          .then((threads) => {
            const subs = (threads || [])
              .filter((t) => t.id !== "main")
              .map((t) => ({
                id: t.id,
                rate: t.rate,
                iter: t.iteration,
                mcpNames: t.mcp_names || [],
              }));
            setSubThreads((prev) => ({ ...prev, [inst.id]: subs }));
            const main = (threads || []).find((t) => t.id === "main");
            setMainMCPs((prev) => ({
              ...prev,
              [inst.id]: (main && main.mcp_names) || [],
            }));
          })
          .catch(() => {});
      });
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [list]);

  // ── Live activity — fed by the project-wide telemetry bus ──
  //
  // Pre-bus we opened our own EventSource against
  // /api/telemetry/stream?all=1 here. That worked, but every page in
  // the dashboard that wanted telemetry (ActivityFeed, AgentView,
  // ChatPanel for "thinking…") opened its own SSE — three or four
  // connections against the same data, eating into the browser's
  // HTTP/1.1 6-per-origin cap. The bus collapses every consumer onto
  // a single EventSource per project; we just keep dedup + the
  // per-instance snapshot logic that's specific to the fleet view.
  //
  // Reset state on project switch — instances from project A shouldn't
  // bleed into project B's activity map. The bus itself rebinds when
  // Layout calls setProjectId on the new project.
  const seenStreamEventsRef = useRef<Set<string>>(new Set());
  const seenStreamOrderRef = useRef<string[]>([]);
  useEffect(() => {
    setLiveActivity({});
    seenStreamEventsRef.current = new Set();
    seenStreamOrderRef.current = [];
  }, [projectId]);

  useTelemetryEvents(null, (event: TelemetryEvent) => {
    // Dedup by event.id — same as ChatPanel/AgentView. The
    // server stream is already de-duplicated server-side, but
    // StrictMode dev mounts and SSE auto-reconnects can replay
    // the same id and we'd double-count thread.spawn etc.
    if (event.id) {
      if (seenStreamEventsRef.current.has(event.id)) return;
      seenStreamEventsRef.current.add(event.id);
      seenStreamOrderRef.current.push(event.id);
      if (seenStreamOrderRef.current.length > 1000) {
        const old = seenStreamOrderRef.current.shift();
        if (old) seenStreamEventsRef.current.delete(old);
      }
    }

    const instId = event.instance_id;
    if (!instId) return;
    const data = event.data || {};
    const now = Date.now();

    setLiveActivity((prev) => {
      const cur: LiveActivity = prev[instId] || {
        lastEventAt: now,
        threadCount: 0,
      };
      const next: LiveActivity = { ...cur, lastEventAt: now };

      if (event.type === "llm.done") {
        // Most useful single event for the row strip — gives us
        // iter, model, and the final assistant text in one shot.
        if (typeof data.iteration === "number") next.lastIter = data.iteration;
        if (typeof data.model === "string") next.lastModel = data.model;
        if (typeof data.message === "string" && data.message.trim()) {
          next.lastThought = String(data.message).split("\n")[0].slice(0, 140);
          next.lastThoughtAt = now;
        }
        // The active tool from any in-progress tool.call is now
        // stale once the iteration finishes — clear it.
        next.activeTool = undefined;
        next.activeToolAt = undefined;
      }

      if (event.type === "tool.call" && data.name) {
        const name = String(data.name);
        // Hide internal housekeeping tools from the strip; users
        // care about real work, not pace/done/evolve/remember.
        const hidden = new Set([
          "pace", "done", "evolve", "remember", "send",
          "channels_respond", "channels_status",
        ]);
        if (!hidden.has(name)) {
          next.activeTool = name;
          // Capture the free-text reason the agent passed via _reason
          // so the row strip can show "Fetching spreadsheet metadata"
          // instead of the raw "google-sheets_get_spreadsheet" slug.
          next.activeToolReason =
            typeof data.reason === "string" ? data.reason : undefined;
          next.activeToolAt = now;
          next.toolDone = false;
        }
      }

      if (event.type === "tool.result" && data.name) {
        // DO NOT clear the tool here. We want the row strip to keep
        // showing the reason after the call completes — the user
        // wants "what just happened" to stay visible, not flash and
        // disappear. We only flip the toolDone flag so the chip
        // switches from spinner to checkmark. The 30-second row
        // expiry below handles eventual cleanup, and the next tool
        // call overwrites this entry.
        if (next.activeTool === String(data.name)) {
          next.toolDone = true;
        }
      }

      if (event.type === "thread.spawn") next.threadCount = (cur.threadCount || 0) + 1;
      if (event.type === "thread.done") {
        next.threadCount = Math.max(0, (cur.threadCount || 0) - 1);
      }

      return { ...prev, [instId]: next };
    });
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setCreating(true);
    try {
      // Create without auto-starting. The user can click Start on the row
      // (or on the instance page) when they want it running. Avoids having
      // a fresh instance consume tokens before the user has had a chance
      // to configure directive / MCPs / channels.
      await instances.create(name.trim(), directive.trim(), createMode, projectId, false, {
        includeAptevaServer: false,
        includeChannels: true,
      });
      setName("");
      setDirective("");
      setCreateMode("learn");
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to create agent");
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (id: number) => {
    try {
      await instances.start(id);
      load();
    } catch {}
  };

  const handleStop = async (id: number) => {
    try {
      await instances.stop(id);
      load();
    } catch {}
  };

  const startRename = (inst: Agent) => {
    setRenamingId(inst.id);
    setRenameDraft(inst.name);
    setRenameError("");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
    setRenameError("");
  };

  const commitRename = async (id: number) => {
    const next = renameDraft.trim();
    if (!next) {
      setRenameError("Name cannot be empty");
      return;
    }
    // Optimistically update the row in-place so the UI doesn't flicker
    // back to the old name while the request is in flight.
    setList((prev) => prev.map((i) => (i.id === id ? { ...i, name: next } : i)));
    setRenamingId(null);
    try {
      await instances.rename(id, next);
      load();
    } catch (err: any) {
      setRenameError(err?.message || "Rename failed");
      load();
    }
  };

  if (!loaded) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-text text-lg font-bold">Agents</h1>
          <p className="text-text-muted text-sm mt-1">
            {list.length === 0
              ? "No agents yet. Create one to get started."
              : `${list.length} agent${list.length === 1 ? "" : "s"} in this project.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-2 border border-border rounded-lg text-text-muted text-xs hover:text-text hover:border-text-dim transition-colors"
            title="Open the classic create form — single dialog with all fields"
          >
            Quick create
          </button>
          <button
            onClick={() => navigate("/agents/new")}
            className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
          >
            + New Agent
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {list.length === 0 && (
          <div className="text-text-muted text-sm">
            No agents yet.{" "}
            <button
              onClick={() => navigate("/agents/new")}
              className="text-accent underline-offset-2 hover:underline"
            >
              Build your first agent →
            </button>
          </div>
        )}

        <div className="space-y-2">
          {list.map((inst) => {
            const live = liveStatus[inst.id];
            const isRunning = inst.status === "running";
            const pointingSubscriptions = agentSubscriptions[inst.id] || [];
            return (
              <div
                key={inst.id}
                className="border border-border rounded-lg bg-bg-card hover:border-accent transition-colors overflow-hidden"
              >
                <Link
                  to={`/agents/${inst.id}`}
                  // Stable card height: reserve a minimum so rows don't
                  // jump when the live activity strip appears/disappears
                  // or when the directive line wraps to a second row.
                  // 7rem ≈ name + stats + 1-line directive + activity slot.
                  className="block px-5 py-4 min-h-[7rem]"
                  // Block the navigation Link from firing while the row is
                  // in rename mode — otherwise clicking inside the input
                  // would bubble up to the Link and load the instance page.
                  onClick={(e) => {
                    if (renamingId === inst.id) e.preventDefault();
                  }}
                >
                  {/* items-start keeps the status dot pinned to the top of
                      the row instead of re-centering vertically as content
                      below grows — that's what made the dot look like it
                      was "moving" between live updates. */}
                  <div className="flex items-start gap-3">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 mt-2 ${
                        isRunning ? "bg-green" : "bg-red"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        {renamingId === inst.id ? (
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitRename(inst.id);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              maxLength={100}
                              className="bg-bg-input border border-accent rounded px-2 py-0.5 text-sm text-text font-bold focus:outline-none flex-1 min-w-0"
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                commitRename(inst.id);
                              }}
                              className="text-[10px] text-accent hover:text-accent-hover px-1 shrink-0"
                            >
                              save
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                cancelRename();
                              }}
                              className="text-[10px] text-text-muted hover:text-text px-1 shrink-0"
                            >
                              cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-text text-base font-bold truncate">{inst.name}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startRename(inst);
                              }}
                              title="Rename"
                              className="text-text-dim hover:text-accent text-xs transition-colors shrink-0"
                            >
                              ✎
                            </button>
                          </>
                        )}
                        <span className="text-text-dim text-xs">#{inst.id}</span>
                        <span
                          title={
                            inst.mode === "learn"
                              ? "learn — asks before every new kind of action, remembers answers"
                              : inst.mode === "cautious"
                                ? "cautious — asks before state-changing actions"
                                : "autonomous — acts independently"
                          }
                          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${
                            inst.mode === "learn"
                              ? "bg-green/20 text-green"
                              : inst.mode === "cautious"
                                ? "bg-blue/20 text-blue"
                                : "bg-accent/20 text-accent"
                          }`}
                        >
                          {inst.mode}
                        </span>
                      </div>
                      {renamingId === inst.id && renameError && (
                        <p className="text-red text-[10px] mt-1">{renameError}</p>
                      )}
                      {/* Directive slot — fixed two-line height even when
                          empty, so the row body doesn't shrink for
                          undirected instances. */}
                      <p className="text-text-muted text-xs mt-1 line-clamp-2 min-h-[2rem]">
                        {inst.directive || <span className="text-text-dim">No directive</span>}
                      </p>
                      {/* Stats slot — always rendered with reserved
                          height. While polling hasn't landed (or the
                          instance isn't running) we show dim placeholders
                          so the row keeps its size. */}
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-text-dim min-h-[14px]">
                        {live ? (
                          <>
                            <span>{live.threads} threads</span>
                            <span>#{live.iter}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              live.rate === "reactive" ? "bg-green/15 text-green" :
                              live.rate === "fast" ? "bg-accent/15 text-accent" :
                              live.rate === "normal" ? "bg-blue/15 text-blue" :
                              live.rate === "slow" ? "bg-border text-text-muted" :
                              live.rate === "sleep" ? "bg-red/10 text-red/70" :
                              "bg-border text-text-muted"
                            }`}>{live.rate}</span>
                          </>
                        ) : isRunning ? (
                          <span className="opacity-50">…</span>
                        ) : (
                          <span className="opacity-50">stopped</span>
                        )}
                      </div>
                      {pointingSubscriptions.length > 0 && (
                        <div className="flex items-center flex-wrap gap-1 mt-1.5">
                          <span className="text-[10px] text-text-dim">subs:</span>
                          {pointingSubscriptions.slice(0, 3).map((sub) => (
                            <span
                              key={sub.id}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] max-w-[13rem] ${
                                sub.enabled
                                  ? "bg-green/10 text-green"
                                  : "bg-border text-text-muted"
                              }`}
                              title={subscriptionTitle(sub)}
                            >
                              <span className="truncate">{subscriptionLabel(sub)}</span>
                              {sub.thread_id && sub.thread_id !== "main" && (
                                <span className="opacity-70 font-mono">#{sub.thread_id}</span>
                              )}
                            </span>
                          ))}
                          {pointingSubscriptions.length > 3 && (
                            <span
                              className="text-[10px] text-text-dim px-1.5 py-0.5"
                              title={pointingSubscriptions.slice(3).map(subscriptionTitle).join("\n")}
                            >
                              +{pointingSubscriptions.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                      {/* Attached MCP servers for this agent. The
                          main/catalog split is gone post-discovery
                          refactor — every attached MCP is reachable
                          via search_tools and the directive-fed
                          preload; what shows here is the full
                          attached surface, irrespective of which
                          tools are active on any given turn. */}
                      {(mainMCPs[inst.id] || []).length > 0 && (
                        <div className="flex items-center flex-wrap gap-1 mt-1.5">
                          <span className="text-[10px] text-text-dim">mcp:</span>
                          {(mainMCPs[inst.id] || []).map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent font-mono"
                              title={`main has direct access to ${m}`}
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Sub-agents — one pill per child thread with its
                          pace. Collapses to "+N more" past a small
                          display cap so a noisy parent doesn't blow up
                          the row height. */}
                      {(() => {
                        const subs = subThreads[inst.id] || [];
                        if (subs.length === 0) return null;
                        const cap = 4;
                        const shown = subs.slice(0, cap);
                        const extra = subs.length - shown.length;
                        return (
                          <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                            {shown.map((s) => {
                              const mcps = s.mcpNames || [];
                              const title = mcps.length
                                ? `${s.id} · iter #${s.iter} · pace ${s.rate} · mcp: ${mcps.join(", ")}`
                                : `${s.id} · iter #${s.iter} · pace ${s.rate}`;
                              return (
                                <span
                                  key={s.id}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                                    s.rate === "reactive" ? "bg-green/15 text-green" :
                                    s.rate === "fast" ? "bg-accent/15 text-accent" :
                                    s.rate === "normal" ? "bg-blue/15 text-blue" :
                                    s.rate === "slow" ? "bg-border text-text-muted" :
                                    s.rate === "sleep" ? "bg-red/10 text-red/70" :
                                    "bg-border text-text-muted"
                                  }`}
                                  title={title}
                                >
                                  <span className="font-mono">{s.id}</span>
                                  <span className="opacity-60">#{s.iter}</span>
                                  {mcps.length > 0 && (
                                    <span className="opacity-70">· {mcps.join("+")}</span>
                                  )}
                                </span>
                              );
                            })}
                            {extra > 0 && (
                              <span className="text-[10px] text-text-dim px-1.5 py-0.5">
                                +{extra} more
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      {/* Live activity strip — shows the current thought
                          or active tool from the all-instances SSE stream.
                          Always reserves a fixed slot so the row never
                          jumps when activity appears/disappears. */}
                      <div className="mt-2 flex items-start gap-2 text-[10px] min-w-0 min-h-[14px]">
                        {(() => {
                          const act = liveActivity[inst.id];
                          if (!isRunning || !act) return null;
                          const now = Date.now();
                          const ageMs = now - act.lastEventAt;
                          // Keep the strip visible for 2 minutes after the
                          // last activity. Long enough for the user to see
                          // "what just happened" when they switch tabs and
                          // come back, short enough that idle rows go quiet.
                          if (ageMs > 120000) return null;
                          const ageLabel =
                            ageMs < 1000
                              ? "now"
                              : ageMs < 60000
                                ? `${Math.floor(ageMs / 1000)}s ago`
                                : `${Math.floor(ageMs / 60000)}m ago`;
                          if (act.activeTool) {
                            // Prefer the free-text reason ("Fetching
                            // spreadsheet metadata") over the raw slug
                            // ("google-sheets_get_spreadsheet"). The
                            // slug stays in the title attribute so
                            // power users can hover to confirm which
                            // tool fired.
                            const label = act.activeToolReason || act.activeTool;
                            const done = act.toolDone;
                            return (
                              <>
                                <span
                                  className={`shrink-0 ${done ? "text-green" : "text-accent tool-active-line"}`}
                                  title={act.activeTool}
                                >
                                  {done ? "✓" : "⟳"}
                                </span>
                                <span
                                  className="text-text-muted truncate flex-1 min-w-0"
                                  title={act.activeTool}
                                >
                                  {label}
                                </span>
                                <span className="text-text-dim shrink-0">{ageLabel}</span>
                              </>
                            );
                          }
                          if (act.lastThought) {
                            return (
                              <>
                                <span className="text-accent shrink-0">›</span>
                                <span className="text-text-muted truncate flex-1 min-w-0">
                                  {act.lastThought}
                                </span>
                                <span className="text-text-dim shrink-0">{ageLabel}</span>
                              </>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Quick-edit affordance — opens a modal to tweak
                          name + directive without leaving the fleet view.
                          stopPropagation prevents the surrounding <Link>
                          from navigating into the agent detail page. */}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openEditModal(inst);
                        }}
                        className="px-3 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-text hover:border-text transition-colors"
                        title="Edit name + directive"
                      >
                        Edit
                      </button>
                      {isRunning ? (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStop(inst.id);
                          }}
                          className="px-3 py-1 border border-border rounded-lg text-xs text-text-muted hover:text-red hover:border-red transition-colors"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleStart(inst.id);
                          }}
                          className="px-3 py-1 border border-accent rounded-lg text-xs text-accent hover:bg-accent hover:text-bg transition-colors"
                        >
                          Start
                        </button>
                      )}
                      <span className="text-text-dim text-xs">→</span>
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick-edit modal — name + directive only. Lives at page root
          so it overlays cleanly regardless of which row triggered it.
          For deeper config (mode, providers, MCP wiring, evals)
          operators still go through the agent detail page. */}
      <Modal open={!!editTarget} onClose={closeEditModal}>
        {editTarget && (
          <form
            onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
            className="p-4 sm:p-6 w-full max-w-[560px] space-y-4"
          >
            <div>
              <h2 className="text-text text-base font-bold">Edit agent</h2>
              <p className="text-text-muted text-xs mt-1">
                Quick edits — name + directive. For mode, providers,
                MCPs, evals, open the agent's detail page.
              </p>
            </div>
            <div>
              <label className="block text-text-muted text-sm mb-2">Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-text-muted text-sm mb-2">
                Directive
                <span className="text-text-dim text-xs ml-2 font-normal">
                  (the system prompt the agent reads at every think)
                </span>
              </label>
              <textarea
                value={editDirective}
                onChange={(e) => setEditDirective(e.target.value)}
                rows={10}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono resize-y focus:outline-none focus:border-accent"
                placeholder="What this agent should do, in plain prose."
              />
              <p className="text-text-dim text-xs mt-1">
                Saving updates the running core in place. Any open chat
                thread inherits this directive plus its own persona suffix
                on next spawn.
              </p>
            </div>
            {editError && (
              <div className="text-red text-xs bg-red/10 border border-red/30 rounded px-3 py-2">
                {editError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={editSaving}
                className="px-4 py-2 border border-border rounded-lg text-text-muted hover:text-text transition-colors text-sm disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving || !editName.trim()}
                className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Create-agent modal. Lives at the page root so the backdrop
          covers the full viewport regardless of which list row the
          user was viewing when they clicked + New Agent. */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setError(""); }}>
        <form onSubmit={handleCreate} className="p-4 sm:p-6 w-full max-w-[520px] space-y-4">
          <h2 className="text-text text-base font-bold">Create agent</h2>
          <div>
            <label className="block text-text-muted text-sm mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="supervisor"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Directive (optional)</label>
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent resize-none h-24"
              placeholder="What should this agent think about?"
            />
          </div>
          <div>
            <label className="block text-text-muted text-sm mb-2">Safety mode</label>
            <div className="flex gap-2">
              {(["learn", "cautious", "autonomous"] as RunMode[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setCreateMode(m)}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border capitalize transition-colors ${
                    createMode === m
                      ? "border-accent text-accent bg-accent/10"
                      : "border-border text-text-muted hover:border-accent"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="text-text-dim text-xs leading-snug mt-2">
              {createMode === "learn" &&
                "Asks before every new kind of action and remembers your answers. Best for first-time setup."}
              {createMode === "cautious" &&
                "Asks before any state-changing action (exec, write, delete, external send). Read-only tools are free."}
              {createMode === "autonomous" &&
                "Acts independently. Only informs you before irreversible or high-blast-radius actions."}
            </div>
          </div>
          {error && <div className="text-red text-sm">{error}</div>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setError(""); }}
              className="px-5 py-2.5 border border-border rounded-lg text-sm text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2.5 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function groupSubscriptionsByAgent(subs: SubscriptionInfo[]): Record<number, SubscriptionInfo[]> {
  const grouped: Record<number, SubscriptionInfo[]> = {};
  for (const sub of subs) {
    const id = Number(sub.instance_id || 0);
    if (!id) continue;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(sub);
  }
  for (const id of Object.keys(grouped)) {
    grouped[Number(id)].sort((a, b) => subscriptionLabel(a).localeCompare(subscriptionLabel(b)));
  }
  return grouped;
}

function subscriptionLabel(sub: SubscriptionInfo): string {
  const name = (sub.name || "").trim();
  if (name) return name;
  const firstEvent = (sub.events || []).find(Boolean);
  if (firstEvent) return firstEvent;
  const slug = (sub.slug || "").trim();
  if (slug) return slug.replace(":", ".");
  return sub.source === "app_event" ? "app event" : "webhook";
}

function subscriptionTitle(sub: SubscriptionInfo): string {
  const parts = [
    subscriptionLabel(sub),
    sub.enabled ? "enabled" : "disabled",
    sub.source ? `source: ${sub.source}` : "",
    sub.thread_id ? `thread: ${sub.thread_id}` : "thread: main",
    (sub.events || []).length > 0 ? `events: ${(sub.events || []).join(", ")}` : "",
    sub.slug ? `slug: ${sub.slug}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}
