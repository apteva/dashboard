import { useEffect, useMemo, useState } from "react";
import { core, instances as instancesAPI, telemetry, type BackgroundMemoryState, type Thread, type TelemetryEvent } from "../api";

// UnconsciousPanel — operator-visible window into the agent's
// background memory-consolidation thread (see core/thinker.go
// unconsciousDirectiveV2). Derives everything from generic API
// endpoints plus the narrow background-memory setting surface:
//
//   * GET /agents/:id/threads — find the row whose id === "unconscious".
//     The thread row already carries iteration, rate (the unconscious's
//     chosen pace), age, directive. No extra server endpoint needed.
//
//   * GET /telemetry?agent_id=:id&thread_id=unconscious&limit=200 —
//     all of the thread's emitted events. We slice it three ways:
//       a) Recent activity log (last N tool calls, chronological).
//       b) Last-cycle stats — between the two most recent `pace`
//          calls, count memory_remember / memory_supersede /
//          memory_drop and tally them.
//       c) 24h totals — pace calls (= cycles), writes, force-wakes
//          (an `event.received` whose data.text starts with "[wake]").
//
// Polls every 5s. Threads, telemetry, and the narrow persisted setting are
// fetched together; telemetry is indexed on (agent_id, thread_id).

interface Props {
  instanceId: number;
  compact?: boolean;
  onAgentReload?: () => void;
}

interface CycleStats {
  iterations: number;
  remembers: number;
  supersedes: number;
  drops: number;
  reviews: number;
  searches: number;
}

interface DerivedState {
  enabled: boolean;             // true when a thread with id=unconscious exists
  thread: Thread | null;        // raw thread row
  lastEventAt: string | null;   // most recent telemetry time
  lastWakeReason: string | null; // text from the most recent [wake] event, if any
  lastCycle: CycleStats;        // between the two most recent pace calls
  totals24h: {
    cycles: number;             // count of pace calls
    writes: number;             // remember + supersede + drop
    forceWakes: number;         // event.received starting with [wake]
  };
  recent: TelemetryEvent[];     // chronological, last 30 tool.calls
}

const ZERO_CYCLE: CycleStats = {
  iterations: 0,
  remembers: 0,
  supersedes: 0,
  drops: 0,
  reviews: 0,
  searches: 0,
};

