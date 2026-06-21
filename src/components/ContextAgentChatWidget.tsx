import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  instances,
  platformHelper,
  type Agent,
  type ChatMessageContext,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import { ChatPanel } from "./ChatPanel";
import type { EventListener, SubscribeFn } from "./AgentView";

const STORAGE_OPEN = "context-agent-chat:open";
const STORAGE_AGENT = "context-agent-chat:agent-id";

export function ContextAgentChatWidget({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const context = useMemo(
    () => describeContext(location.pathname, currentProject?.id, currentProject?.name),
    [location.pathname, currentProject?.id, currentProject?.name],
  );

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_AGENT);
      return raw ? Number(raw) || null : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;
  const selectedIsHelper = selectedAgent?.kind === "platform_helper";

  const subscribeSelectedAgent = useCallback<SubscribeFn>(
    (listener: EventListener) => {
      if (typeof window === "undefined" || !selectedAgentId) return () => {};
      return window.__aptevaTelemetryBus?.subscribe(selectedAgentId, listener) ?? (() => {});
    },
    [selectedAgentId],
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_OPEN, open ? "1" : "0");
    } catch {}
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAgentsLoading(true);
    Promise.allSettled([platformHelper.get(), instances.list(currentProject?.id)])
      .then((results) => {
        if (cancelled) return;
        const helper =
          results[0].status === "fulfilled" ? results[0].value : null;
        const rows =
          results[1].status === "fulfilled" ? results[1].value : [];
        const sorted = [...rows].sort((a, b) => {
          if (a.status === "running" && b.status !== "running") return -1;
          if (a.status !== "running" && b.status === "running") return 1;
          return a.name.localeCompare(b.name);
        });
        const next = helper ? [helper, ...sorted.filter((a) => a.id !== helper.id)] : sorted;
        setAgents(next);
        const routeAgentId = context.agent_id;
        if (routeAgentId && next.some((a) => a.id === routeAgentId)) {
          setSelectedAgentId((prev) => prev ?? routeAgentId);
        } else if (selectedAgentId && !next.some((a) => a.id === selectedAgentId)) {
          setSelectedAgentId(null);
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setAgentsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, currentProject?.id, context.agent_id, selectedAgentId]);

  useEffect(() => {
    try {
      if (selectedAgentId) sessionStorage.setItem(STORAGE_AGENT, String(selectedAgentId));
      else sessionStorage.removeItem(STORAGE_AGENT);
    } catch {}
  }, [selectedAgentId]);

  const startSelectedAgent = async () => {
    if (!selectedAgent) return;
    setStarting(true);
    setError(null);
    try {
      await instances.start(selectedAgent.id);
      const [helperResult, rows] = await Promise.allSettled([
        platformHelper.get(),
        instances.list(currentProject?.id),
      ]);
      const helper = helperResult.status === "fulfilled" ? helperResult.value : null;
      const normal = rows.status === "fulfilled" ? rows.value : [];
      setAgents(helper ? [helper, ...normal.filter((a) => a.id !== helper.id)] : normal);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={onOpen}
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-accent/50 bg-accent text-bg shadow-xl shadow-black/25 hover:bg-accent-hover transition-colors"
          title="Ask an agent about this page"
          aria-label="Ask an agent about this page"
        >
          <ChatIcon />
        </button>
      )}

      {open && (
        <section
          className="fixed inset-x-2 bottom-2 top-14 z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-2xl shadow-black/30 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(700px,calc(100vh-5rem))] sm:w-[440px] sm:max-w-[calc(100vw-2rem)]"
          role="dialog"
          aria-label="Ask an agent"
        >
          <div className="border-b border-border px-4 py-3 flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded bg-accent text-bg">
              <BotIcon />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-text">
                  {selectedAgent ? selectedAgent.name : "Ask an agent"}
                </h2>
                {selectedAgent && <StatusDot status={selectedAgent.status} />}
                {selectedIsHelper && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">helper</span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted truncate">
                {selectedAgent
                  ? `#${selectedAgent.id} · ${selectedIsHelper ? "platform" : selectedAgent.mode} · ${selectedAgent.status}`
                  : `${context.title} · ${currentProject?.name || "Current project"}`}
              </p>
            </div>
            {selectedAgent && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(null)}
                  className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-bg-hover"
                >
                  Agents
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/agents/${selectedAgent.id}`)}
                  className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-bg-hover"
                >
                  Open
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-bg-hover"
              title="Close"
            >
              ×
            </button>
          </div>

          {selectedAgent ? (
            <>
              {error && (
                <div className="border-b border-red/40 bg-red/10 px-3 py-2 text-xs text-red break-words">
                  {error}
                </div>
              )}

              {selectedAgent.status !== "running" ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <div className="flex w-full items-center justify-between gap-3 rounded border border-border bg-bg-card p-3">
                    <span className="text-xs text-text-muted">Start this agent to chat from here.</span>
                    <button
                      type="button"
                      onClick={startSelectedAgent}
                      disabled={starting}
                      className="rounded border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-bg disabled:opacity-50"
                    >
                      {starting ? "Starting…" : "Start"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <ChatPanel
                    key={selectedAgent.id}
                    instanceId={selectedAgent.id}
                    subscribe={subscribeSelectedAgent}
                    autoConnect
                    hideHeader
                    messageContext={context}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-3">
              {agentsLoading && (
                <div className="mb-2 text-right text-[10px] text-text-muted">loading…</div>
              )}
              <div>
                <div className="space-y-2">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.id)}
                      className="w-full rounded border border-border bg-bg-card p-3 text-left hover:border-accent/60 hover:bg-bg-hover transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-bg-input text-xs font-semibold text-text">
                          {initials(agent.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StatusDot status={agent.status} />
                            <span className="truncate text-sm font-medium text-text">{agent.name}</span>
                            {agent.kind === "platform_helper" && (
                              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">helper</span>
                            )}
                            {context.agent_id === agent.id && (
                              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">this page</span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-text-muted">
                            #{agent.id} · {agent.kind === "platform_helper" ? "platform" : agent.mode} · {agent.status}
                          </div>
                          {agent.directive && (
                            <div className="mt-2 line-clamp-2 text-[11px] text-text-dim">
                              {agent.directive}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                  {!agentsLoading && agents.length === 0 && (
                    <div className="rounded border border-border bg-bg-card p-4 text-sm text-text-muted">
                      No agents in this project yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function readContextAgentChatOpenDefault(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_OPEN) === "1";
  } catch {
    return false;
  }
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "running"
      ? "bg-green"
      : status === "stopped"
        ? "bg-text-dim"
        : "bg-yellow";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} title={status} />;
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M9 13h.01" />
      <path d="M15 13h.01" />
    </svg>
  );
}

interface ContextDescription extends ChatMessageContext {
  shortName: string;
  agent_id?: number;
}

function describeContext(pathname: string, projectId?: string, projectName?: string): ContextDescription {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const base = {
    source: "dashboard-floating" as const,
    project_id: projectId,
    project_name: projectName,
    route: clean,
  };
  if (clean === "/") {
    return {
      ...base,
      title: "Overview",
      shortName: "Overview",
      detail: "Project dashboard summary",
      page_kind: "overview",
      chips: ["dashboard", "project"],
    };
  }
  const appMatch = clean.match(/^\/apps\/([^/]+)\/page$/);
  if (appMatch) {
    const app = titleFromSlug(appMatch[1] || "app");
    return {
      ...base,
      title: `${app} app`,
      shortName: app,
      detail: "App UI panel with project-scoped context",
      page_kind: "app",
      chips: ["app", appMatch[1] || "app", "project.page"],
    };
  }
  const agentMatch = clean.match(/^\/agents\/(\d+)/);
  if (agentMatch) {
    const id = Number(agentMatch[1]);
    return {
      ...base,
      title: `Agent #${id}`,
      shortName: "Agent",
      detail: "Agent detail page and runtime context",
      page_kind: "agent",
      agent_id: id,
      chips: ["agent", `#${id}`, "runtime"],
    };
  }
  const first = clean.split("/").filter(Boolean)[0] || "dashboard";
  const title = titleFromSlug(first);
  return {
    ...base,
    title,
    shortName: title,
    detail: `Current dashboard page: ${clean}`,
    page_kind: first,
    chips: ["dashboard", first],
  };
}

function titleFromSlug(slug: string) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
