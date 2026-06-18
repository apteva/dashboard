import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { marked } from "marked";
import {
  chat,
  instances,
  type Agent,
  type ChatMessageContext,
  type ChatMessageRow,
} from "../api";
import { useProjects } from "../hooks/useProjects";

marked.setOptions({ breaks: true, gfm: true });

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
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const sinceRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;

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
    instances
      .list(currentProject?.id)
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort((a, b) => {
          if (a.status === "running" && b.status !== "running") return -1;
          if (a.status !== "running" && b.status === "running") return 1;
          return a.name.localeCompare(b.name);
        });
        setAgents(sorted);
        const routeAgentId = context.agent_id;
        if (routeAgentId && sorted.some((a) => a.id === routeAgentId)) {
          setSelectedAgentId((prev) => prev ?? routeAgentId);
        } else if (selectedAgentId && !sorted.some((a) => a.id === selectedAgentId)) {
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

  useEffect(() => {
    if (!open || !selectedAgentId) {
      setChatId(null);
      setMessages([]);
      sinceRef.current = 0;
      return;
    }
    let cancelled = false;
    setLoadingChat(true);
    setError(null);
    setMessages([]);
    setStreamingText(null);
    sinceRef.current = 0;
    chat
      .listChats(selectedAgentId)
      .then((rows) => {
        if (cancelled) return null;
        if (rows.length > 0) return rows[0];
        return chat.createChat(selectedAgentId, "Dashboard");
      })
      .then((row) => {
        if (cancelled || !row) return;
        setChatId(row.id);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoadingChat(false));
    return () => {
      cancelled = true;
    };
  }, [open, selectedAgentId]);

  useEffect(() => {
    if (!open || !chatId) return;
    let cancelled = false;
    chat
      .messages(chatId, 0, 200)
      .then((rows) => {
        if (cancelled) return;
        setMessages((prev) => mergeMessages(rows, prev));
        sinceRef.current = Math.max(
          sinceRef.current,
          rows.reduce((max, row) => Math.max(max, row.id), 0),
        );
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [open, chatId]);

  useEffect(() => {
    if (!open || !chatId || !selectedAgentId) return;
    void chat.presence(chatId, "connected").catch(() => {});
    const es = chat.stream(chatId, sinceRef.current);
    es.onmessage = (event) => {
      const row = parseJSON<ChatMessageRow>(event.data);
      if (!row || row.id <= sinceRef.current) return;
      sinceRef.current = row.id;
      setStreamingText(null);
      setMessages((prev) => [...prev, row]);
    };
    es.addEventListener("stream", (event) => {
      const frame = parseJSON<{ text?: string; done?: boolean }>((event as MessageEvent).data);
      if (!frame || frame.done) {
        setStreamingText(null);
      } else {
        setStreamingText(frame.text || "");
      }
    });
    es.onerror = () => {
      // EventSource auto-retries. Keep the panel usable; the next
      // successful connection backfills from sinceRef.
    };
    return () => {
      es.close();
      void chat.presence(chatId, "disconnected").catch(() => {});
    };
  }, [open, chatId, selectedAgentId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, selectedAgentId]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || !chatId || !selectedAgent || selectedAgent.status !== "running" || sending) return;
    setSending(true);
    setError(null);
    try {
      await chat.post(chatId, content, context);
      setDraft("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }, [draft, chatId, selectedAgent, sending, context]);

  const startSelectedAgent = async () => {
    if (!selectedAgent) return;
    setStarting(true);
    setError(null);
    try {
      await instances.start(selectedAgent.id);
      const rows = await instances.list(currentProject?.id);
      setAgents(rows);
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
                <h2 className="text-sm font-semibold text-text">Ask an agent</h2>
                {selectedAgent && <StatusDot status={selectedAgent.status} />}
              </div>
              <p className="mt-0.5 text-xs text-text-muted truncate">
                {context.title} · {currentProject?.name || "Current project"}
              </p>
            </div>
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
              <div className="border-b border-border p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedAgentId(null)}
                    className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-bg-hover"
                  >
                    Agents
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusDot status={selectedAgent.status} />
                      <span className="truncate text-sm font-medium text-text">{selectedAgent.name}</span>
                    </div>
                    <div className="truncate text-[11px] text-text-muted">
                      #{selectedAgent.id} · {selectedAgent.mode} · {selectedAgent.status}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/agents/${selectedAgent.id}`)}
                    className="rounded border border-border px-2 py-1 text-xs text-text-muted hover:text-text hover:bg-bg-hover"
                  >
                    Open
                  </button>
                </div>
                <ContextStrip context={context} />
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingChat && (
                  <div className="text-center text-xs text-text-muted py-8">Loading chat…</div>
                )}
                {!loadingChat && messages.length === 0 && (
                  <div className="text-center text-xs text-text-muted py-8">
                    Ask about this page. The current route is sent as context with your message.
                  </div>
                )}
                {messages.map((message) => (
                  <WidgetMessage key={message.id} message={message} />
                ))}
                {streamingText !== null && <AgentBubble content={streamingText} streaming />}
              </div>

              {error && (
                <div className="border-t border-red/40 bg-red/10 px-3 py-2 text-xs text-red break-words">
                  {error}
                </div>
              )}

              <div className="border-t border-border p-3">
                {selectedAgent.status !== "running" ? (
                  <div className="flex items-center justify-between gap-3">
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
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                    className="flex items-end gap-2"
                  >
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={2}
                      placeholder={`Ask ${selectedAgent.name} about ${context.shortName.toLowerCase()}...`}
                      className="min-h-[44px] max-h-28 flex-1 resize-none rounded border border-border bg-bg-input px-3 py-2 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={!draft.trim() || sending || !chatId}
                      className="h-9 w-9 shrink-0 rounded-full bg-accent text-bg flex items-center justify-center hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Send"
                    >
                      ↑
                    </button>
                  </form>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <ContextStrip context={context} />
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wide text-text-dim">Available agents</div>
                  {agentsLoading && <div className="text-[10px] text-text-muted">loading…</div>}
                </div>
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
                            {context.agent_id === agent.id && (
                              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">this page</span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-text-muted">
                            #{agent.id} · {agent.mode} · {agent.status}
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

function mergeMessages(a: ChatMessageRow[], b: ChatMessageRow[]): ChatMessageRow[] {
  const byID = new Map<number, ChatMessageRow>();
  for (const row of a) byID.set(row.id, row);
  for (const row of b) byID.set(row.id, row);
  return [...byID.values()].sort((x, y) => x.id - y.id);
}

function WidgetMessage({ message }: { message: ChatMessageRow }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end min-w-0">
        <div className="max-w-[82%] rounded-xl rounded-br-sm border border-accent/30 bg-accent/15 px-3 py-2 text-sm text-text whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.role === "system") {
    return <div className="text-center text-[10px] text-text-muted py-1">{message.content}</div>;
  }
  return <AgentBubble content={message.content} streaming={message.status === "streaming"} />;
}

function AgentBubble({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const html = useMemo(
    () => marked.parse(streaming ? closeOpenMarkdown(content) : content, { async: false }) as string,
    [content, streaming],
  );
  return (
    <div className="min-w-0">
      <div
        className="chat-md text-sm text-text leading-relaxed break-words"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ContextStrip({ context }: { context: ContextDescription }) {
  return (
    <div className="rounded border border-border bg-bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text truncate">{context.title}</div>
          <div className="text-[11px] text-text-muted truncate">{context.detail}</div>
        </div>
        <span className="shrink-0 rounded bg-accent/10 px-2 py-1 text-[11px] text-accent">
          context
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {context.chips.map((chip) => (
          <span key={chip} className="rounded border border-border bg-bg-input px-2 py-0.5 text-[11px] text-text-muted">
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
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

function parseJSON<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function closeOpenMarkdown(s: string): string {
  const fence = (s.match(/```/g) || []).length;
  let out = s;
  if (fence % 2 === 1) out += "\n```";
  if (fence % 2 === 1) return out;
  const noFences = out.replace(/```[\s\S]*?```/g, "");
  const ticks = (noFences.match(/`/g) || []).length;
  if (ticks % 2 === 1) out += "`";
  const bold = (out.match(/\*\*/g) || []).length;
  if (bold % 2 === 1) out += "**";
  if (/\[[^\]]*\]\([^)]*$/.test(out)) out += ")";
  return out;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
