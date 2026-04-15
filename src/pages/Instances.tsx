import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { instances, core, type Instance, type Status, type TelemetryEvent } from "../api";
import { useProjects } from "../hooks/useProjects";
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

// Instances is the fleet-list view: all instances in the current project,
// with status + quick lifecycle actions + a create form. Clicking a row
// navigates to /instances/:id which renders the full InstanceView.
export function Instances() {
  const { currentProject } = useProjects();
  const projectId = currentProject?.id;

  const [list, setList] = useState<Instance[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [directive, setDirective] = useState("");
  const [includeAptevaServer, setIncludeAptevaServer] = useState(true);
  const [includeChannels, setIncludeChannels] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Per-instance live thread count, keyed by instance id. Updated every
  // poll from core.status so the list reflects how active each instance is
  // without needing full thread data.
  const [liveStatus, setLiveStatus] = useState<Record<number, { threads: number; iter: number; rate: string } | null>>({});

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
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");

  const load = () => {
    instances
      .list(projectId)
      .then((items) => {
        setList(items || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };

  useEffect(() => {
    if (!projectId) return;
    setList([]);
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
      });
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [list]);

  // ── Live activity SSE — single connection, all running instances ──
  //
  // Server multiplexes every running core's telemetry into one stream
  // filtered to the caller's instances. We keep a small per-instance
  // snapshot of the most recent thought, the active tool call, and the
  // latest iter/model. Each row's "live strip" reads from this map.
  //
  // Why one SSE instead of N: the dashboard's Instances page can show
  // 10+ instances. Opening 10 EventSources hammers the browser's
  // per-host connection limit (browsers cap ~6) and creates 10 separate
  // ping/heartbeat loops on the server. One stream, server-side fan-out,
  // bounded by the user's instance set. Same idea as the per-instance
  // ChatPanel SSE but scoped to the list view.
  //
  // Reset state on project switch — instances from project A shouldn't
  // bleed into project B's activity map.
  const seenStreamEventsRef = useRef<Set<string>>(new Set());
  const seenStreamOrderRef = useRef<string[]>([]);
  useEffect(() => {
    if (!projectId) return;
    setLiveActivity({});
    seenStreamEventsRef.current = new Set();
    seenStreamOrderRef.current = [];

    const url = `/api/telemetry/stream?all=1&project_id=${encodeURIComponent(projectId)}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const event: TelemetryEvent = JSON.parse(e.data);

        // Dedup by event.id — same as ChatPanel/InstanceView. The
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
              "channels_respond", "channels_status", "channels_ask",
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
      } catch {
        // Ignore parse errors — heartbeat comments arrive as comment
        // frames and never reach onmessage anyway, so this only fires
        // on genuinely malformed payloads.
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects with backoff; don't tear down.
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
      await instances.create(name.trim(), directive.trim(), "autonomous", projectId, false, {
        includeAptevaServer,
        includeChannels,
      });
      setName("");
      setDirective("");
      setIncludeAptevaServer(true);
      setIncludeChannels(true);
      setShowCreate(false);
      load();
    } catch (err: any) {
      setError(err?.message || "Failed to create instance");
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

  const startRename = (inst: Instance) => {
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
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-accent text-bg rounded-lg font-bold text-sm hover:bg-accent-hover transition-colors"
        >
          + New Agent
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {list.length === 0 && (
          <div className="text-text-muted text-sm">No agents. Click + New Agent.</div>
        )}

        <div className="space-y-2">
          {list.map((inst) => {
            const live = liveStatus[inst.id];
            const isRunning = inst.status === "running";
            return (
              <div
                key={inst.id}
                className="border border-border rounded-lg bg-bg-card hover:border-accent transition-colors overflow-hidden"
              >
                <Link
                  to={`/instances/${inst.id}`}
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
                          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${
                            inst.mode === "autonomous"
                              ? "bg-accent/20 text-accent"
                              : "bg-bg-hover text-text-muted"
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
                            <span>{live.rate}</span>
                          </>
                        ) : isRunning ? (
                          <span className="opacity-50">…</span>
                        ) : (
                          <span className="opacity-50">stopped</span>
                        )}
                      </div>
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

      {/* Create-agent modal. Lives at the page root so the backdrop
          covers the full viewport regardless of which list row the
          user was viewing when they clicked + New Agent. */}
      <Modal open={showCreate} onClose={() => { setShowCreate(false); setError(""); }}>
        <form onSubmit={handleCreate} className="p-6 w-[520px] max-w-full space-y-4">
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
            <label className="block text-text-muted text-sm mb-2">System MCPs</label>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAptevaServer}
                  onChange={(e) => setIncludeAptevaServer(e.target.checked)}
                  className="accent-accent mt-0.5"
                />
                <div>
                  <div className="text-text text-sm">apteva-server</div>
                  <div className="text-text-dim text-xs leading-snug">
                    Built-in gateway exposing integrations, connections, subscriptions,
                    telemetry, and thread-spawning to the agent. Uncheck for a lean
                    sandbox agent that only sees MCPs you wire up yourself.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeChannels}
                  onChange={(e) => setIncludeChannels(e.target.checked)}
                  className="accent-accent mt-0.5"
                />
                <div>
                  <div className="text-text text-sm">channels</div>
                  <div className="text-text-dim text-xs leading-snug">
                    Provides channels_respond / channels_ask / channels_status tools
                    for talking to the user via the dashboard chat, CLI, Telegram, etc.
                    Uncheck if the agent will communicate another way.
                  </div>
                </div>
              </label>
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
