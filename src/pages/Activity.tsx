import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  apps,
  core,
  instances,
  integrations,
  mcpServers,
  subscriptions,
  telemetry,
  type Agent,
  type AppRow,
  type ConnectionInfo,
  type MCPServer,
  type MCPServerConfig,
  type TelemetryEvent,
  type Thread,
  type ThreadContextMessage,
  type SubscriptionInfo,
} from "../api";
import {
  type SystemMapActivity,
  type SystemMapEdge,
  type SystemMapEdgeKind,
  type SystemMapNode,
  type SystemMapNodeLatestKind,
  type SystemMapStatus,
} from "../components/system-map/SystemMap";
import { useProjects } from "../hooks/useProjects";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";
import { usePageTitle } from "../hooks/usePageTitle";

type ThreadContextSnapshot = {
  id: string;
  iteration: number;
  model: string;
  count: number;
  total_chars: number;
  messages: ThreadContextMessage[];
};

type AppBusEvent = {
  topic: string;
  app: string;
  project_id: string;
  install_id: number;
  seq: number;
  time: string;
  data: unknown;
};

type ActivityModel = {
  nodes: SystemMapNode[];
  edges: SystemMapEdge[];
  activity: SystemMapActivity[];
  stats: Array<{ label: string; value: string | number }>;
};

type AgentConfigSnapshot = {
  mcp_servers?: MCPServerConfig[];
  threads?: Thread[];
};

const hiddenSystemTools = new Set(["pace", "done", "channels_respond", "channels_status"]);