// derive walks the telemetry list (most-recent-first per the server's
// SELECT … ORDER BY time DESC) and computes everything we need to
// render without re-walking the array per field.
function derive(thread: Thread | null, events: TelemetryEvent[]): DerivedState {
  const recentToolCalls: TelemetryEvent[] = [];
  const totals = { cycles: 0, writes: 0, forceWakes: 0 };
  let lastEventAt: string | null = null;

  // The server returns DESC by time. Walk it once and bucket.
  // For lastCycle, we need the SPAN between pace calls — the most
  // recent pace closes a cycle, so we count writes between it and
  // the previous pace (or the start of the events array if there's
  // only one).
  let pacesSeen = 0;
  const lastCycle: CycleStats = { ...ZERO_CYCLE };
  let lastWakeReason: string | null = null;
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  for (const ev of events) {
    if (!lastEventAt) lastEventAt = ev.time;

    const t = Date.parse(ev.time);
    const within24h = !Number.isNaN(t) && t >= oneDayAgo;

    // type-specific accounting.
    if (ev.type === "tool.call") {
      const name = String(ev.data?.name ?? "");
      // Recent-activity log (cap at 30 entries to keep the UI tight).
      if (recentToolCalls.length < 30) recentToolCalls.push(ev);

      if (within24h) {
        switch (name) {
          case "pace":           totals.cycles++; break;
          case "memory_remember":
          case "memory_supersede":
          case "memory_drop":    totals.writes++; break;
        }
      }

      // Last-cycle slice — count between the two most recent pace
      // events. pacesSeen=0 → we're in the "still open" cycle past
      // the latest pace; pacesSeen=1 → between latest and previous,
      // i.e. the cycle the operator typically cares about. Past
      // that we stop accumulating.
      if (pacesSeen <= 1) {
        switch (name) {
          case "memory_remember":  lastCycle.remembers++; break;
          case "memory_supersede": lastCycle.supersedes++; break;
          case "memory_drop":      lastCycle.drops++; break;
          case "review_history":   lastCycle.reviews++; break;
          case "memory_search":    lastCycle.searches++; break;
        }
      }
      if (name === "pace") pacesSeen++;
    }

    if (ev.type === "llm.done" && pacesSeen <= 1) {
      lastCycle.iterations++;
    }

    if (ev.type === "event.received") {
      const text = String(ev.data?.text ?? "");
      if (text.startsWith("[wake]")) {
        if (lastWakeReason === null) {
          lastWakeReason = text.slice("[wake]".length).trim();
        }
        if (within24h) totals.forceWakes++;
      }
    }
  }

  // recent is currently most-recent-first; flip to chronological for
  // the operator-facing log.
  recentToolCalls.reverse();

  return {
    enabled: !!thread,
    thread,
    lastEventAt,
    lastWakeReason,
    lastCycle,
    totals24h: totals,
    recent: recentToolCalls,
  };
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

// toolColor — visual hint per tool kind. Writes (remember / supersede
// / drop) are accent so the operator scans for them; introspection
// (search / list / review_history) is muted; pace is its own colour
// to mark cycle boundaries.
function toolColor(name: string): string {
  switch (name) {
    case "memory_remember":  return "text-green";
    case "memory_supersede": return "text-accent";
    case "memory_drop":      return "text-red";
    case "pace":             return "text-blue";
    case "review_history":
    case "memory_search":
    case "memory_list":      return "text-text-muted";
    case "skill_write":      return "text-accent";
    default:                 return "text-text";
  }
}

export function UnconsciousPanel({ instanceId, compact = false, onAgentReload }: Props) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [setting, setSetting] = useState<BackgroundMemoryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingBusy, setSettingBusy] = useState(false);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  // Manual-wake UI. wakeReason holds the optional free-text reason
  // the operator typed; when waking is true the button is disabled +
  // shows a loading label. wakeError surfaces the upstream failure
  // text inline so a 4xx/5xx from /event doesn't disappear into the
  // console.
  const [wakeOpen, setWakeOpen] = useState(false);
  const [wakeReason, setWakeReason] = useState("");
  const [waking, setWaking] = useState(false);
  const [wakeError, setWakeError] = useState<string | null>(null);

  const reload = async () => {
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      setThread(null);
      setEvents([]);
      setError("agent_id required");
      setLoading(false);
      return;
    }
    try {
      const [threads, telem, backgroundMemory] = await Promise.all([
        core.threads(instanceId).catch(() => [] as Thread[]),
        telemetry.query(instanceId, undefined, 200, "unconscious").catch(() => [] as TelemetryEvent[]),
        instancesAPI.backgroundMemory.get(instanceId),
      ]);
      setThread(threads.find((t) => t.id === "unconscious") || null);
      setEvents(telem);
      setSetting(backgroundMemory);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "failed to load");
    } finally {
      setLoading(false);
    }
  };

  // wake — sends an EventInbox to the unconscious via the existing
  // /agents/:id/event endpoint with thread_id=unconscious. Reuses the
  // same `[wake] reason` shape the runtime's safety floors use, so the
  // unconscious's directive sees this as a normal wake trigger and
  // our telemetry-derived "last wake reason" picks it up automatically
  // (no separate field on the wire).
  const wake = async () => {
    setWaking(true);
    setWakeError(null);
    const reason = wakeReason.trim() || "manual nudge from operator";
    try {
      await instancesAPI.sendEvent(instanceId, `[wake] ${reason}`, "unconscious");
      setWakeOpen(false);
      setWakeReason("");
      // Pull fresh state immediately so the operator sees the cycle
      // start instead of waiting up to 5s for the poll tick.
      void reload();
    } catch (e: any) {
      setWakeError(e?.message || "wake failed");
    } finally {
      setWaking(false);
    }
  };

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [instanceId]);

  const state = useMemo(() => derive(thread, events), [thread, events]);
  const configured = setting?.enabled ?? state.enabled;

  const applySetting = async (enabled: boolean, restart: boolean) => {
    setSettingBusy(true);
    setSettingError(null);
    try {
      const next = await instancesAPI.backgroundMemory.set(instanceId, enabled, restart);
      setSetting(next);
      setPendingEnabled(null);
      await reload();
      onAgentReload?.();
    } catch (e: any) {
      setSettingError(e?.message || "background memory update failed");
    } finally {
      setSettingBusy(false);
    }
  };

  const requestSetting = (enabled: boolean) => {
    setSettingError(null);
    if (setting?.running) {
      setPendingEnabled(enabled);
      return;
    }
    void applySetting(enabled, false);
  };

  if (loading) {
    return <div className={compact ? "border-b border-border px-4 py-3 text-xs text-text-muted" : "p-4 text-xs text-text-muted"}>Loading…</div>;
  }
  if (error) {
    return <div className={compact ? "border-b border-border px-4 py-3 text-xs text-red" : "p-4 text-xs text-red"}>Error: {error}</div>;
  }
  const settingControl = (
    <button
      type="button"
      role="switch"
      aria-checked={configured}
      onClick={() => requestSetting(!configured)}
      disabled={settingBusy}
      className={`inline-flex h-7 items-center gap-2 rounded-full border px-2 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
        configured ? "border-green/40 bg-green/10 text-green" : "border-border bg-bg-hover text-text-muted"
      }`}
      title={configured ? "Disable background memory" : "Enable background memory"}
    >
      <span className={`h-2 w-2 rounded-full ${configured ? "bg-green" : "bg-text-dim"}`} />
      {settingBusy ? "Saving…" : configured ? "On" : "Off"}
    </button>
  );

  const restartPrompt = pendingEnabled != null && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-yellow/40 bg-yellow/5 px-3 py-2 text-xs">
      <span className="text-text-muted">Restart this agent to {pendingEnabled ? "enable" : "disable"} background memory.</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setPendingEnabled(null)} disabled={settingBusy} className="text-text-muted hover:text-text">Cancel</button>
        <button
          type="button"
          onClick={() => void applySetting(pendingEnabled, true)}
          disabled={settingBusy}
          className="rounded bg-accent px-2.5 py-1 font-semibold text-bg disabled:opacity-50"
        >
          {settingBusy ? "Restarting…" : `${pendingEnabled ? "Enable" : "Disable"} & restart`}
        </button>
      </div>
    </div>
  );

  if (!configured) {
    return (
      <div className={`${compact ? "border-b border-border px-4 py-3" : "p-4"} space-y-3 text-xs text-text-muted leading-relaxed`}>
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Background Memory</h2>
            <p className="mt-0.5">Off · this agent is currently stateless.</p>
          </div>
          {settingControl}
        </header>
        {restartPrompt}
        {settingError && <div className="text-red">{settingError}</div>}
      </div>
    );
  }

  if (!state.enabled) {
    return (
      <div className={`${compact ? "border-b border-border px-4 py-3" : "p-4"} space-y-3 text-xs text-text-muted leading-relaxed`}>
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Background Memory</h2>
            <p className="mt-0.5">
              {setting?.running ? "Enabled · consolidation thread is starting." : "Enabled · start the agent to run consolidation."}
            </p>
          </div>
          {settingControl}
        </header>
        {restartPrompt}
        {settingError && <div className="text-red">{settingError}</div>}
      </div>
    );
  }

  const wakeControl = (
    <div className="relative">
      <button
        onClick={() => {
          setWakeError(null);
          setWakeOpen((v) => !v);
        }}
        disabled={waking}
        className="px-3 py-1 text-xs border border-border rounded hover:bg-bg-hover hover:border-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Send a [wake] event to the background memory thread so it runs a consolidation cycle now"
      >
        {waking ? "Waking…" : "Wake up"}
      </button>
      {wakeOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 border border-border rounded bg-bg-card shadow-lg p-3 z-10">
          <label className="text-text-muted text-xs block mb-1">
            Reason (optional — surfaces in telemetry)
          </label>
          <input
            type="text"
            value={wakeReason}
            onChange={(e) => setWakeReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !waking) wake();
              if (e.key === "Escape") setWakeOpen(false);
            }}
            autoFocus
            placeholder="e.g. consolidating after dev session"
            className="w-full px-2 py-1 text-xs border border-border rounded bg-bg-base text-text focus:outline-none focus:border-accent"
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={() => setWakeOpen(false)}
              disabled={waking}
              className="text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={wake}
              disabled={waking}
              className="px-2 py-1 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors disabled:opacity-50"
            >
              {waking ? "Sending…" : "Send wake"}
            </button>
          </div>
          {wakeError && (
            <div className="text-red text-xs mt-2">{wakeError}</div>
          )}
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="border-b border-border px-4 py-3 space-y-3">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[10px] uppercase tracking-wide text-text-muted font-bold">Background Memory</h2>
            <div className="text-text-dim text-xs mt-0.5 truncate">
              consolidation thread · last activity {relTime(state.lastEventAt)}
            </div>
          </div>
          <div className="flex items-center gap-2">{settingControl}{wakeControl}</div>
        </header>
        {restartPrompt}
        {settingError && <div className="text-red text-xs">{settingError}</div>}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-text text-sm font-bold">// UNCONSCIOUS</h2>
          <span className="text-text-muted text-xs">memory-consolidation thread</span>
        </div>
        <div className="flex items-center gap-2">{settingControl}{wakeControl}</div>
      </header>
      {restartPrompt}
      {settingError && <div className="text-red text-xs">{settingError}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pace" value={state.thread?.rate || "—"} hint="self-set sleep interval" />
        <Stat label="Iterations" value={String(state.thread?.iteration ?? 0)} hint="since spawn" />
        <Stat label="Last activity" value={relTime(state.lastEventAt)} hint="any telemetry event" />
        <Stat label="Age" value={state.thread?.age || "—"} hint="time since spawn" />
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Cycles (24h)" value={String(state.totals24h.cycles)} hint="count of pace() calls" />
        <Stat label="Writes (24h)" value={String(state.totals24h.writes)} hint="remember + supersede + drop" />
        <Stat
          label="Force-wakes (24h)"
          value={String(state.totals24h.forceWakes)}
          hint="byte- or quiet-floor"
        />
      </section>

      <section className="border border-border rounded p-3">
        <div className="text-text-muted text-xs mb-2">Last cycle</div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-text-muted">iters</span>{" "}
            <span className="text-text font-bold">{state.lastCycle.iterations}</span>
          </div>
          <div>
            <span className="text-text-muted">remembers</span>{" "}
            <span className="text-green font-bold">{state.lastCycle.remembers}</span>
          </div>
          <div>
            <span className="text-text-muted">supersedes</span>{" "}
            <span className="text-accent font-bold">{state.lastCycle.supersedes}</span>
          </div>
          <div>
            <span className="text-text-muted">drops</span>{" "}
            <span className="text-red font-bold">{state.lastCycle.drops}</span>
          </div>
          <div>
            <span className="text-text-muted">reviews</span>{" "}
            <span className="text-text-muted font-bold">{state.lastCycle.reviews}</span>
          </div>
          <div>
            <span className="text-text-muted">searches</span>{" "}
            <span className="text-text-muted font-bold">{state.lastCycle.searches}</span>
          </div>
        </div>
        {state.lastWakeReason && (
          <div className="mt-3 text-xs text-text-muted">
            last wake reason: <span className="text-text">{state.lastWakeReason}</span>
          </div>
        )}
      </section>

      <section>
        <div className="text-text-muted text-xs mb-2">Recent tool calls</div>
        {state.recent.length === 0 ? (
          <div className="text-xs text-text-muted">No tool calls in the recent window.</div>
        ) : (
          <ol className="space-y-1 text-xs font-mono">
            {state.recent.map((ev) => {
              const name = String(ev.data?.name ?? "");
              const args = ev.data?.args && typeof ev.data.args === "object" ? ev.data.args : null;
              // Render a one-line summary — the operator can hover or
              // click into the row's details modal later if needed.
              return (
                <li key={ev.id} className="flex gap-3">
                  <span className="text-text-muted shrink-0 w-20">{relTime(ev.time)}</span>
                  <span className={`${toolColor(name)} shrink-0 w-32 truncate`} title={name}>
                    {name || ev.type}
                  </span>
                  {args && (
                    <span className="text-text-muted truncate" title={JSON.stringify(args)}>
                      {summarizeArgs(name, args)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  hint?: string;
}

function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="border border-border rounded p-3" title={hint}>
      <div className="text-text-muted text-xs">{label}</div>
      <div className="text-text text-base font-bold mt-1">{value}</div>
    </div>
  );
}

// summarizeArgs — pick the most useful bit of each tool's args to
// render inline. Keeps the activity log scannable instead of dumping
// the full JSON which would push lines off the panel.
function summarizeArgs(name: string, args: Record<string, any>): string {
  switch (name) {
    case "memory_remember":
      return truncate(String(args.content ?? args.text ?? ""), 80);
    case "memory_supersede":
      return `id=${args.id ?? "?"} → ${truncate(String(args.content ?? ""), 60)}`;
    case "memory_drop":
      return `id=${args.id ?? "?"} ${args.reason ? `(${truncate(String(args.reason), 50)})` : ""}`;
    case "memory_search":
      return truncate(String(args.query ?? args.q ?? ""), 80);
    case "pace":
      return `sleep=${args.sleep ?? args.rate ?? "?"}`;
    case "review_history":
      return args.limit ? `limit=${args.limit}` : "";
    case "skill_write":
      return truncate(String(args.title ?? args.slug ?? ""), 80);
    default:
      return "";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
