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
import { useTranslation } from "react-i18next";
import { instances, core, type Agent, type Thread, type MCPServerConfig } from "../../api";

const REFRESH_MS = 8000;

interface Props {
  instance: Agent;
  // Focused explicit conversation id (e.g. "conv-..."). When CHANNELCHAT_PER_THREAD
  // is on, channelchat routes this chat's events to thread "chat-<id>"
  // rather than "main"; we surface that with a small badge on the
  // matching row in the threads list so the operator can see which
  // thread is handling the conversation. Optional — when omitted or
  // when no matching thread is found, the list renders unchanged.
  chatId?: string | null;
}

export function AgentContextCard({ instance, chatId }: Props) {
  const { t } = useTranslation();
  const expectedChatThreadId = chatId ? `chat-${chatId}` : "";
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
        {paused === true && <Pill tone="warn">{t("chat.context.paused")}</Pill>}
      </div>

      {/* Directive */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">
          {t("chat.context.directive")}
        </div>
        <div className="text-xs text-text-muted whitespace-pre-wrap break-words">
          {directivePreview || <span className="italic text-text-dim">{t("chat.context.none")}</span>}
        </div>
        {directiveTrim.length > 200 && (
          <button
            onClick={() => setShowFullDirective((v) => !v)}
            className="touch-target inline-flex items-center text-xs text-accent hover:underline mt-1"
          >
            {showFullDirective ? t("chat.context.less") : t("chat.context.more")}
          </button>
        )}
      </div>

      {/* Threads */}
      {instance.status === "running" && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-dim mb-1">
            {t("chat.context.threads", { count: threads.length })}
          </div>
          {threads.length === 0 ? (
            <div className="text-xs text-text-dim italic">{t("chat.context.none")}</div>
          ) : (
            <ul className="space-y-1">
              {threads.slice(0, 8).map((thread) => (
                <li key={thread.id} className="text-xs flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                  <span className="text-text-muted truncate">{thread.id}</span>
                  {expectedChatThreadId && thread.id === expectedChatThreadId && (
                    <span className="text-[10px] uppercase tracking-wide text-accent shrink-0">{t("chat.context.thisChat")}</span>
                  )}
                </li>
              ))}
              {threads.length > 8 && (
                <li className="text-[11px] text-text-dim">
                  {t("chat.context.moreItems", { count: threads.length - 8 })}
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
            {t("chat.context.mcps", { count: mcpServers.length })}
          </div>
          {mcpServers.length === 0 ? (
            <div className="text-xs text-text-dim italic">{t("chat.context.none")}</div>
          ) : (
            <ul className="space-y-1">
              {mcpServers.slice(0, 8).map((m) => (
                <li key={m.name} className="text-xs flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.connected ? "bg-green" : "bg-text-dim"}`}
                    title={m.connected ? t("chat.context.connected") : t("chat.context.disconnected")}
                  />
                  <span className="text-text-muted truncate">{m.name}</span>
                </li>
              ))}
              {mcpServers.length > 8 && (
                <li className="text-[11px] text-text-dim">
                  {t("chat.context.moreItems", { count: mcpServers.length - 8 })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div className="pt-3 border-t border-border space-y-1.5">
        <Link
          to={`/agents/${instance.id}`}
          className="touch-target flex w-full items-center justify-center text-sm sm:text-xs text-text border border-border rounded-lg px-3 py-2 hover:bg-bg-hover"
        >
          {t("chat.context.openAgent")}
        </Link>
        {instance.status === "running" && (
          <>
            <button
              onClick={handlePause}
              disabled={busy !== ""}
              className="touch-target block w-full text-center text-sm sm:text-xs text-text-muted border border-border rounded-lg px-3 py-2 hover:bg-bg-hover disabled:opacity-50"
            >
              {busy === "pause" ? t("chat.context.pausing") : paused ? t("chat.context.resume") : t("chat.context.pause")}
            </button>
            <button
              onClick={handleRestart}
              disabled={busy !== ""}
              className="touch-target block w-full text-center text-sm sm:text-xs text-text-muted border border-border rounded-lg px-3 py-2 hover:bg-bg-hover disabled:opacity-50"
            >
              {busy === "restart" ? t("chat.context.restarting") : t("chat.context.restart")}
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