export function Activity() {
  usePageTitle("Activity");

  const { currentProject } = useProjects();
  const projectId = currentProject?.id || "";
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projectApps, setProjectApps] = useState<AppRow[]>([]);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [projectMCPServers, setProjectMCPServers] = useState<MCPServer[]>([]);
  const [projectSubscriptions, setProjectSubscriptions] = useState<SubscriptionInfo[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<Record<number, AgentConfigSnapshot>>({});
  const [threadsByAgent, setThreadsByAgent] = useState<Record<number, Thread[]>>({});
  const [contexts, setContexts] = useState<Record<string, ThreadContextSnapshot>>({});
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [appBusEvents, setAppBusEvents] = useState<AppBusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAgents([]);
    setProjectApps([]);
    setConnections([]);
    setProjectMCPServers([]);
    setProjectSubscriptions([]);
    setAgentConfigs({});
    setThreadsByAgent({});
    setContexts({});
    setEvents([]);
    setAppBusEvents([]);
    if (!projectId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let loadSeq = 0;
    const load = async (showLoading = false) => {
      const seq = ++loadSeq;
      if (showLoading) setLoading(true);
      try {
        const [nextAgents, nextApps, nextConnections, nextMCPServers, nextSubscriptions] = await Promise.all([
          instances.list(projectId),
          apps.list(projectId),
          integrations.connections(projectId),
          mcpServers.list(projectId, { includeAppOwned: true }),
          subscriptions.list(projectId),
        ]);
        if (cancelled || seq !== loadSeq) return;
        setAgents(nextAgents || []);
        setProjectApps(nextApps || []);
        setConnections(nextConnections || []);
        setProjectMCPServers(nextMCPServers || []);
        setProjectSubscriptions(nextSubscriptions || []);
        setError(null);
        setLoading(false);

        const configPairs = await Promise.all(
          (nextAgents || []).map(async (agent) => {
            const config = await withTimeout(core.config(agent.id), 2200, null);
            return [agent.id, normalizeAgentConfig(config) || normalizeAgentConfigFromRow(agent.config)] as const;
          }),
        );
        if (cancelled || seq !== loadSeq) return;
        const nextConfigs: Record<number, AgentConfigSnapshot> = {};
        configPairs.forEach(([agentID, config]) => {
          if (config) nextConfigs[agentID] = config;
        });
        setAgentConfigs(nextConfigs);

        const threadPairs = await Promise.all(
          (nextAgents || []).map(async (agent) => {
            if (agent.status !== "running") return [agent.id, [] as Thread[]] as const;
            const threads = await withTimeout(core.threads(agent.id), 2500, [] as Thread[]);
            return [agent.id, threads || []] as const;
          }),
        );
        if (cancelled || seq !== loadSeq) return;
        const nextThreads: Record<number, Thread[]> = {};
        threadPairs.forEach(([agentID, threads]) => {
          nextThreads[agentID] = threads;
        });
        setThreadsByAgent(nextThreads);

        const contextEntries = await Promise.all(
          threadPairs.flatMap(([agentID, threads]) =>
            threads.slice(0, 8).map(async (thread) => {
              const context = await withTimeout(core.threadContext(agentID, thread.id || "main"), 2500, null);
              return context ? [`${agentID}:${thread.id || "main"}`, context] as const : null;
            }),
          ),
        );
        if (cancelled || seq !== loadSeq) return;
        const nextContexts: Record<string, ThreadContextSnapshot> = {};
        contextEntries.forEach((entry) => {
          if (!entry) return;
          nextContexts[entry[0]] = {
            id: entry[1].id,
            iteration: entry[1].iteration,
            model: entry[1].model,
            count: entry[1].count,
            total_chars: entry[1].total_chars,
            messages: entry[1].messages || [],
          };
        });
        setContexts(nextContexts);

        const history = await Promise.all(
          (nextAgents || []).map((agent) =>
            withTimeout(telemetry.query(agent.id, undefined, 40), 2500, [] as TelemetryEvent[]),
          ),
        );
        if (cancelled || seq !== loadSeq) return;
        setEvents(dedupeTelemetry(history.flat().sort((a, b) => eventTime(a) - eventTime(b)).slice(-240)));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load(true);
    const timer = window.setInterval(() => {
      void load(false);
    }, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId]);

  useTelemetryEvents(projectId ? null : undefined, (event) => {
    setEvents((prev) => dedupeTelemetry([...prev, event]).slice(-240));
  });

  // Keep Activity focused on agent actions. The system map used to
  // subscribe to every running app's bus stream, which is too noisy
  // for this page and creates many server-side SSE subscriptions.
  // App bus event support stays in the model code for the map, but
  // the default Activity surface is telemetry-only for now.

  if (!projectId) {
    return (
      <div className="h-full overflow-auto p-6">
        <h1 className="text-xl font-semibold text-text">Activity</h1>
        <p className="mt-2 text-sm text-text-muted">Select a project to inspect live agents, apps, threads, and events.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text">Activity</h1>
            <span className="text-xs px-1.5 py-0.5 rounded border border-border text-text-muted">
              {currentProject?.name || projectId}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Live actions from agents, threads, app tools, telemetry, and app events.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-text-muted">
          <span className="rounded border border-border bg-bg-card px-2 py-1">agents: {agents.length}</span>
          <span className="rounded border border-border bg-bg-card px-2 py-1">apps: {projectApps.length}</span>
          <span className="rounded border border-border bg-bg-card px-2 py-1">connections: {connections.length}</span>
          <span className="rounded border border-border bg-bg-card px-2 py-1">subscriptions: {projectSubscriptions.length}</span>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 text-red-400 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <AgentActionTimeline
        agents={agents}
        events={events}
        appBusEvents={appBusEvents}
        loading={loading}
      />
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = window.setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

function normalizeAgentConfig(config: any): AgentConfigSnapshot | null {
  if (!config || typeof config !== "object") return null;
  return {
    mcp_servers: Array.isArray(config.mcp_servers) ? config.mcp_servers : undefined,
    threads: Array.isArray(config.threads) ? config.threads : undefined,
  };
}

function normalizeAgentConfigFromRow(raw: string | undefined): AgentConfigSnapshot | null {
  if (!raw) return null;
  try {
    return normalizeAgentConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

type ActionKind = "thought" | "tool" | "reply" | "thread" | "event" | "error";
type ActionStatus = "running" | "success" | "error" | "info";

type AgentAction = {
  id: string;
  time: number;
  agentId?: number;
  agentName: string;
  threadId: string;
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  detail?: string;
  args?: string;
  result?: string;
  durationMs?: number;
  raw: unknown[];
};

type ActionTab = "all" | ActionKind;

const ACTION_LIMIT = 320;

function AgentActionTimeline({
  agents,
  events,
  appBusEvents,
  loading,
}: {
  agents: Agent[];
  events: TelemetryEvent[];
  appBusEvents: AppBusEvent[];
  loading: boolean;
}) {
  const [tab, setTab] = useState<ActionTab>("all");
  const [status, setStatus] = useState<"all" | ActionStatus>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [query, setQuery] = useState("");

  const actions = useMemo(
    () => buildAgentActions(events, appBusEvents, agents),
    [events, appBusEvents, agents],
  );

  const filtered = actions.filter((action) => {
    if (tab !== "all" && action.kind !== tab) return false;
    if (status !== "all" && action.status !== status) return false;
    if (agentFilter !== "all" && String(action.agentId || action.agentName) !== agentFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [
      action.agentName,
      action.threadId,
      action.kind,
      action.status,
      action.title,
      action.detail || "",
      action.args || "",
      action.result || "",
    ].join(" ").toLowerCase().includes(q);
  });

  const tabs: ActionTab[] = ["all", "thought", "tool", "reply", "thread", "event", "error"];
  const statusOptions: Array<"all" | ActionStatus> = ["all", "running", "success", "error", "info"];
  const agentsWithEvents = agents.filter((agent) => actions.some((action) => action.agentId === agent.id));

  return (
    <div className="min-h-0 rounded border border-border bg-bg-card">
      <div className="border-b border-border px-3 py-3 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text">Agent Actions</h2>
              <span className={`h-2 w-2 rounded-full ${actions.length > 0 ? "bg-green" : "bg-text-dim"}`} />
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Live timeline from project telemetry. Rows merge streaming chunks, tool calls, and results into one action where possible.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-text-muted">
            <span className="rounded border border-border bg-bg px-2 py-1">{actions.length} actions</span>
            <span className="rounded border border-border bg-bg px-2 py-1">{actions.filter((a) => a.status === "running").length} running</span>
            <span className="rounded border border-border bg-bg px-2 py-1">{actions.filter((a) => a.status === "error").length} errors</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex max-w-full items-center gap-1 overflow-x-auto">
            {tabs.map((nextTab) => {
              const active = tab === nextTab;
              const count = nextTab === "all" ? actions.length : actions.filter((a) => a.kind === nextTab).length;
              return (
                <button
                  key={nextTab}
                  type="button"
                  onClick={() => setTab(nextTab)}
                  className={`rounded px-2 py-1 text-[11px] capitalize whitespace-nowrap ${
                    active ? "bg-bg-hover text-text" : "text-text-muted hover:text-text"
                  }`}
                >
                  {nextTab}
                  {count > 0 && <span className="ml-1 text-text-dim">{count}</span>}
                </button>
              );
            })}
          </div>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "all" | ActionStatus)}
            className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-accent"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>{option === "all" ? "all status" : option}</option>
            ))}
          </select>

          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-accent"
          >
            <option value="all">all agents</option>
            {agentsWithEvents.map((agent) => (
              <option key={agent.id} value={String(agent.id)}>{agent.name || `agent ${agent.id}`}</option>
            ))}
          </select>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions"
            className="ml-auto min-w-[160px] flex-1 sm:flex-none sm:w-64 bg-bg-input border border-border rounded px-2 py-1 text-[11px] text-text focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="max-h-[calc(100vh-260px)] min-h-[420px] overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-56 items-center justify-center px-4 text-center">
            <div>
              <div className="text-sm text-text-muted">
                {loading ? "Loading project activity..." : actions.length === 0 ? "No agent actions yet." : "No actions match the current filters."}
              </div>
              {!loading && actions.length === 0 && (
                <div className="mt-1 text-xs text-text-dim">Start or message an agent to see thoughts, tool calls, replies, and events here.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((action) => (
              <AgentActionRow key={action.id} action={action} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentActionRow({ action }: { action: AgentAction }) {
  const [open, setOpen] = useState(false);
  const visual = actionVisual(action);
  const hasDetails = !!action.args || !!action.result;
  return (
    <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="list-none cursor-pointer px-3 py-2.5 hover:bg-bg-hover">
        <div className="grid grid-cols-[70px_minmax(88px,140px)_minmax(0,1fr)_auto] items-start gap-2 text-xs">
          <div className="font-mono text-text-dim tabular-nums">{formatActionTime(action.time)}</div>
          <div className="min-w-0">
            {action.agentId ? (
              <Link
                to={`/agents/${action.agentId}`}
                className="block truncate text-text-muted hover:text-text"
                title={action.agentName}
                onClick={(e) => e.stopPropagation()}
              >
                {action.agentName}
              </Link>
            ) : (
              <span className="block truncate text-text-muted" title={action.agentName}>{action.agentName}</span>
            )}
            {action.threadId && <div className="mt-0.5 truncate font-mono text-[10px] text-text-dim">{action.threadId}</div>}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${visual.badgeClass}`}>{action.kind}</span>
              <span className={`truncate font-medium ${visual.titleClass}`}>{action.title}</span>
            </div>
            {action.detail && <div className="mt-1 truncate text-[11px] text-text-muted">{action.detail}</div>}
            {action.args && <div className="mt-1 truncate font-mono text-[10px] text-text-dim">args: {payloadPreview(action.args, 180)}</div>}
            {action.result && <div className="mt-1 truncate font-mono text-[10px] text-text-dim">result: {payloadPreview(action.result, 180)}</div>}
          </div>
          <div className="flex items-center gap-2 justify-end">
            {action.durationMs != null && <span className="hidden sm:inline text-[10px] text-text-dim tabular-nums">{durationLabel(action.durationMs)}</span>}
            <span className={`h-2 w-2 rounded-full ${visual.dotClass}`} title={action.status} />
          </div>
        </div>
      </summary>
      {open && hasDetails && (
        <div className="px-3 pb-3 pl-[calc(70px+0.75rem)]">
          <div className="space-y-2">
            {action.args && <ActionPayloadBlock title="Arguments" text={action.args} />}
            {action.result && <ActionPayloadBlock title="Result" text={action.result} />}
          </div>
        </div>
      )}
    </details>
  );
}

function ActionPayloadBlock({ title, text, dim }: { title: string; text: string; dim?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wide text-text-dim">{title}</div>
      <pre className={`max-h-64 overflow-auto rounded border border-border bg-bg-input p-2 text-[10px] ${dim ? "text-text-muted" : "text-text"}`}>
        {text}
      </pre>
    </div>
  );
}

function buildAgentActions(events: TelemetryEvent[], appBusEvents: AppBusEvent[], agents: Agent[]): AgentAction[] {
  const agentNameByID = new Map(agents.map((agent) => [agent.id, agent.name || `agent ${agent.id}`]));
  const rows = new Map<string, AgentAction>();
  const order: string[] = [];
  const activeThoughtByThread = new Map<string, string>();
  const thoughtBuffers = new Map<string, { thinking: string; output: string }>();

  const put = (key: string, patch: Omit<Partial<AgentAction>, "id" | "raw"> & { id?: string; raw?: unknown }) => {
    const current = rows.get(key);
    if (!current) {
      const row: AgentAction = {
        id: patch.id || key,
        time: patch.time || Date.now(),
        agentId: patch.agentId,
        agentName: patch.agentName || (patch.agentId ? agentNameByID.get(patch.agentId) || `agent ${patch.agentId}` : "system"),
        threadId: patch.threadId || "",
        kind: patch.kind || "event",
        status: patch.status || "info",
        title: patch.title || "event",
        detail: patch.detail,
        args: patch.args,
        result: patch.result,
        durationMs: patch.durationMs,
        raw: patch.raw !== undefined ? [patch.raw] : [],
      };
      rows.set(key, row);
      order.push(key);
      return;
    }
    rows.set(key, {
      ...current,
      ...patch,
      id: current.id,
      time: Math.max(current.time, patch.time || current.time),
      agentName: patch.agentName || current.agentName,
      raw: patch.raw !== undefined ? [...current.raw, patch.raw].slice(-8) : current.raw,
    });
  };

  [...events].sort((a, b) => eventTime(a) - eventTime(b)).forEach((event) => {
    const data = event.data || {};
    const time = eventTime(event);
    const agentId = event.instance_id;
    const agentName = agentNameByID.get(agentId) || `agent ${agentId}`;
    const threadId = event.thread_id || "main";
    const iteration = data.iteration != null ? String(data.iteration) : "";
    const threadKey = `${agentId}:${threadId}`;

    if (event.type === "llm.start") {
      const key = actionThoughtKey(agentId, threadId, iteration || event.id || String(time));
      activeThoughtByThread.set(threadKey, key);
      if (!thoughtBuffers.has(key)) thoughtBuffers.set(key, { thinking: "", output: "" });
      put(key, {
        agentId, agentName, threadId, time,
        kind: "thought", status: "running",
        title: "Thinking",
        detail: compactActionText(data.model || data.provider || ""),
        raw: event,
      });
      return;
    }

    if (event.type === "llm.thinking" || event.type === "llm.chunk") {
      const key = iteration
        ? actionThoughtKey(agentId, threadId, iteration)
        : activeThoughtByThread.get(threadKey) || actionThoughtKey(agentId, threadId, "live");
      activeThoughtByThread.set(threadKey, key);
      const text = compactActionText(data.text || data.chunk || "");
      const buffer = appendThoughtChunk(thoughtBuffers, key, event.type === "llm.thinking" ? "thinking" : "output", String(data.text || data.chunk || ""));
      const preview = thoughtPreview(buffer);
      put(key, {
        agentId, agentName, threadId, time,
        kind: "thought", status: "running",
        title: buffer.output ? "Composing output" : "Thinking",
        detail: preview || (text ? shortText(text, 240) : undefined),
        result: formatThoughtBuffer(buffer),
      });
      return;
    }

    if (event.type === "llm.done") {
      const key = iteration
        ? actionThoughtKey(agentId, threadId, iteration)
        : activeThoughtByThread.get(threadKey) || actionThoughtKey(agentId, threadId, event.id || String(time));
      const tokens = formatTokenSummary(data);
      const message = compactActionText(data.message || data.summary || data.model || "");
      const buffer = thoughtBuffers.get(key) || { thinking: "", output: "" };
      if (!buffer.output && message) buffer.output = message;
      thoughtBuffers.set(key, buffer);
      activeThoughtByThread.delete(threadKey);
      put(key, {
        agentId, agentName, threadId, time,
        kind: "thought", status: "success",
        title: "Reasoning step",
        detail: [message ? shortText(message, 260) : thoughtPreview(buffer), tokens].filter(Boolean).join(" - "),
        result: formatThoughtBuffer(buffer),
        durationMs: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
        raw: event,
      });
      return;
    }

    if (event.type === "llm.error" || event.type === "error") {
      put(`error:${agentId}:${threadId}:${event.id || time}`, {
        agentId, agentName, threadId, time,
        kind: "error", status: "error",
        title: event.type === "llm.error" ? "LLM error" : "Error",
        detail: compactActionText(data.error || data.message || ""),
        raw: event,
      });
      return;
    }

    if (event.type === "llm.tool_chunk") {
      const tool = String(data.tool || data.name || "");
      if (isHiddenActionTool(tool) && tool !== "channels_respond") return;
      const callID = actionCallID(data, event);
      const key = `tool:${agentId}:${threadId}:${callID}`;
      const chunk = String(data.chunk || data.delta || data.text || "");
      if (tool === "channels_respond") {
        const replyText = extractTextFieldFromJSONish(chunk);
        put(key, {
          agentId, agentName, threadId, time,
          kind: "reply", status: "running",
          title: "Drafting chat reply",
          detail: replyText ? shortText(replyText, 240) : "channels_respond",
          args: chunk ? formatActionPayload(chunk, 4000) : undefined,
        });
        return;
      }
      put(key, {
        agentId, agentName, threadId, time,
        kind: "tool", status: "running",
        title: `Preparing ${shortToolName(tool || "tool")}`,
        detail: tool || undefined,
        args: chunk ? formatActionPayload(chunk, 4000) : undefined,
      });
      return;
    }

    if (event.type === "tool.call") {
      const tool = String(data.name || data.tool || "");
      if (isHiddenActionTool(tool) && tool !== "channels_respond") return;
      const callID = actionCallID(data, event);
      const key = `tool:${agentId}:${threadId}:${callID}`;
      const argsValue = actionArgsValue(data);
      const args = formatActionPayload(argsValue, 5000);
      const reason = compactActionText(data.reason || "");
      if (tool === "channels_respond") {
        const replyText = respondText(argsValue);
        put(key, {
          agentId, agentName, threadId, time,
          kind: "reply", status: "running",
          title: "Replying in chat",
          detail: replyText ? shortText(replyText, 260) : reason || "chat",
          args,
          raw: event,
        });
        return;
      }
      put(key, {
        agentId, agentName, threadId, time,
        kind: "tool", status: "running",
        title: reason || `Running ${shortToolName(tool || "tool")}`,
        detail: tool || undefined,
        args,
        raw: event,
      });
      return;
    }

    if (event.type === "tool.result") {
      const tool = String(data.name || data.tool || "");
      if (isHiddenActionTool(tool) && tool !== "channels_respond") return;
      const callID = actionCallID(data, event);
      const key = `tool:${agentId}:${threadId}:${callID}`;
      const failed = !!data.is_error || data.success === false;
      const result = formatActionPayload(actionResultValue(data), 5000);
      put(key, {
        agentId, agentName, threadId, time,
        kind: tool === "channels_respond" ? "reply" : "tool",
        status: failed ? "error" : "success",
        title: tool === "channels_respond" ? "Chat reply delivered" : `${shortToolName(tool || "tool")} ${failed ? "failed" : "completed"}`,
        detail: failed ? compactActionText(data.error || data.message || "failed") : tool || "completed",
        result,
        durationMs: typeof data.duration_ms === "number" ? data.duration_ms : undefined,
        raw: event,
      });
      return;
    }

    if (event.type === "thread.spawn") {
      const spawned = String(data.thread_id || data.id || data.name || "");
      put(`thread:${agentId}:${threadId}:spawn:${spawned || event.id || time}`, {
        agentId, agentName, threadId, time,
        kind: "thread", status: "running",
        title: spawned ? `Spawned ${spawned}` : "Spawned thread",
        detail: compactActionText(data.directive || data.prompt || ""),
        raw: event,
      });
      return;
    }

    if (event.type === "thread.message") {
      put(`thread:${agentId}:${threadId}:message:${event.id || time}`, {
        agentId, agentName, threadId, time,
        kind: "thread", status: "info",
        title: "Thread message",
        detail: compactActionText(data.message || data.text || ""),
        raw: event,
      });
      return;
    }

    if (event.type === "thread.done") {
      put(`thread:${agentId}:${threadId}:done:${event.id || time}`, {
        agentId, agentName, threadId, time,
        kind: "thread", status: "success",
        title: "Thread done",
        detail: compactActionText(data.result || data.message || threadId),
        raw: event,
      });
      return;
    }

    if (event.type === "event.received") {
      put(`event:${agentId}:${threadId}:${event.id || time}`, {
        agentId, agentName, threadId, time,
        kind: "event", status: "info",
        title: compactActionText(data.source || "Incoming event"),
        detail: compactActionText(data.message || data.text || data.event || ""),
        raw: event,
      });
    }
  });

  appBusEvents.forEach((event) => {
    const time = Date.parse(event.time) || Date.now();
    put(`app-event:${event.app}:${event.project_id}:${event.seq}:${event.topic}`, {
      agentName: event.app,
      threadId: "app bus",
      time,
      kind: "event",
      status: "info",
      title: event.topic || "app event",
      detail: shortText(summarizeValue(event.data), 240),
      result: formatActionPayload(event.data, 5000),
      raw: event,
    });
  });

  return order
    .map((key) => rows.get(key))
    .filter((row): row is AgentAction => !!row)
    .sort((a, b) => b.time - a.time)
    .slice(0, ACTION_LIMIT);
}

function actionVisual(action: AgentAction): { badgeClass: string; titleClass: string; dotClass: string } {
  if (action.status === "error") {
    return { badgeClass: "bg-red/10 text-red", titleClass: "text-red", dotClass: "bg-red" };
  }
  if (action.status === "running") {
    return { badgeClass: "bg-yellow/10 text-yellow", titleClass: "text-text", dotClass: "bg-yellow animate-pulse" };
  }
  if (action.kind === "reply") {
    return { badgeClass: "bg-green/10 text-green", titleClass: "text-text", dotClass: "bg-green" };
  }
  if (action.kind === "thought") {
    return { badgeClass: "bg-accent/10 text-accent", titleClass: "text-text", dotClass: "bg-accent" };
  }
  if (action.kind === "event") {
    return { badgeClass: "bg-blue/10 text-blue", titleClass: "text-text", dotClass: "bg-blue" };
  }
  return { badgeClass: "bg-bg-hover text-text-muted", titleClass: "text-text", dotClass: "bg-green" };
}

function formatActionTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function compactActionText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function durationLabel(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function payloadPreview(text: string, max: number): string {
  const sample = text.length > max * 4 ? text.slice(0, max * 4) : text;
  const compact = sample.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}...` : compact;
}

function isHiddenActionTool(tool: string): boolean {
  const normalized = String(tool || "").trim().toLowerCase();
  return normalized === "pace" || normalized === "done" || normalized === "channels_status";
}

function actionCallID(data: Record<string, any>, event: TelemetryEvent): string {
  return String(data.id || data.call_id || data.tool_call_id || data.index || event.id || `${event.type}:${event.time}`);
}

function actionThoughtKey(agentId: number, threadId: string, suffix: string): string {
  return `thought:${agentId}:${threadId}:${suffix}`;
}

function appendThoughtChunk(
  buffers: Map<string, { thinking: string; output: string }>,
  key: string,
  field: "thinking" | "output",
  chunk: string,
): { thinking: string; output: string } {
  const current = buffers.get(key) || { thinking: "", output: "" };
  if (chunk) {
    current[field] += chunk;
    buffers.set(key, current);
  }
  return current;
}

function thoughtPreview(buffer: { thinking: string; output: string }): string {
  const source = buffer.output || buffer.thinking;
  return source ? shortText(compactActionText(source), 260) : "";
}

function formatThoughtBuffer(buffer: { thinking: string; output: string }): string {
  const parts: string[] = [];
  if (buffer.thinking.trim()) parts.push(`Thinking\n${buffer.thinking.trim()}`);
  if (buffer.output.trim()) parts.push(`Output\n${buffer.output.trim()}`);
  return parts.join("\n\n");
}

function actionArgsValue(data: Record<string, any>): unknown {
  if ("args" in data) return data.args;
  if ("arguments" in data) return data.arguments;
  if ("input" in data) return data.input;
  if ("params" in data) return data.params;
  return undefined;
}

function actionResultValue(data: Record<string, any>): unknown {
  if ("result" in data) return data.result;
  if ("output" in data) return data.output;
  if ("error" in data) return data.error;
  if ("message" in data) return data.message;
  return undefined;
}

function respondText(value: unknown): string {
  const parsed = parseActionJSON(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return compactActionText((parsed as Record<string, unknown>).text);
  }
  return "";
}

function parseActionJSON(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function formatActionPayload(value: unknown, max = 5000): string {
  if (value === undefined) return "";
  const sanitized = sanitizeActionPayload(value);
  let text: string;
  if (typeof sanitized === "string") {
    text = sanitized;
  } else {
    try {
      text = JSON.stringify(sanitized, null, 2);
    } catch {
      text = String(sanitized);
    }
  }
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length.toLocaleString()} chars total)` : text;
}

function sanitizeActionPayload(value: unknown, depth = 0): unknown {
  const parsed = parseActionJSON(value);
  if (parsed == null) return parsed;
  if (typeof parsed === "string") {
    return parsed.length > 600 ? `${parsed.slice(0, 600)}... (${parsed.length.toLocaleString()} chars)` : parsed;
  }
  if (typeof parsed !== "object") return parsed;
  if (depth > 5) return "[nested object]";
  if (Array.isArray(parsed)) {
    const items = parsed.slice(0, 20).map((item) => sanitizeActionPayload(item, depth + 1));
    return parsed.length > 20 ? [...items, `... ${parsed.length - 20} more items`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (lower.includes("base64") || lower.includes("screenshot") || lower.includes("image") || lower.includes("audio") || lower.includes("blob")) {
      out[key] = typeof val === "string" ? `[${val.length.toLocaleString()} chars omitted]` : sanitizeActionPayload(val, depth + 1);
      continue;
    }
    out[key] = sanitizeActionPayload(val, depth + 1);
  }
  return out;
}

function extractTextFieldFromJSONish(raw: string): string {
  if (!raw) return "";
  const parsed = parseActionJSON(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return compactActionText((parsed as Record<string, unknown>).text);
  }
  const match = raw.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)/s);
  if (!match) return "";
  return match[1]
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function formatTokenSummary(data: Record<string, any>): string {
  const input = data.tokens_in ?? data.prompt_tokens;
  const output = data.tokens_out ?? data.completion_tokens;
  const cost = typeof data.cost_usd === "number" ? `$${data.cost_usd.toFixed(4)}` : "";
  const tokens = input != null || output != null ? `${input ?? 0} in / ${output ?? 0} out` : "";
  return [tokens, cost].filter(Boolean).join(" ");
}

function buildProjectActivityModel(
  projectLabel: string,
  agents: Agent[],
  projectApps: AppRow[],
  connections: ConnectionInfo[],
  projectMCPServers: MCPServer[],
  projectSubscriptions: SubscriptionInfo[],
  agentConfigs: Record<number, AgentConfigSnapshot>,
  threadsByAgent: Record<number, Thread[]>,
  contexts: Record<string, ThreadContextSnapshot>,
  events: TelemetryEvent[],
  appBusEvents: AppBusEvent[],
): ActivityModel {
  const nodes = new Map<string, SystemMapNode>();
  const edges = new Map<string, SystemMapEdge>();
  const activity: SystemMapActivity[] = [];
  const appNames = projectApps.map((app) => app.name);
  const appByName = new Map(projectApps.map((app) => [app.name, app]));
  const agentsByID = new Map(agents.map((agent) => [agent.id, agent]));
  const mcpByID = new Map(projectMCPServers.map((server) => [server.id, server]));
  const streamingToolByCall = new Map<string, string>();
  const threadStreamText = new Map<string, string>();

  const addNode = (node: SystemMapNode) => {
    const current = nodes.get(node.id);
    if (!current) {
      nodes.set(node.id, node);
      return;
    }
    const currentActiveAt = current.lastActiveAt || 0;
    const nodeActiveAt = node.lastActiveAt || 0;
    nodes.set(node.id, {
      ...current,
      ...node,
      badges: mergeBadges(current.badges, node.badges),
      latest: latestNodeActivity(current.latest, node.latest),
      activeKind: nodeActiveAt >= currentActiveAt ? node.activeKind || current.activeKind : current.activeKind,
      lastActiveAt: Math.max(currentActiveAt, nodeActiveAt) || undefined,
    });
  };
  const touchNodeActivity = (id: string, activeKind: SystemMapEdgeKind, time: number) => {
    const current = nodes.get(id);
    if (!current) return;
    nodes.set(id, {
      ...current,
      status: current.kind === "thread" ? "running" : current.status,
      activeKind,
      lastActiveAt: Math.max(current.lastActiveAt || 0, time),
    });
  };
  const setThreadLatest = (id: string, kind: SystemMapNodeLatestKind, text: string, time: number) => {
    const current = nodes.get(id);
    if (!current) return;
    const compact = shortText(text, 58);
    if (!compact) return;
    nodes.set(id, {
      ...current,
      latest: latestNodeActivity(current.latest, { kind, text: compact, time }),
    });
  };
  const appendThreadStream = (id: string, kind: Extract<SystemMapNodeLatestKind, "thinking" | "message">, data: Record<string, unknown>, time: number) => {
    const text = String(data.text || "");
    if (!text) return;
    const streamKey = `${id}:${kind}:${String(data.iteration || data.id || data.call_id || "latest")}`;
    const next = `${threadStreamText.get(streamKey) || ""}${text}`.slice(-1000);
    threadStreamText.set(streamKey, next);
    setThreadLatest(id, kind, next, time);
  };
  const addEdge = (edge: SystemMapEdge) => {
    const current = edges.get(edge.id);
    if (!current) {
      edges.set(edge.id, edge);
      return;
    }
    edges.set(edge.id, {
      ...current,
      kind:
        (edge.lastActiveAt || edge.softActiveAt || 0) >= (current.lastActiveAt || current.softActiveAt || 0) &&
        (edge.lastActiveAt || edge.softActiveAt)
          ? edge.kind
          : current.kind,
      count: Math.max(current.count || 0, edge.count || 0),
      lastActiveAt: Math.max(current.lastActiveAt || 0, edge.lastActiveAt || 0) || undefined,
      softActiveAt: Math.max(current.softActiveAt || 0, edge.softActiveAt || 0) || undefined,
      packetDirection:
        (edge.lastActiveAt || 0) >= (current.lastActiveAt || 0)
          ? edge.packetDirection || current.packetDirection
          : current.packetDirection,
      label: edge.label || current.label,
      status: edge.status || current.status,
      detail: edge.detail || current.detail,
    });
  };

  projectApps.forEach((app, index) => {
    addNode({
      id: appNodeID(app.name),
      kind: "app",
      label: app.display_name || app.name,
      status: appStatus(app),
      subtitle: `${app.name} #${app.install_id}`,
      detail: app.description || "",
      iconUrl: app.icon || undefined,
      ...appSlot(index, Math.max(1, projectApps.length), agents.length > 0),
    });
  });

  projectApps.forEach((app) => {
    (app.surfaces?.required_apps || []).forEach((dep) => {
      const depName = dep.name;
      if (!depName || depName === app.name || !appByName.has(depName)) return;
      addEdge({
        id: `appdep:${appNodeID(app.name)}:${appNodeID(depName)}`,
        source: appNodeID(app.name),
        target: appNodeID(depName),
        kind: "dependency",
        status: "ok",
        label: dep.reason ? shortText(dep.reason, 32) : "requires",
        detail: `${app.name} requires ${depName}${dep.reason ? `\n${dep.reason}` : ""}`,
      });
    });
  });

  connections.forEach((conn, index) => {
    const id = connectionNodeID(conn.id);
    addNode({
      id,
      kind: "external",
      label: conn.name || conn.app_name || conn.app_slug,
      status: conn.status === "disabled" ? "warning" : "ok",
      subtitle: conn.created_via === "app_install" ? "app-owned connection" : "connection",
      detail: `${conn.app_slug} #${conn.id}`,
      iconUrl: connectionIconUrl(conn),
      ...connectionSlot(index, connections.length),
    });
  });

  agents.forEach((agent, index) => {
    const configuredMCPs = configuredMCPServers(agentConfigs[agent.id]);
    const configuredThreads = agentConfigs[agent.id]?.threads || [];
    const agentThreads = (threadsByAgent[agent.id] || []).length > 0 ? threadsByAgent[agent.id] : configuredThreads;
    const configuredMCPsForEdges = agentThreads.length > 0 ? [] : configuredMCPs;
    const agentID = agentNodeID(agent.id);
    addNode({
      id: agentID,
      kind: "agent",
      label: agent.name || `Agent ${agent.id}`,
      status: agent.status === "running" ? "running" : agent.status === "error" ? "error" : "idle",
      subtitle: `${agent.mode || "agent"} #${agent.id}`,
      detail: agent.directive || "",
      ...agentSlot(index, Math.max(1, agents.length)),
    });

    const renderedThreads = agentThreads.length > 0
      ? agentThreads
      : configuredMCPsForEdges.length > 0
        ? [configuredMainThread()]
        : [];

    renderedThreads.forEach((thread, threadIndex) => {
      const threadID = threadNodeID(agent.id, thread.id || "main");
      addNode({
        id: threadID,
        kind: "thread",
        label: thread.name || thread.id || "main",
        status: thread.rate === "sleep" || thread.rate?.includes("h") ? "idle" : "running",
        subtitle: `${thread.model || "model"} - ${thread.rate || "active"}`,
        detail: thread.directive || "",
        ...threadSlot(index, agents.length, threadIndex, agentThreads.length),
      });
      addEdge({
        id: `owns:${agentID}:${threadID}`,
        source: agentID,
        target: threadID,
        kind: "owns",
        label: "thread",
        status: "ok",
      });
      const threadTools = new Set([...(thread.mcp_names || []), ...(thread.tools || [])]);
      configuredMCPsForEdges.forEach((server) => threadTools.add(server.name || ""));
      threadTools.forEach((name) => {
        if (isHiddenSystemTool(name)) return;
        const targetInfo = targetForMCP(name, undefined, appNames, connections, mcpByID);
        const target = targetInfo?.id || "";
        if (!target) return;
        addEdge({
          id: `mcp:${threadID}:${target}`,
          source: threadID,
          target,
          kind: "tool",
          label: `${targetInfo?.label || name} MCP`,
          status: "ok",
        });
      });
      configuredMCPsForEdges.forEach((server) => {
        if (!server.name || isHiddenSystemTool(server.name)) return;
        const targetInfo = targetForMCP(server.name, server.url, appNames, connections, mcpByID);
        if (!targetInfo?.id) return;
        addEdge({
          id: `mcp:${threadID}:${targetInfo.id}`,
          source: threadID,
          target: targetInfo.id,
          kind: "tool",
          label: `${targetInfo.label} MCP`,
          status: "ok",
          detail: server.url || server.name,
        });
      });
    });
  });

	  projectSubscriptions.forEach((sub, index) => {
	    const sourceID = subscriptionSourceID(sub);
	    const targetThread = threadNodeID(sub.instance_id, sub.thread_id || "main");
	    const badge = `sub ${shortText(subscriptionLabel(sub), 18)}`;
	    if (sub.source === "app_event") {
	      const parsed = parseAppEventSlug(sub.slug);
	      if (parsed && appNames.includes(parsed.app)) {
	        const app = appByName.get(parsed.app);
	        addNode({
	          id: sourceID,
	          kind: "app",
	          label: app?.display_name || parsed.app,
	          status: app ? appStatus(app) : "unknown",
	          subtitle: app ? `${app.name} #${app.install_id}` : parsed.app,
	          badges: [badge],
	        });
	      }
	    } else if (sub.connection_id) {
	      const conn = connections.find((item) => item.id === sub.connection_id);
	      addNode({
	        id: sourceID,
	        kind: "external",
	        label: conn?.name || conn?.app_name || conn?.app_slug || sub.name || "webhook",
	        status: conn?.status === "disabled" ? "warning" : "ok",
	        subtitle: conn?.created_via === "app_install" ? "app-owned connection" : "connection",
	        iconUrl: conn ? connectionIconUrl(conn) : undefined,
	        badges: [badge],
	      });
	    } else {
	      addNode({ id: sourceID, kind: "event", label: "events", status: "running", subtitle: "incoming", badges: [badge], x: 18, y: 50 });
	    }
	    if (!agentsByID.has(sub.instance_id)) return;
	    if (!nodes.has(targetThread)) {
	      const agentIndex = Math.max(0, agents.findIndex((agent) => agent.id === sub.instance_id));
	      addNode({
	        id: targetThread,
	        kind: "thread",
	        label: sub.thread_id || "main",
	        status: "idle",
	        subtitle: "subscribed",
	        ...threadSlot(agentIndex, Math.max(1, agents.length), index, Math.max(1, projectSubscriptions.length)),
	      });
	      addEdge({
	        id: `owns:${agentNodeID(sub.instance_id)}:${targetThread}`,
	        source: agentNodeID(sub.instance_id),
	        target: targetThread,
	        kind: "owns",
	        label: "thread",
	        status: "ok",
	      });
	    }
	    addEdge({
	      id: subscriptionEdgeID(sourceID, targetThread, sub),
	      source: sourceID,
	      target: targetThread,
	      kind: "event",
	      status: sub.enabled ? "ok" : "warning",
	      label: subscriptionLabel(sub),
	      detail: `${sub.name || sub.slug} wakes ${agentsByID.get(sub.instance_id)?.name || sub.instance_id}/${sub.thread_id || "main"}`,
	    });
	  });

	  Object.entries(contexts).forEach(([key, context]) => {
    const [agentID] = key.split(":");
    const source = threadNodeID(Number(agentID), context.id || "main");
    context.messages.forEach((message) => {
      (message.tool_calls || []).forEach((call) => {
        const tool = call.name || "";
        if (isHiddenSystemTool(tool)) return;
        const app = appForTool(tool, appNames);
        const connection = connectionForTool(tool, connections);
        const target = app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : "";
        if (!target) return;
        addEdge({
          id: `tool:${source}:${target}`,
          source,
          target,
          kind: "tool",
          label: tool,
          status: "ok",
          count: 1,
          detail: `${tool}\n${shortText(summarizeValue(call.arguments), 320)}`,
        });
      });
    });
  });

  [...events]
    .sort((a, b) => eventTime(a) - eventTime(b))
    .forEach((event) => {
      const time = eventTime(event);
      const threadID = threadNodeID(event.instance_id, event.thread_id || "main");
      const data = event.data || {};
      if (!nodes.has(threadID)) {
        addNode({
          id: threadID,
          kind: "thread",
          label: event.thread_id || "main",
          status: "running",
          subtitle: "live",
          ...threadSlot(0, 1, 0, 1),
        });
      }
      touchNodeActivity(threadID, telemetryActivityKind(event.type), time);

      if (event.type === "thread.spawn") {
        const spawned = String(data.thread_id || data.id || data.name || data.to || "");
        if (spawned) {
          const target = threadNodeID(event.instance_id, spawned);
          addNode({
            id: target,
            kind: "thread",
            label: spawned,
            status: "running",
            subtitle: "spawned",
            detail: String(data.directive || ""),
          });
          touchNodeActivity(target, "message", time);
          setThreadLatest(threadID, "message", `spawned ${spawned}`, time);
          addEdge({
            id: `spawn:${threadID}:${target}`,
            source: threadID,
            target,
            kind: "message",
            status: "running",
            label: "spawn",
            lastActiveAt: time,
          });
        }
      }

      if (event.type === "event.received") {
        const snippet = eventSnippet(data);
        setThreadLatest(threadID, "event", snippet || "incoming event", time);
        const routed = subscriptionForDeliveredEvent(event, projectSubscriptions);
        if (routed) {
          const sourceID = subscriptionSourceID(routed);
          touchNodeActivity(sourceID, "event", time);
          addEdge({
            id: subscriptionEdgeID(sourceID, threadID, routed),
            source: sourceID,
            target: threadID,
            kind: "event",
            status: "running",
            label: snippet || subscriptionLabel(routed),
            lastActiveAt: time,
            detail: snippet ? `${routed.slug}\n${snippet}` : routed.slug,
          });
        } else {
          addNode({ id: "external:events", kind: "event", label: "events", status: "running", subtitle: "incoming", x: 18, y: 50 });
          addEdge({
            id: `event:external:events:${threadID}`,
            source: "external:events",
            target: threadID,
            kind: "event",
            status: "running",
            label: snippet || "event",
            lastActiveAt: time,
            detail: snippet ? `event\n${snippet}` : "event",
          });
        }
      }

      if (event.type === "tool.call" || event.type === "tool.result") {
        const tool = String(data.name || data.tool || "");
        if (isHiddenSystemTool(tool)) {
          const item = activityFromTelemetry(event, appNames, connections);
          if (item) activity.push(item);
          return;
        }
        const app = appForTool(tool, appNames);
        const connection = connectionForTool(tool, connections);
        const target = app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : "";
        const isResult = event.type === "tool.result";
        setThreadLatest(
          threadID,
          isResult ? (data.is_error ? "error" : "result") : "tool",
          isResult ? (data.is_error ? `${shortToolName(tool)} failed` : `${shortToolName(tool)} ok`) : shortToolName(tool),
          time,
        );
        if (target) {
          addEdge({
            id: `tool:${threadID}:${target}`,
            source: threadID,
            target,
            kind: "tool",
            status: isResult && data.is_error ? "error" : "running",
            label: isResult ? `${tool} result` : tool,
            count: (edges.get(`tool:${threadID}:${target}`)?.count || 0) + 1,
            lastActiveAt: time,
            packetDirection: isResult ? "reverse" : "forward",
            detail: isResult ? `${tool} result` : tool,
          });
        }
      }

      if (event.type === "llm.tool_chunk") {
        const key = toolChunkKey(threadID, data);
        const detectedTool = toolNameFromTelemetry(data, appNames, connections);
        const tool = detectedTool || streamingToolByCall.get(key) || "";
        if (isHiddenSystemTool(tool)) {
          const item = activityFromTelemetry(event, appNames, connections);
          if (item) activity.push(item);
          return;
        }
        if (detectedTool) streamingToolByCall.set(key, detectedTool);
        setThreadLatest(threadID, "tool", tool ? `preparing ${shortToolName(tool)}` : "preparing tool call", time);
        const app = appForTool(tool, appNames);
        const connection = connectionForTool(tool, connections);
        const target = app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : "";
        if (target) {
          addEdge({
            id: `tool:${threadID}:${target}`,
            source: threadID,
            target,
            kind: "tool",
            status: "running",
            label: tool,
            softActiveAt: time,
            detail: tool ? `preparing ${tool}` : "preparing tool call",
          });
        }
      }

      if (event.type === "llm.start") setThreadLatest(threadID, "thinking", "thinking", time);
      if (event.type === "llm.thinking" && data.text) appendThreadStream(threadID, "thinking", data, time);
      if (event.type === "llm.chunk" && data.text) appendThreadStream(threadID, "message", data, time);
      if (event.type === "llm.done") {
        const finalMessage = String(data.message || data.summary || "");
        if (finalMessage) setThreadLatest(threadID, "message", finalMessage, time);
      }
      if (event.type === "llm.error") setThreadLatest(threadID, "error", String(data.error || data.message || "LLM error"), time);
      if (event.type === "thread.message") setThreadLatest(threadID, "message", String(data.message || data.text || "thread message"), time);

      const item = activityFromTelemetry(event, appNames, connections);
      if (item) activity.push(item);
    });

  const appNamesByInstallID = new Map(projectApps.map((app) => [app.install_id, app.name]));
  [...appBusEvents]
    .sort((a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0))
    .forEach((event) => {
      const sourceName = event.app;
      if (!sourceName || !appNames.includes(sourceName)) return;
      const time = Date.parse(event.time) || Date.now();
      const sourceID = appNodeID(sourceName);
      touchNodeActivity(sourceID, "event", time);
      projectSubscriptions
        .filter((sub) => {
          if (sub.source !== "app_event") return false;
          const parsed = parseAppEventSlug(sub.slug);
          return !!parsed && parsed.app === sourceName && subscriptionTopicMatches(sub, parsed.topic, event.topic || "");
        })
        .forEach((sub) => {
          const targetThread = threadNodeID(sub.instance_id, sub.thread_id || "main");
          const edgeID = subscriptionEdgeID(sourceID, targetThread, sub);
          addEdge({
            id: edgeID,
            source: sourceID,
            target: targetThread,
            kind: "event",
            status: "running",
            label: event.topic || subscriptionLabel(sub),
            count: (edges.get(edgeID)?.count || 0) + 1,
            lastActiveAt: time,
            detail: appBusEventDetail(event),
          });
        });
      const dependents = projectApps.filter((app) =>
        (app.surfaces?.required_apps || []).some((dep) => dep.name === sourceName || appNamesByInstallID.get(Number(event.install_id)) === dep.name),
      );
      const detail = appBusEventDetail(event);
      if (dependents.length === 0) {
        activity.push({
          id: `appbus:${event.app}:${event.seq}`,
          time,
          source: sourceID,
          label: event.topic || "app event",
          detail,
          status: "ok",
        });
        return;
      }
      dependents.forEach((targetApp) => {
        const targetID = appNodeID(targetApp.name);
        touchNodeActivity(targetID, "event", time);
        const edgeID = `appdep:${targetID}:${sourceID}`;
        addEdge({
          id: edgeID,
          source: targetID,
          target: sourceID,
          kind: "event",
          status: "running",
          label: event.topic || "app event",
          count: (edges.get(edgeID)?.count || 0) + 1,
          lastActiveAt: time,
          packetDirection: "reverse",
          detail,
        });
        activity.push({
          id: `appbus:${event.app}:${event.seq}:${targetApp.name}`,
          time,
          source: sourceID,
          target: targetID,
          label: event.topic || "app event",
          detail,
          status: "ok",
        });
      });
    });

  const visible = pruneDenseIsolatedTopology(Array.from(nodes.values()), Array.from(edges.values()));

  return {
    nodes: visible.nodes,
    edges: visible.edges,
    activity: activity.sort((a, b) => a.time - b.time).slice(-100),
    stats: [
      { label: "project", value: projectLabel || "project" },
      { label: "agents", value: agents.length },
      { label: "apps", value: visible.visibleApps === projectApps.length ? projectApps.length : `${visible.visibleApps}/${projectApps.length}` },
      { label: "threads", value: Object.values(threadsByAgent).reduce((n, list) => n + list.length, 0) },
      { label: "connections", value: visible.visibleConnections === connections.length ? connections.length : `${visible.visibleConnections}/${connections.length}` },
	      { label: "subscriptions", value: projectSubscriptions.length },
	      { label: "events", value: events.length + appBusEvents.length },
    ],
  };
}

function appSlot(index: number, total: number, hasAgents: boolean) {
  if (!hasAgents && total <= 1) return { x: 38, y: 43 };
  if (!hasAgents) return gridSlot(index, total, 16, 84, 36, 10, 7);
  if (total <= 1) return { x: 30, y: 76 };
  return gridSlot(index, total, 14, 86, 58, 9, 7);
}

function agentSlot(index: number, total: number) {
  if (total <= 1) return { x: 57, y: 34 };
  return gridSlot(index, total, 20, 80, 25, 18, 4);
}

function gridSlot(index: number, total: number, leftX: number, rightX: number, startY: number, rowStep: number, maxColumns: number) {
  if (total <= 1) return { x: (leftX + rightX) / 2, y: startY };
  const columns = layoutColumns(total, maxColumns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  const rowItems = Math.min(columns, total - row * columns);
  const rowLeft = rowItems === columns ? leftX : leftX + ((columns - rowItems) * (rightX - leftX)) / Math.max(1, columns - 1) / 2;
  const rowRight = rowItems === columns ? rightX : rightX - ((columns - rowItems) * (rightX - leftX)) / Math.max(1, columns - 1) / 2;
  const x = rowItems <= 1 ? (leftX + rightX) / 2 : rowLeft + (col * (rowRight - rowLeft)) / Math.max(1, rowItems - 1);
  const y = startY + row * rowStep;
  return { x, y };
}

function connectionSlot(index: number, total: number) {
  if (total <= 1) return { x: 114, y: 48 };
  const span = Math.min(96, Math.max(34, (total - 1) * 8));
  const start = Math.max(10, 50 - span / 2);
  return { x: 114, y: start + (index * span) / Math.max(1, total - 1) };
}

function layoutColumns(total: number, maxColumns: number) {
  if (total <= 0) return 1;
  if (total <= 2) return total;
  if (total <= 4) return total;
  if (total <= 8) return Math.min(total, 4);
  if (total <= 14) return Math.min(total, 5);
  if (total <= 24) return Math.min(total, 6);
  return Math.min(total, maxColumns);
}

function threadSlot(agentIndex: number, agentCount: number, threadIndex: number, threadCount: number) {
  const baseX = agentCount <= 1 ? 68 : 38 + (agentIndex * 42) / Math.max(1, agentCount - 1);
  const offset = threadCount <= 1 ? 0 : (threadIndex - (threadCount - 1) / 2) * 9;
  return { x: Math.max(28, Math.min(82, baseX + offset)), y: 54 + (threadIndex % 3) * 10 };
}

function configuredMCPServers(config: AgentConfigSnapshot | undefined): MCPServerConfig[] {
  return (config?.mcp_servers || []).filter((server) => {
    const name = String(server?.name || "").trim();
    return !!name && !server.no_spawn && !isHiddenSystemTool(name);
  });
}

function configuredMainThread(): Thread {
  return {
    id: "main",
    name: "main",
    directive: "",
    tools: [],
    mcp_names: [],
    iteration: 0,
    rate: "configured",
    model: "MCP",
    age: "",
  };
}

function targetForMCP(
  name: string,
  url: string | undefined,
  appNames: string[],
  connections: ConnectionInfo[],
  mcpByID: Map<number, MCPServer>,
): { id: string; label: string } | null {
  const rowID = mcpIDFromURL(url);
  const row = rowID ? mcpByID.get(rowID) : undefined;
  if (row?.connection_id) {
    const conn = connections.find((item) => item.id === row.connection_id);
    return {
      id: connectionNodeID(row.connection_id),
      label: conn?.app_slug || conn?.name || row.name || name,
    };
  }
  const rowName = row?.name || name;
  const app = appForTool(rowName, appNames);
  if (app) return { id: appNodeID(app), label: app };
  const connection = connectionForTool(rowName, connections);
  if (connection) return { id: connectionNodeID(connection.id), label: connection.app_slug || connection.name || rowName };
  return null;
}

function mcpIDFromURL(url: string | undefined): number | null {
  const match = String(url || "").match(/\/mcp\/(\d+)(?:\?|$|\/)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function pruneDenseIsolatedTopology(nodes: SystemMapNode[], edges: SystemMapEdge[]) {
  const appIDs = new Set(nodes.filter((node) => node.kind === "app").map((node) => node.id));
  const connectionIDs = new Set(nodes.filter((node) => node.kind === "external").map((node) => node.id));
  const dense = appIDs.size + connectionIDs.size > 28;
  if (!dense) {
    return {
      nodes,
      edges,
      visibleApps: appIDs.size,
      visibleConnections: connectionIDs.size,
    };
  }

  const incident = new Set<string>();
  edges.forEach((edge) => {
    incident.add(edge.source);
    incident.add(edge.target);
  });
  nodes.forEach((node) => {
    if (node.lastActiveAt || node.badges?.length || node.kind === "agent" || node.kind === "thread" || node.kind === "event") {
      incident.add(node.id);
    }
  });
  const filteredNodes = nodes.filter((node) => {
    if (node.kind !== "app" && node.kind !== "external") return true;
    return incident.has(node.id);
  });
  const visibleIDs = new Set(filteredNodes.map((node) => node.id));
  const filteredEdges = edges.filter((edge) => visibleIDs.has(edge.source) && visibleIDs.has(edge.target));
  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    visibleApps: filteredNodes.filter((node) => node.kind === "app").length,
    visibleConnections: filteredNodes.filter((node) => node.kind === "external").length,
  };
}

function agentNodeID(id: number) {
  return `agent:${id}`;
}

function threadNodeID(agentID: number, threadID: string) {
  return `thread:${agentID}:${threadID || "main"}`;
}

function appNodeID(name: string) {
  return `app:${name}`;
}

function connectionNodeID(id: number) {
  return `external:connection:${id}`;
}

function subscriptionSourceID(sub: SubscriptionInfo): string {
  if (sub.source === "app_event") {
    const parsed = parseAppEventSlug(sub.slug);
    if (parsed) return appNodeID(parsed.app);
  }
  if (sub.connection_id) return connectionNodeID(sub.connection_id);
  return "external:events";
}

function subscriptionEdgeID(sourceID: string, targetThreadID: string, sub: SubscriptionInfo): string {
  return `subscription:${sourceID}:${targetThreadID}:${sub.id}`;
}

function subscriptionLabel(sub: SubscriptionInfo): string {
  if (sub.source === "app_event") {
    if ((sub.events || []).length > 0) return (sub.events || []).join(", ");
    const parsed = parseAppEventSlug(sub.slug);
    return parsed?.topic || sub.name || "subscription";
  }
  return sub.name || sub.slug || "subscription";
}

function mergeBadges(a?: string[], b?: string[]): string[] | undefined {
  const merged = [...(a || []), ...(b || [])].filter(Boolean);
  if (merged.length === 0) return undefined;
  return Array.from(new Set(merged));
}

function parseAppEventSlug(slug: string): { app: string; topic: string } | null {
  const index = String(slug || "").indexOf(":");
  if (index <= 0) return null;
  return { app: slug.slice(0, index), topic: slug.slice(index + 1) };
}

function subscriptionForDeliveredEvent(event: TelemetryEvent, subscriptions: SubscriptionInfo[]): SubscriptionInfo | null {
  const delivered = parseDeliveredAppEvent(event);
  const threadID = event.thread_id || "main";
  return subscriptions.find((sub) => {
    if (sub.instance_id !== event.instance_id || (sub.thread_id || "main") !== threadID) return false;
    if (!delivered) return sub.source !== "app_event";
    const parsed = parseAppEventSlug(sub.slug);
    return !!parsed && parsed.app === delivered.app && subscriptionTopicMatches(sub, parsed.topic, delivered.topic);
  }) || null;
}

function parseDeliveredAppEvent(event: TelemetryEvent): { app: string; topic: string } | null {
  const data = event.data || {};
  const candidates = [String(data.source || ""), String(data.message || ""), String(data.text || ""), String(data.event || "")];
  for (const value of candidates) {
    const match = value.match(/\[app:([^:\]]+):([^\]]+)\]/);
    if (match) return { app: match[1], topic: match[2] };
  }
  return null;
}

function topicMatches(pattern: string, topic: string): boolean {
  if (!pattern || !topic) return false;
  if (pattern === topic || pattern === "*") return true;
  if (pattern.endsWith("*")) return topic.startsWith(pattern.slice(0, -1));
  return false;
}

function subscriptionTopicMatches(sub: SubscriptionInfo, legacyPattern: string, topic: string): boolean {
  const events = (sub.events || []).map((event) => event.trim()).filter(Boolean);
  if (events.length > 0) return events.some((event) => topicMatches(event, topic));
  return topicMatches(legacyPattern, topic);
}

function appForTool(tool: string, appNames: string[]): string | null {
  if (!tool) return null;
  return appNames.find((name) => tool === name || tool.startsWith(`${name}_`) || tool.startsWith(`${name}.`)) || null;
}

function connectionForTool(tool: string, connections: ConnectionInfo[]): ConnectionInfo | null {
  if (!tool) return null;
  const normalizedTool = normalizeToolToken(tool);
  return connections.find((conn) => {
    const aliases = [conn.app_slug, conn.app_name, conn.name].map(normalizeToolToken).filter(Boolean);
    return aliases.some((alias) => normalizedTool === alias || normalizedTool.startsWith(`${alias}_`) || normalizedTool.startsWith(`${alias}.`));
  }) || null;
}

function appStatus(app: AppRow): SystemMapStatus {
  if (app.status === "running") return "running";
  if (app.status === "error") return "error";
  if (app.status === "pending") return "warning";
  if (app.status === "disabled") return "idle";
  return "unknown";
}

function connectionIconUrl(conn: ConnectionInfo): string | undefined {
  if (normalizeToolToken(conn.app_slug) === "pushover") return "https://www.google.com/s2/favicons?domain=pushover.net&sz=128";
  return undefined;
}

function isHiddenSystemTool(tool: string): boolean {
  const normalized = String(tool || "").trim().toLowerCase();
  return !!normalized && (hiddenSystemTools.has(normalized) || normalized.startsWith("channels_"));
}

function telemetryActivityKind(type: string): SystemMapEdgeKind {
  if (type === "event.received") return "event";
  if (type === "tool.call" || type === "tool.result") return "tool";
  if (type === "thread.spawn" || type === "thread.message") return "message";
  if (type.startsWith("llm.") || type.includes("chunk") || type.includes("delta")) return "message";
  return "message";
}

function activityFromTelemetry(event: TelemetryEvent, appNames: string[], connections: ConnectionInfo[]): SystemMapActivity | null {
  const data = event.data || {};
  const time = eventTime(event);
  const thread = event.thread_id || "main";
  const targetThread = threadNodeID(event.instance_id, thread);
  switch (event.type) {
    case "tool.call": {
      const tool = String(data.name || data.tool || "tool");
      if (isHiddenSystemTool(tool)) return null;
      const app = appForTool(tool, appNames);
      const connection = connectionForTool(tool, connections);
      return {
        id: event.id || `${time}:tool.call:${tool}`,
        time,
        source: targetThread,
        target: app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : undefined,
        label: tool,
        detail: shortText(summarizeValue(data.args || data.arguments || data.reason), 180),
        status: "running",
      };
    }
    case "tool.result": {
      const tool = String(data.name || data.tool || "tool");
      if (isHiddenSystemTool(tool)) return null;
      const app = appForTool(tool, appNames);
      const connection = connectionForTool(tool, connections);
      return {
        id: event.id || `${time}:tool.result:${tool}`,
        time,
        source: app ? appNodeID(app) : connection ? connectionNodeID(connection.id) : undefined,
        target: targetThread,
        label: `${tool} result`,
        detail: data.is_error ? shortText(String(data.error || data.message || ""), 180) : "completed",
        status: data.is_error ? "error" : "ok",
      };
    }
    case "thread.spawn":
      return {
        id: event.id || `${time}:thread.spawn`,
        time,
        source: targetThread,
        target: threadNodeID(event.instance_id, String(data.thread_id || data.id || data.name || "")),
        label: "spawned thread",
        detail: String(data.thread_id || data.id || data.name || ""),
        status: "running",
      };
    case "event.received":
      return {
        id: event.id || `${time}:event.received`,
        time,
        source: "external:events",
        target: targetThread,
        label: "incoming event",
        detail: eventSnippet(data),
        status: "running",
      };
    case "llm.done":
      return {
        id: event.id || `${time}:llm.done`,
        time,
        source: targetThread,
        label: "reasoning step",
        detail: String(data.model || ""),
        status: "ok",
      };
    case "error":
    case "llm.error":
      return {
        id: event.id || `${time}:error`,
        time,
        source: targetThread,
        label: "error",
        detail: shortText(String(data.error || data.message || ""), 180),
        status: "error",
      };
    default:
      return null;
  }
}

function toolChunkKey(threadID: string, data: Record<string, unknown>): string {
  return `${threadID}:${String(data.id || data.call_id || data.tool_call_id || data.index || "latest")}`;
}

function toolNameFromTelemetry(data: Record<string, unknown>, appNames: string[], connections: ConnectionInfo[]): string {
  const nestedFunction = data.function && typeof data.function === "object" ? (data.function as Record<string, unknown>) : undefined;
  const candidates = [data.tool, data.name, data.tool_name, data.function_name, nestedFunction?.name];
  for (const candidate of candidates) {
    const tool = String(candidate || "");
    if (isHiddenSystemTool(tool)) continue;
    if (appForTool(tool, appNames) || connectionForTool(tool, connections)) return tool;
  }
  return toolNameFromText(String(data.chunk || data.delta || data.text || ""), appNames, connections);
}

function toolNameFromText(text: string, appNames: string[], connections: ConnectionInfo[]): string {
  if (!text) return "";
  const aliases = [...appNames, ...connections.flatMap((conn) => [conn.app_slug, conn.app_name, conn.name])].filter(Boolean);
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`["']?(${escaped}[_.][A-Za-z0-9_.:-]+)["']?`));
    if (match?.[1]) return match[1];
  }
  return "";
}

function latestNodeActivity(
  current: SystemMapNode["latest"] | undefined,
  next: SystemMapNode["latest"] | undefined,
): SystemMapNode["latest"] | undefined {
  if (!next?.text) return current;
  if (!current?.text) return next;
  return (next.time || 0) >= (current.time || 0) ? next : current;
}

function shortToolName(tool: string): string {
  const compact = String(tool || "tool").trim();
  if (!compact) return "tool";
  const parts = compact.split(/[_.]/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join("_");
  return compact;
}

function eventSnippet(data: Record<string, unknown>): string {
  const candidate = data.message || data.text || data.event || data.payload || data.input || data.body || data;
  return shortText(summarizeValue(candidate), 42);
}

function appBusEventKey(event: AppBusEvent): string {
  return `${event.app}:${event.project_id}:${event.seq}:${event.topic}`;
}

function appBusEventDetail(event: AppBusEvent): string {
  const snippet = shortText(summarizeValue(event.data), 140);
  return snippet ? `${event.app}.${event.topic}\n${snippet}` : `${event.app}.${event.topic}`;
}

function dedupeTelemetry(events: TelemetryEvent[]): TelemetryEvent[] {
  const seen = new Set<string>();
  const out: TelemetryEvent[] = [];
  events.forEach((event) => {
    const key = telemetryEventKey(event);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(event);
  });
  return out;
}

function telemetryEventKey(event: TelemetryEvent): string {
  if (event.id) return `id:${event.id}`;
  return [event.time || "", event.instance_id || "", event.thread_id || "", event.type || "", JSON.stringify(event.data || {})].join("|");
}

function eventTime(event: TelemetryEvent): number {
  return Date.parse(event.time) || Date.now();
}

function normalizeToolToken(value: string | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function summarizeValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shortText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1))}...`;
}
