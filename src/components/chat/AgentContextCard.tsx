// Right-pane summary of the focused agent — gives the operator
// situational awareness without leaving the chat.
//
// Sections:
//   · status / mode pill
//   · directive (truncated, expandable)
//   · threads (compact list — main + spawned sub-threads with their
//     current activity)
//   · MCPs / tools (top-N + count)
//   · quick actions: pause, restart, full agent page
//
// Data is on a slow refresh (8s) — same cadence as the page-level
// instances list. We don't subscribe to telemetry from this card;
// the chat-side activity already keeps the user oriented in real
// time, and a chatty subscribe per render would fight ChatPanel's
// SSE budget. The "agent →" link gets the user to the live view if
// they want sub-second updates.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { instances, core, type Instance, type Thread, type MCPServerConfig } from "../../api";

const REFRESH_MS = 8000;

interface Props {
  instance: Instance;
}

export function AgentContextCard({ instance }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [directive, setDirective] = useState<string>(instance.directive || "");
  const [busy, setBusy] = useState<"" | "pause" | "restart">("");
  const [paused, setPaused] = useState<boolean | null>(null);
  const [showFullDirective, setShowFullDirective] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // Threads + config only meaningful for running instances; for
      // stopped ones we still show directive + a placeholder.
      if (instance.status !== "running") {
        if (!cancelled) setThreads([]);
        return;
      }
      Promise.all([
        core.threads(instance.id).catch(() => [] as Thread[]),
        core.config(instance.id).catch(() => null),
      ]).then(([t, cfg]) => {
        if (cancelled) return;
        setThreads(t);
        if (cfg) {
          if (cfg.directive !== undefined) setDirective(cfg.directive);
          setMcpServers(cfg.mcp_servers || []);
        }
      });
    };
    load();
    const tk = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(tk); };
  }, [instance.id, instance.status]);

  const handlePause = async () => {
    setBusy("pause");
    try {
      const r = await instances.pause(instance.id);
      setPaused(r.paused);
    } catch {
      // swallow — user retries via the agent page
    } finally {
      setBusy("");
    }
  };

  const handleRestart = async () => {
    setBusy("restart");
    try {
      await instances.stop(instance.id);
      await instances.start(instance.id);
    } catch {
      // swallow
    } finally {
      setBusy("");
    }
  };

  const directiveTrim = directive.trim();
  const directivePreview = directiveTrim.length > 200 && !showFullDirective
    ? directiveTrim.slice(0, 200) + "…"
    : directiveTrim;

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Header — agent identity */}
      <div>
        <div className="text-text font-medium truncate">{instance.name}</div>
        <div className="text-xs text-text-muted">#{instance.id}</div>
      </div>

      {/* Status + mode pills */}
      <div className="flex flex-wrap gap-1.5">
        <Pill tone={instance.status === "running" ? "ok" : "muted"}>
          {instance.status}
        </Pill>
        <Pill tone="default">{instance.mode}</Pill>
        {paused === true && <Pill tone="warn">paused</Pill>}
      </div>

      {/* Directive */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">
          Directive
        </div>
        <div className="text-xs text-text-muted whitespace-pre-wrap break-words">
          {directivePreview || <span className="italic text-text-dim">none</span>}
        </div>
        {directiveTrim.length > 200 && (
          <button
            onClick={() => setShowFullDirective((v) => !v)}
            className="text-[10px] text-accent hover:underline mt-1"
          >
            {showFullDirective ? "less" : "more"}
          </button>
        )}
      </div>

      {/* Threads */}
      {instance.status === "running" && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">
            Threads · {threads.length}
          </div>
          {threads.length === 0 ? (
            <div className="text-xs text-text-dim italic">none</div>
          ) : (
            <ul className="space-y-1">
              {threads.slice(0, 8).map((t) => (
                <li key={t.id} className="text-xs flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span className="text-text-muted truncate">{t.id}</span>
                </li>
              ))}
              {threads.length > 8 && (
                <li className="text-[11px] text-text-dim">
                  + {threads.length - 8} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* MCPs / tools */}
      {instance.status === "running" && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">
            MCPs · {mcpServers.length}
          </div>
          {mcpServers.length === 0 ? (
            <div className="text-xs text-text-dim italic">none</div>
          ) : (
            <ul className="space-y-1">
              {mcpServers.slice(0, 8).map((m) => (
                <li key={m.name} className="text-xs flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.connected ? "bg-green" : "bg-text-dim"}`}
                    title={m.connected ? "connected" : "disconnected"}
                  />
                  <span className="text-text-muted truncate">{m.name}</span>
                </li>
              ))}
              {mcpServers.length > 8 && (
                <li className="text-[11px] text-text-dim">
                  + {mcpServers.length - 8} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div className="pt-3 border-t border-border space-y-1.5">
        <Link
          to={`/instances/${instance.id}`}
          className="block w-full text-center text-xs text-text border border-border rounded px-2 py-1.5 hover:bg-bg-hover"
        >
          Open agent →
        </Link>
        {instance.status === "running" && (
          <>
            <button
              onClick={handlePause}
              disabled={busy !== ""}
              className="block w-full text-center text-xs text-text-muted border border-border rounded px-2 py-1.5 hover:bg-bg-hover disabled:opacity-50"
            >
              {busy === "pause" ? "pausing…" : paused ? "resume" : "pause"}
            </button>
            <button
              onClick={handleRestart}
              disabled={busy !== ""}
              className="block w-full text-center text-xs text-text-muted border border-border rounded px-2 py-1.5 hover:bg-bg-hover disabled:opacity-50"
            >
              {busy === "restart" ? "restarting…" : "restart"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted" | "default";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok" ? "border-green text-green" :
    tone === "warn" ? "border-yellow text-yellow" :
    tone === "muted" ? "border-border text-text-dim" :
    "border-border text-text-muted";
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wide border rounded px-2 py-0.5 ${cls}`}>
      {children}
    </span>
  );
}
