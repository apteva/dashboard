import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  apps,
  chat,
  instances,
  platformHelper,
  skills,
  telemetry,
  type Agent,
  type AppRow,
  type ChatMessageContext,
  type ChatRow,
  type Skill,
  type TelemetryEvent,
  type UnreadSummaryRow,
} from "../api";
import { ChatPanel, type ChatQueuedMessage } from "../components/ChatPanel";
import type { SubscribeFn } from "../components/AgentView";
import { usePageTitle } from "../hooks/usePageTitle";
import { useProjects } from "../hooks/useProjects";
import { useRealtimeAvailability } from "../hooks/useRealtimeAvailability";
import { chatConnections } from "../state/chatConnections";
import { chatPreviewText } from "../utils/chatPreview";

type WorkspaceTab = "project" | "activity";
type WorkspaceItemKind = "agent" | "app" | "skill";

interface WorkspaceItem {
  id: string;
  kind: WorkspaceItemKind;
  name: string;
  detail: string;
  status: string;
  href: string;
  icon?: string;
}

const EMPTY_HELPER_MESSAGE =
  "The Apteva Helper could not start. Check that an LLM provider is configured, then try again.";

export function Build() {
  usePageTitle("Build");
  const navigate = useNavigate();
  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [helper, setHelper] = useState<Agent | null>(null);
  const [helperError, setHelperError] = useState("");
  const [conversations, setConversations] = useState<ChatRow[]>([]);
  const [unread, setUnread] = useState<UnreadSummaryRow[]>([]);
  const [projectAgents, setProjectAgents] = useState<Agent[]>([]);
  const [projectApps, setProjectApps] = useState<AppRow[]>([]);
  const [projectSkills, setProjectSkills] = useState<Skill[]>([]);
  const [activity, setActivity] = useState<TelemetryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("project");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<(ChatQueuedMessage & { conversationId: string }) | null>(null);

  const refreshHelper = useCallback(async () => {
    try {
      const row = await platformHelper.get();
      setHelper(row);
      setHelperError("");
      return row;
    } catch (error: any) {
      setHelper(null);
      setHelperError(error?.message || EMPTY_HELPER_MESSAGE);
      return null;
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!projectId) {
      setConversations([]);
      setUnread([]);
      return;
    }
    const [rows, summary] = await Promise.all([
      chat.listConversations(projectId),
      chat.unreadSummary(),
    ]);
    setConversations(rows || []);
    setUnread(summary || []);
  }, [projectId]);

  const refreshInventory = useCallback(async () => {
    if (!projectId) {
      setProjectAgents([]);
      setProjectApps([]);
      setProjectSkills([]);
      return;
    }
    const [agentRows, appRows, skillRows] = await Promise.all([
      instances.list(projectId),
      apps.list(projectId),
      skills.list(projectId),
    ]);
    setProjectAgents(agentRows || []);
    setProjectApps(appRows || []);
    setProjectSkills(skillRows || []);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError("");
    Promise.allSettled([refreshHelper(), refreshSessions(), refreshInventory()])
      .then((results) => {
        if (cancelled) return;
        const failed = results.find((result, index) => index > 0 && result.status === "rejected");
        if (failed?.status === "rejected") {
          setPageError((failed.reason as any)?.message || "Could not load the Build workspace.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshHelper, refreshInventory, refreshSessions]);

  useEffect(() => {
    if (!projectId) return;
    const timer = window.setInterval(() => {
      void refreshHelper();
      void refreshSessions().catch(() => {});
      void refreshInventory().catch(() => {});
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [projectId, refreshHelper, refreshInventory, refreshSessions]);

  useEffect(() => {
    if (!helper?.id) {
      setActivity([]);
      return;
    }
    let cancelled = false;
    telemetry.query(helper.id, undefined, 50).then((events) => {
      if (!cancelled) setActivity(sortActivity(events || []));
    }).catch(() => {
      if (!cancelled) setActivity([]);
    });
    const unsubscribe = window.__aptevaTelemetryBus?.subscribe(helper.id, (event) => {
      setActivity((current) => sortActivity([event, ...current.filter((row) => row.id !== event.id)]).slice(0, 50));
      if (event.type === "tool.result" || event.type === "thread.done") {
        window.setTimeout(() => void refreshInventory().catch(() => {}), 500);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [helper?.id, refreshInventory]);

  const helperSessions = useMemo(() => {
    if (!helper) return [];
    return conversations
      .filter((row) => participantIDs(row).includes(helper.id))
      .sort((a, b) => timeValue(b.updated_at) - timeValue(a.updated_at));
  }, [conversations, helper]);

  const unreadByChat = useMemo(
    () => new Map(unread.map((row) => [row.chat_id, row])),
    [unread],
  );
  const requestedSessionId = searchParams.get("session");
  const active = helperSessions.find((row) => row.id === requestedSessionId) || helperSessions[0] || null;

  useEffect(() => {
    if (!active?.id) return;
    return chatConnections.subscribeMessages(active.id, 0, () => {
      void refreshSessions().catch(() => {});
    });
  }, [active?.id, refreshSessions]);

  useEffect(() => {
    if (!active || requestedSessionId === active.id) return;
    const next = new URLSearchParams(searchParams);
    next.set("session", active.id);
    setSearchParams(next, { replace: true });
  }, [active, requestedSessionId, searchParams, setSearchParams]);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) return helperSessions;
    return helperSessions.filter((row) => {
      const summary = unreadByChat.get(row.id);
      return `${row.title} ${chatPreviewText(summary?.latest_preview || "")}`.toLowerCase().includes(query);
    });
  }, [helperSessions, sessionSearch, unreadByChat]);

  const workspaceItems = useMemo(() => buildWorkspaceItems(projectAgents, projectApps, projectSkills), [projectAgents, projectApps, projectSkills]);
  const realtime = useRealtimeAvailability(helper?.id, helper?.status === "running");
  const subscribe = useCallback<SubscribeFn>((listener) => {
    if (!helper?.id) return () => {};
    return window.__aptevaTelemetryBus?.subscribe(helper.id, listener) ?? (() => {});
  }, [helper?.id]);

  function selectSession(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set("session", id);
    setSearchParams(next);
    setSessionsOpen(false);
    setActionMenuOpen(false);
  }

  function buildMessageContext(title: string, id?: string): ChatMessageContext {
    return {
      source: "dashboard-build",
      project_id: projectId,
      project_name: currentProject?.name || "",
      route: id ? `/build?session=${encodeURIComponent(id)}` : "/build",
      title,
      detail: "Project conversation with Apteva Helper",
      page_kind: "build",
      chips: ["build", "project"],
    };
  }

  async function createConversation(title: string, request: string) {
    if (!helper || !projectId || !request.trim()) return;
    setCreating(true);
    setPageError("");
    try {
      const resolvedTitle = title.trim() || titleFromRequest(request);
      const conversation = await chat.createConversation(projectId, [helper.id], resolvedTitle, helper.id);
      setConversations((current) => [conversation, ...current.filter((row) => row.id !== conversation.id)]);
      selectSession(conversation.id);
      setNewConversationOpen(false);
      setQueuedMessage({
        conversationId: conversation.id,
        id: newClientMessageId(),
        content: request.trim(),
      });
    } catch (error: any) {
      setPageError(error?.message || "Could not start the conversation.");
    } finally {
      setCreating(false);
    }
  }

  async function archiveActive() {
    if (!active) return;
    setActionMenuOpen(false);
    try {
      await chat.updateConversation(active.id, { archived: true });
      const next = new URLSearchParams(searchParams);
      next.delete("session");
      setSearchParams(next, { replace: true });
      await refreshSessions();
      showToast("Conversation archived");
    } catch (error: any) {
      setPageError(error?.message || "Could not archive this build.");
    }
  }

  async function deleteBuild() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await chat.deleteConversation(target.id);
      chatConnections.forgetChat(target.id);
      const next = new URLSearchParams(searchParams);
      next.delete("session");
      setSearchParams(next, { replace: true });
      await refreshSessions();
      showToast("Conversation deleted");
    } catch (error: any) {
      setPageError(error?.message || "Could not delete this build.");
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  const context = active ? buildMessageContext(active.title, active.id) : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg">
      <BuildHeader
        session={active}
        projectName={currentProject?.name || "Current project"}
        helper={helper}
        menuOpen={actionMenuOpen}
        onToggleMenu={() => setActionMenuOpen((value) => !value)}
        onOpenSessions={() => setSessionsOpen(true)}
        onOpenWorkspace={() => setWorkspaceOpen(true)}
        onArchive={() => void archiveActive()}
        onDelete={() => {
          setActionMenuOpen(false);
          setDeleteTarget(active);
        }}
      />

      {pageError && (
        <div className="shrink-0 border-b border-red/25 bg-red/10 px-4 py-2 text-xs text-red">
          {pageError}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[245px_minmax(460px,1fr)_350px] 2xl:grid-cols-[260px_minmax(560px,1fr)_390px]">
        <aside className="hidden min-h-0 border-r border-border xl:flex xl:flex-col">
          <SessionsPanel
            sessions={filteredSessions}
            activeId={active?.id || ""}
            unreadByChat={unreadByChat}
            helperRunning={helper?.status === "running"}
            search={sessionSearch}
            loading={loading}
            onSearch={setSessionSearch}
            onSelect={selectSession}
            onNew={() => setNewConversationOpen(true)}
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
          {loading ? (
            <CenteredState title="Loading Build…" detail="Opening saved conversations and project context." />
          ) : helperError || !helper ? (
            <CenteredState
              title="Apteva Helper is unavailable"
              detail={helperError || EMPTY_HELPER_MESSAGE}
              action="Try again"
              onAction={() => void refreshHelper()}
            />
          ) : active && context ? (
            <ChatPanel
              key={active.id}
              instanceId={helper.id}
              conversationId={active.id}
              agentName={helper.name}
              agentNames={{ [helper.id]: helper.name }}
              participantIds={[helper.id]}
              realtime={realtime}
              subscribe={subscribe}
              autoConnect
              hideHeader
              messageContext={context}
              queuedMessage={queuedMessage?.conversationId === active.id ? queuedMessage : undefined}
              onQueuedMessageHandled={(id) => {
                setQueuedMessage((current) => current?.id === id ? null : current);
              }}
            />
          ) : (
            <CenteredState
              title="What should we work on?"
              detail="Start a saved conversation with Apteva Helper to create agents, connect apps, shape behaviors, or change this project."
              action="New conversation"
              onAction={() => setNewConversationOpen(true)}
            />
          )}
        </main>

        <aside className="hidden min-h-0 border-l border-border xl:flex xl:flex-col">
          <WorkspacePanel
            projectName={currentProject?.name || "Current project"}
            projectDescription={currentProject?.description || ""}
            items={workspaceItems}
            activity={activity}
            tab={workspaceTab}
            onTab={setWorkspaceTab}
            onOpen={(href) => navigate(href)}
          />
        </aside>
      </div>

      {sessionsOpen && (
        <Drawer side="left" label="Conversations" onClose={() => setSessionsOpen(false)}>
          <SessionsPanel
            sessions={filteredSessions}
            activeId={active?.id || ""}
            unreadByChat={unreadByChat}
            helperRunning={helper?.status === "running"}
            search={sessionSearch}
            loading={loading}
            onSearch={setSessionSearch}
            onSelect={selectSession}
            onNew={() => setNewConversationOpen(true)}
          />
        </Drawer>
      )}

      {workspaceOpen && (
        <Drawer side="right" label="Project workspace" onClose={() => setWorkspaceOpen(false)}>
          <WorkspacePanel
            projectName={currentProject?.name || "Current project"}
            projectDescription={currentProject?.description || ""}
            items={workspaceItems}
            activity={activity}
            tab={workspaceTab}
            onTab={setWorkspaceTab}
            onOpen={(href) => {
              setWorkspaceOpen(false);
              navigate(href);
            }}
          />
        </Drawer>
      )}

      {newConversationOpen && (
        <NewConversationDialog
          busy={creating}
          onClose={() => !creating && setNewConversationOpen(false)}
          onCreate={createConversation}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete conversation?"
          detail={`“${deleteTarget.title}” and its complete conversation history will be permanently deleted.`}
          confirm="Delete conversation"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void deleteBuild()}
        />
      )}

      {toast && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-md border border-border bg-bg-card px-4 py-2.5 text-xs font-semibold text-text shadow-[var(--shadow-popover)]">
          {toast}
        </div>
      )}
    </div>
  );
}

function BuildHeader(props: {
  session: ChatRow | null;
  projectName: string;
  helper: Agent | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenSessions: () => void;
  onOpenWorkspace: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <header className="relative flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
      <button type="button" onClick={props.onOpenSessions} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-bold text-text-muted hover:bg-bg-hover hover:text-text xl:hidden" aria-label="Open conversations">
        <ListIcon /> <span className="hidden sm:inline">Conversations</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-bold text-text sm:text-base">{props.session?.title || "Build"}</h1>
          {props.helper && (
            <span className={`hidden shrink-0 items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide sm:inline-flex ${props.helper.status === "running" ? "text-green" : "text-text-dim"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${props.helper.status === "running" ? "bg-green" : "bg-text-dim"}`} />
              Helper {props.helper.status}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-text-dim">Build · {props.projectName}</p>
      </div>
      <button type="button" onClick={props.onOpenWorkspace} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-bold text-text-muted hover:bg-bg-hover hover:text-text xl:hidden" aria-label="Open project workspace">
        <ProjectIcon /> <span className="hidden sm:inline">Project</span>
      </button>
      {props.session && (
        <div className="relative">
          <button type="button" onClick={props.onToggleMenu} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-lg leading-none text-text-muted hover:bg-bg-hover hover:text-text" aria-label="Conversation actions" aria-expanded={props.menuOpen}>⋮</button>
          {props.menuOpen && (
            <div className="absolute right-0 top-11 z-50 w-44 rounded-md border border-border bg-bg-card p-1.5 shadow-[var(--shadow-popover)]">
              <button type="button" onClick={props.onArchive} className="flex h-9 w-full items-center rounded px-2.5 text-left text-xs text-text-muted hover:bg-bg-hover hover:text-text">Archive conversation</button>
              <button type="button" onClick={props.onDelete} className="flex h-9 w-full items-center rounded px-2.5 text-left text-xs text-red hover:bg-red/10">Delete conversation</button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function SessionsPanel(props: {
  sessions: ChatRow[];
  activeId: string;
  unreadByChat: Map<string, UnreadSummaryRow>;
  helperRunning: boolean;
  search: string;
  loading: boolean;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="border-b border-border p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-text">Conversations</h2>
            <p className="mt-0.5 text-[10px] text-text-dim">With Apteva Helper</p>
          </div>
          <button type="button" onClick={props.onNew} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-bold text-bg hover:bg-accent-hover">
            <PlusIcon /> New
          </button>
        </div>
        <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-bg-input px-2.5 focus-within:border-accent">
          <SearchIcon />
          <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Search conversations" className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-dim" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.loading ? (
          <PanelEmpty>Loading conversations…</PanelEmpty>
        ) : props.sessions.length === 0 ? (
          <PanelEmpty>{props.search ? "No conversations match this search." : "No conversations with Apteva Helper yet."}</PanelEmpty>
        ) : props.sessions.map((session) => {
          const summary = props.unreadByChat.get(session.id);
          const preview = chatPreviewText(summary?.latest_preview || "") || "No messages yet";
          const isUnread = !!summary && summary.latest_id > summary.last_seen_id;
          const active = session.id === props.activeId;
          return (
            <button type="button" key={session.id} onClick={() => props.onSelect(session.id)} className={`mb-1 w-full rounded-md border px-3 py-2.5 text-left transition-colors ${active ? "border-accent/35 bg-accent/10" : "border-transparent hover:border-border hover:bg-bg-hover"}`}>
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${props.helperRunning ? "bg-green" : "bg-text-dim/45"}`}
                  title={props.helperRunning ? "Apteva Helper is running" : "Apteva Helper is offline"}
                  aria-label={props.helperRunning ? "Apteva Helper is running" : "Apteva Helper is offline"}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`truncate text-xs ${isUnread ? "font-extrabold text-text" : "font-bold text-text"}`}>{session.title}</span>
                      {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Unread messages" aria-label="Unread messages" />}
                    </span>
                    <span className="shrink-0 text-[9px] text-text-dim">{relativeTime(summary?.latest_at || session.updated_at)}</span>
                  </span>
                  <span
                    className="mt-1 block truncate text-[10px] leading-4 text-text-muted"
                    title={preview}
                  >
                    {preview}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="border-t border-border px-3 py-2.5 text-[10px] text-text-dim">Stored in Apteva Channels</div>
    </div>
  );
}

function WorkspacePanel(props: {
  projectName: string;
  projectDescription: string;
  items: WorkspaceItem[];
  activity: TelemetryEvent[];
  tab: WorkspaceTab;
  onTab: (tab: WorkspaceTab) => void;
  onOpen: (href: string) => void;
}) {
  const groups = (["agent", "app", "skill"] as WorkspaceItemKind[]).map((kind) => ({
    kind,
    items: props.items.filter((item) => item.kind === kind),
  }));
  const meaningfulActivity = props.activity.filter((event) => !isNoisyActivity(event.type)).slice(0, 30);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="shrink-0 border-b border-border px-4 pb-0 pt-3">
        <div className="flex min-w-0 items-center gap-2 pb-1">
          <ProjectIcon />
          <h2 className="truncate text-sm font-bold text-text">{props.projectName}</h2>
        </div>
        <p className="line-clamp-2 min-h-4 text-[10px] leading-4 text-text-dim">{props.projectDescription || "Project workspace"}</p>
        <div className="mt-3 flex gap-4">
          <button type="button" onClick={() => props.onTab("project")} className={`border-b-2 pb-2 text-[11px] font-bold ${props.tab === "project" ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}>Project</button>
          <button type="button" onClick={() => props.onTab("activity")} className={`border-b-2 pb-2 text-[11px] font-bold ${props.tab === "activity" ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}>Helper activity</button>
        </div>
      </div>

      {props.tab === "project" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-4 grid grid-cols-3 gap-1.5">
            {groups.map((group) => (
              <div key={group.kind} className="rounded-md border border-border bg-bg-card/40 px-2 py-2 text-center">
                <div className="text-sm font-bold text-text">{group.items.length}</div>
                <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wide text-text-dim">{group.kind}{group.items.length === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
          {groups.map((group) => (
            <section key={group.kind} className="mb-5">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <h3 className="text-[9px] font-bold uppercase tracking-[0.15em] text-text-dim">{workspaceLabel(group.kind)}</h3>
                <button type="button" onClick={() => props.onOpen(addHref(group.kind))} className="text-[10px] text-text-muted hover:text-accent">+ Add</button>
              </div>
              {group.items.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-[10px] text-text-dim">No {workspaceLabel(group.kind).toLowerCase()} in this project.</div>
              ) : (
                <div className="space-y-1">
                  {group.items.slice(0, 5).map((item) => (
                    <button type="button" key={item.id} onClick={() => props.onOpen(item.href)} className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-border hover:bg-bg-hover">
                      <WorkspaceIcon item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold text-text">{item.name}</span>
                        <span className="mt-0.5 block truncate text-[9px] text-text-dim">{item.detail}</span>
                      </span>
                      <span className={`shrink-0 text-[8px] font-bold uppercase ${workspaceStatusTone(item.status)}`}>{item.status}</span>
                    </button>
                  ))}
                  {group.items.length > 5 && (
                    <button type="button" onClick={() => props.onOpen(addHref(group.kind))} className="mt-1 flex h-8 w-full items-center justify-between rounded-md px-2.5 text-[10px] font-bold text-text-muted hover:bg-bg-hover hover:text-text">
                      <span>View all {group.items.length} {workspaceLabel(group.kind).toLowerCase()}</span>
                      <span aria-hidden="true">→</span>
                    </button>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {meaningfulActivity.length === 0 ? (
            <PanelEmpty>Tool calls and project work from Apteva Helper will appear here.</PanelEmpty>
          ) : (
            <div className="space-y-1">
              {meaningfulActivity.map((event) => (
                <div key={event.id} className="rounded-md border border-transparent px-2.5 py-2 hover:border-border hover:bg-bg-hover">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[9px] font-bold uppercase tracking-wide ${activityTone(event.type)}`}>{activityType(event.type)}</span>
                    <span className="shrink-0 text-[9px] text-text-dim">{relativeTime(event.time)}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-text-muted">{activitySummary(event)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewConversationDialog(props: { busy: boolean; onClose: () => void; onCreate: (title: string, request: string) => void }) {
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const examples = ["Create an agent", "Connect an app", "Change a behavior", "Design an automation"];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (request.trim() && !props.busy) props.onCreate(title, request);
  }
  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="New conversation">
      <button type="button" className="absolute inset-0" onClick={props.onClose} aria-label="Close new conversation" />
      <form onSubmit={submit} className="relative w-full max-w-xl rounded-lg border border-border bg-bg-card p-5 shadow-[var(--shadow-popover)]">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-base font-bold text-text">New conversation</h2><p className="mt-1 text-xs text-text-muted">A saved Channels conversation with Apteva Helper.</p></div>
          <button type="button" onClick={props.onClose} disabled={props.busy} className="h-8 w-8 rounded-md text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-40" aria-label="Close">×</button>
        </div>
        <label className="mt-5 block text-[10px] font-bold uppercase tracking-wide text-text-dim">Title <span className="font-normal normal-case tracking-normal">(optional)</span></label>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="e.g. Customer onboarding" className="mt-2 h-10 w-full rounded-md border border-border bg-bg-input px-3 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent" />
        <label className="mt-4 block text-[10px] font-bold uppercase tracking-wide text-text-dim">What should Apteva build or change?</label>
        <textarea autoFocus value={request} onChange={(event) => setRequest(event.target.value)} rows={5} placeholder="Describe the outcome, who it is for, and any limits or approvals…" className="mt-2 w-full resize-none rounded-md border border-border bg-bg-input px-3 py-2.5 text-sm leading-6 text-text outline-none placeholder:text-text-dim focus:border-accent" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examples.map((example) => <button type="button" key={example} onClick={() => setRequest(example + ": ")} className="rounded border border-border px-2 py-1 text-[9px] text-text-muted hover:border-accent/40 hover:text-text">{example}</button>)}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} disabled={props.busy} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs font-bold text-text-muted hover:bg-bg-hover hover:text-text disabled:opacity-40">Cancel</button>
          <button type="submit" disabled={!request.trim() || props.busy} className="h-9 rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">{props.busy ? "Starting…" : "Start conversation"}</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog(props: { title: string; detail: string; confirm: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="absolute inset-0 z-[85] flex items-center justify-center bg-black/65 p-4" role="alertdialog" aria-modal="true" aria-label={props.title}>
      <button type="button" className="absolute inset-0" onClick={props.onClose} aria-label="Cancel" />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-bg-card p-5 shadow-[var(--shadow-popover)]">
        <h2 className="text-base font-bold text-text">{props.title}</h2>
        <p className="mt-2 text-xs leading-5 text-text-muted">{props.detail}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="h-9 rounded-md border border-border px-3 text-xs font-bold text-text-muted hover:bg-bg-hover hover:text-text">Cancel</button>
          <button type="button" onClick={props.onConfirm} className="h-9 rounded-md border border-red/50 bg-red/10 px-3 text-xs font-bold text-red hover:bg-red/20">{props.confirm}</button>
        </div>
      </div>
    </div>
  );
}

function Drawer(props: { side: "left" | "right"; label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-[60] xl:hidden" role="dialog" aria-modal="true" aria-label={props.label}>
      <button type="button" className="absolute inset-0 bg-black/60" onClick={props.onClose} aria-label={`Close ${props.label}`} />
      <div className={`absolute inset-y-0 flex w-[min(23rem,92vw)] flex-col bg-bg shadow-[var(--shadow-popover)] ${props.side === "left" ? "left-0 border-r" : "right-0 border-l"} border-border`}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-xs font-bold text-text">{props.label}</span>
          <button type="button" onClick={props.onClose} className="h-8 w-8 rounded-md text-text-muted hover:bg-bg-hover hover:text-text" aria-label={`Close ${props.label}`}>×</button>
        </div>
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
    </div>
  );
}

function CenteredState(props: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent"><BuildIcon /></span>
        <h2 className="mt-4 text-base font-bold text-text">{props.title}</h2>
        <p className="mt-2 text-xs leading-5 text-text-muted">{props.detail}</p>
        {props.action && props.onAction && <button type="button" onClick={props.onAction} className="mt-5 h-9 rounded-md bg-accent px-4 text-xs font-bold text-bg hover:bg-accent-hover">{props.action}</button>}
      </div>
    </div>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <div className="p-5 text-center text-[10px] leading-5 text-text-dim">{children}</div>;
}

function WorkspaceIcon({ item }: { item: WorkspaceItem }) {
  const [broken, setBroken] = useState(false);
  if (item.kind === "app" && item.icon && !broken) {
    return <img src={item.icon} alt="" onError={() => setBroken(true)} className="h-7 w-7 shrink-0 rounded-md bg-bg-input object-contain p-1" />;
  }
  const label = item.kind === "agent" ? "A" : item.kind === "app" ? "◆" : "S";
  const tone = item.kind === "agent" ? "bg-accent/10 text-accent" : item.kind === "app" ? "bg-green/10 text-green" : "bg-info/10 text-info";
  return <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${tone}`}>{label}</span>;
}

function buildWorkspaceItems(agentRows: Agent[], appRows: AppRow[], skillRows: Skill[]): WorkspaceItem[] {
  return [
    ...agentRows.map((agent): WorkspaceItem => ({
      id: `agent-${agent.id}`,
      kind: "agent",
      name: agent.name,
      detail: `${agent.mode} · #${agent.id}`,
      status: agent.status || "stopped",
      href: `/agents/${agent.id}`,
    })),
    ...appRows.map((app): WorkspaceItem => ({
      id: `app-${app.install_id}`,
      kind: "app",
      name: app.display_name || app.name,
      detail: app.surfaces?.mcp_tool_count ? `${app.surfaces.mcp_tool_count} tools` : app.description || app.version,
      status: app.status,
      href: "/apps",
      icon: app.icon,
    })),
    ...skillRows.map((skill): WorkspaceItem => ({
      id: `skill-${skill.id}`,
      kind: "skill",
      name: skill.name,
      detail: skill.description || skill.source,
      status: skill.enabled ? "enabled" : "disabled",
      href: "/skills",
    })),
  ];
}

function participantIDs(row: ChatRow): number[] {
  return row.agent_ids?.length ? row.agent_ids : [row.instance_id];
}

function titleFromRequest(request: string): string {
  const clean = request.trim().replace(/^\w[\w ]{0,22}:\s*/i, "").replace(/\s+/g, " ");
  const slice = Array.from(clean).slice(0, 72).join("");
  return slice || "New build";
}

function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `build-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function timeValue(value?: string): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function relativeTime(value?: string): string {
  const stamp = timeValue(value);
  if (!stamp) return "";
  const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(stamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sortActivity(events: TelemetryEvent[]): TelemetryEvent[] {
  return [...events].sort((a, b) => timeValue(b.time) - timeValue(a.time));
}

function isNoisyActivity(type: string): boolean {
  return type.includes("chunk") || type.includes("delta") || type === "llm.token";
}

function activityType(type: string): string {
  if (type.startsWith("tool.")) return type === "tool.result" ? "Tool result" : "Tool";
  if (type.startsWith("thread.")) return "Session";
  if (type.includes("error")) return "Error";
  if (type.startsWith("llm.")) return "Thinking";
  return type.replace(/[._]/g, " ");
}

function activitySummary(event: TelemetryEvent): string {
  const data = event.data || {};
  const candidates = [data._reason, data.reason, data.message, data.text, data.summary, data.tool, data.name, data.status];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return value ? String(value) : event.type.replace(/[._]/g, " ");
}

function activityTone(type: string): string {
  if (type.includes("error") || type.includes("failed")) return "text-red";
  if (type === "tool.result" || type === "thread.done") return "text-green";
  if (type.startsWith("tool.")) return "text-accent";
  return "text-text-dim";
}

function workspaceLabel(kind: WorkspaceItemKind): string {
  return kind === "agent" ? "Agents" : kind === "app" ? "Apps" : "Skills";
}

function addHref(kind: WorkspaceItemKind): string {
  return kind === "agent" ? "/agents/new" : kind === "app" ? "/apps" : "/skills";
}

function workspaceStatusTone(status: string): string {
  const value = status.toLowerCase();
  if (["running", "enabled"].includes(value)) return "text-green";
  if (["error", "failed"].includes(value)) return "text-red";
  if (["pending"].includes(value)) return "text-accent";
  return "text-text-dim";
}

function ListIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>; }
function ProjectIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>; }
function PlusIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>; }
function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-dim" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>; }
function BuildIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v18M3 12h18" /><path d="m5 5 14 14M19 5 5 19" opacity=".35" /></svg>; }
