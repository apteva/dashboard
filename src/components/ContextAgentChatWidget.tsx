import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  chat,
  instances,
  platformHelper,
  type Agent,
  type ChatMessageContext,
  type ChatRow,
} from "../api";
import { useProjects } from "../hooks/useProjects";
import { useRealtimeAvailability } from "../hooks/useRealtimeAvailability";
import { ChatPanel } from "./ChatPanel";
import type { EventListener, SubscribeFn } from "./AgentView";
import {
  helperConversationStorageKey,
  helperDirectConversations,
  selectHelperConversation,
} from "./chat/helperConversationModel";

const STORAGE_OPEN = "context-agent-chat:open";
const REFRESH_MS = 8000;

// React development remounts can run the ensure effect twice. Share an
// in-flight project/helper creation briefly so opening an empty helper does not
// manufacture duplicate conversations.
const helperConversationCreates = new Map<string, Promise<ChatRow>>();

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
  const { currentProject } = useProjects();
  const context = useMemo(
    () => describeContext(location.pathname, currentProject?.id, currentProject?.name),
    [location.pathname, currentProject?.id, currentProject?.name],
  );
  const isChatRoute = location.pathname === "/chat" || location.pathname.startsWith("/chat/");
  const projectId = currentProject?.id || "";

  const [helper, setHelper] = useState<Agent | null>(null);
  const [conversations, setConversations] = useState<ChatRow[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectConversations = loadedProjectId === projectId && helper
    ? helperDirectConversations(conversations, helper.id)
    : [];
  const selectedConversation = projectConversations.find((conversation) => conversation.id === selectedConversationId)
    || projectConversations[0]
    || null;
  const realtime = useRealtimeAvailability(helper?.id, helper?.status === "running");

  const subscribeHelper = useCallback<SubscribeFn>(
    (listener: EventListener) => {
      if (typeof window === "undefined" || !helper?.id) return () => {};
      return window.__aptevaTelemetryBus?.subscribe(helper.id, listener) ?? (() => {});
    },
    [helper?.id],
  );

  const rememberSelection = useCallback((conversationId: string) => {
    if (!projectId) return;
    setSelectedConversationId(conversationId);
    try {
      sessionStorage.setItem(helperConversationStorageKey(projectId), conversationId);
    } catch {}
  }, [projectId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_OPEN, open ? "1" : "0");
    } catch {}
  }, [open]);

  useEffect(() => {
    if (isChatRoute && open) onClose();
  }, [isChatRoute, onClose, open]);

  useEffect(() => {
    setHelper(null);
    setConversations([]);
    setSelectedConversationId(null);
    setLoadedProjectId(null);
    setHistoryOpen(false);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (historyOpen) setHistoryOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen, onClose, open]);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHistoryOpen(false);

    const load = async () => {
      try {
        const [nextHelper, rows] = await Promise.all([
          platformHelper.get(),
          chat.listConversations(projectId),
        ]);
        let helperRows = helperDirectConversations(rows, nextHelper.id);
        let storedId: string | null = null;
        try {
          storedId = sessionStorage.getItem(helperConversationStorageKey(projectId));
        } catch {}
        let selected = selectHelperConversation(helperRows, nextHelper.id, storedId);
        if (!selected) {
          selected = await ensureHelperConversation(projectId, nextHelper);
          helperRows = [selected];
        }
        if (cancelled) return;
        setHelper(nextHelper);
        setConversations(mergeConversations(rows, helperRows));
        setLoadedProjectId(projectId);
        rememberSelection(selected.id);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, projectId, rememberSelection]);

  const createConversation = async () => {
    if (!helper || !projectId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await chat.createConversation(projectId, [helper.id], "Apteva Helper", helper.id);
      setConversations((current) => [created, ...current.filter((row) => row.id !== created.id)]);
      rememberSelection(created.id);
      setHistoryOpen(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  };

  const startHelper = async () => {
    if (!helper || starting) return;
    setStarting(true);
    setError(null);
    try {
      await instances.start(helper.id);
      setHelper(await platformHelper.get());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setStarting(false);
    }
  };

  if (isChatRoute) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={onOpen}
          className="floating-chat-launcher-safe touch-target fixed z-40 flex h-12 w-12 items-center justify-center rounded-full border border-accent/50 bg-accent text-bg shadow-xl shadow-black/25 transition-colors hover:bg-accent-hover"
          title="Ask Apteva Helper"
          aria-label="Open Apteva Helper"
        >
          <ChatIcon />
        </button>
      )}

      {open && (
        <>
          <button type="button" className="fixed inset-0 z-40 bg-black/45 sm:hidden" onClick={onClose} aria-label="Close Apteva Helper" />
          <section
            className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-var(--safe-area-top))] flex-col overflow-hidden rounded-t-xl border border-border bg-bg shadow-2xl shadow-black/30 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(700px,calc(100dvh-5rem))] sm:w-[440px] sm:max-w-[calc(100vw-2rem)] sm:rounded-lg"
            role="dialog"
            aria-modal="true"
            aria-label="Apteva Helper"
          >
            <div className="relative flex min-h-14 items-center gap-2 border-b border-border px-2 py-2 sm:gap-3 sm:px-3">
              <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded bg-accent text-bg sm:flex">
                <BotIcon />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-text">Apteva Helper</h2>
                  {helper && <StatusDot status={helper.status} />}
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">helper</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen((value) => !value)}
                  disabled={!selectedConversation}
                  className="mt-0.5 flex max-w-full items-center gap-1 text-left text-xs text-text-muted hover:text-text disabled:opacity-50"
                  aria-expanded={historyOpen}
                  aria-haspopup="menu"
                >
                  <span className="truncate">{selectedConversation?.title || (loading ? "Loading conversation…" : currentProject?.name || "Current project")}</span>
                  <span aria-hidden="true">⌄</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => void createConversation()}
                disabled={!helper || creating}
                className="touch-target inline-flex h-10 w-10 items-center justify-center rounded text-xl text-accent hover:bg-accent/10 disabled:opacity-40"
                title="New helper conversation"
                aria-label="New helper conversation"
              >
                {creating ? "…" : "+"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="touch-target inline-flex h-10 w-10 items-center justify-center rounded text-xl text-text-muted hover:bg-bg-hover hover:text-text"
                title="Close"
                aria-label="Close Apteva Helper"
              >
                ×
              </button>

              {historyOpen && (
                <div role="menu" aria-label="Helper conversations" className="absolute left-2 right-2 top-[calc(100%-2px)] z-20 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-card py-1 shadow-2xl shadow-black/60 sm:left-12">
                  <div className="px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-text-dim">Helper conversations</div>
                  {projectConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      role="menuitem"
                      onClick={() => { rememberSelection(conversation.id); setHistoryOpen(false); }}
                      className={`flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover ${conversation.id === selectedConversation?.id ? "bg-bg-hover" : ""}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${helper?.status === "running" ? "bg-green" : "bg-text-dim"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text">{conversation.title}</span>
                        <span className="block text-[10px] text-text-dim">{formatRelative(conversation.updated_at)}</span>
                      </span>
                      {conversation.id === selectedConversation?.id && <span className="text-xs text-accent">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="border-b border-red/40 bg-red/10 px-3 py-2 text-xs text-red break-words">{error}</div>}

            {!projectId ? (
              <EmptyState title="Choose a project" detail="Apteva Helper conversations are scoped to the current project." />
            ) : loading && !selectedConversation ? (
              <EmptyState title="Loading Apteva Helper" detail="Opening your project helper conversation…" />
            ) : helper && helper.status !== "running" ? (
              <div className="flex flex-1 items-center justify-center p-4">
                <div className="flex w-full items-center justify-between gap-3 rounded border border-border bg-bg-card p-3">
                  <span className="text-xs text-text-muted">Start Apteva Helper to continue this conversation.</span>
                  <button type="button" onClick={() => void startHelper()} disabled={starting} className="touch-target rounded border border-accent px-4 text-xs font-semibold text-accent hover:bg-accent hover:text-bg disabled:opacity-50">
                    {starting ? "Starting…" : "Start"}
                  </button>
                </div>
              </div>
            ) : helper && selectedConversation ? (
              <div className="min-h-0 flex-1">
                <ChatPanel
                  key={selectedConversation.id}
                  instanceId={helper.id}
                  conversationId={selectedConversation.id}
                  agentName={helper.name}
                  agentNames={{ [helper.id]: helper.name }}
                  participantIds={[helper.id]}
                  realtime={realtime}
                  subscribe={subscribeHelper}
                  autoConnect
                  hideHeader
                  messageContext={context}
                />
              </div>
            ) : (
              <EmptyState title="Helper unavailable" detail="Close and reopen Apteva Helper to try again." />
            )}
          </section>
        </>
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

function ensureHelperConversation(projectId: string, helper: Agent): Promise<ChatRow> {
  const key = `${projectId}:${helper.id}`;
  const existing = helperConversationCreates.get(key);
  if (existing) return existing;
  const created = chat.createConversation(projectId, [helper.id], "Apteva Helper", helper.id);
  helperConversationCreates.set(key, created);
  const clearCreation = () => {
    window.setTimeout(() => {
      if (helperConversationCreates.get(key) === created) helperConversationCreates.delete(key);
    }, 2000);
  };
  void created.then(clearCreation, clearCreation);
  return created;
}

function mergeConversations(rows: ChatRow[], additions: ChatRow[]): ChatRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of additions) byId.set(row.id, row);
  return [...byId.values()];
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center">
      <div>
        <div className="text-sm font-medium text-text">{title}</div>
        <div className="mt-1 text-xs leading-5 text-text-muted">{detail}</div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls = status === "running" ? "bg-green" : status === "stopped" ? "bg-text-dim" : "bg-yellow";
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
      title: "Dashboard",
      shortName: "Dashboard",
      detail: "Project dashboard summary",
      page_kind: "dashboard",
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

function formatRelative(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!timestamp) return "";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
