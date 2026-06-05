import { useEffect, useMemo, useState } from "react";
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
  SystemMap,
  type SystemMapActivity,
  type SystemMapEdge,
  type SystemMapEdgeKind,
  type SystemMapNode,
  type SystemMapNodeLatestKind,
  type SystemMapStatus,
} from "../components/system-map/SystemMap";
import { useProjects } from "../hooks/useProjects";
import { useTelemetryEvents } from "../hooks/useTelemetryBus";

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

  const appBusKey = useMemo(
    () => projectApps.filter((app) => app.status === "running").map((app) => app.name).sort().join(","),
    [projectApps],
  );

  useEffect(() => {
    if (!projectId || !appBusKey) return;
    const appNames = appBusKey.split(",").filter(Boolean);
    const sources = appNames.map((app) => {
      const source = new EventSource(
        `/api/app-events/${encodeURIComponent(app)}?project_id=${encodeURIComponent(projectId)}`,
        { withCredentials: true },
      );
      source.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as AppBusEvent;
          setAppBusEvents((prev) => {
            const key = appBusEventKey(event);
            if (prev.some((seen) => appBusEventKey(seen) === key)) return prev;
            return [...prev, event].slice(-160);
          });
        } catch {
          // Ignore malformed app bus frames.
        }
      };
      return source;
    });
    return () => {
      sources.forEach((source) => source.close());
    };
  }, [projectId, appBusKey]);

  const model = useMemo(
    () => buildProjectActivityModel(currentProject?.name || projectId, agents, projectApps, connections, projectMCPServers, projectSubscriptions, agentConfigs, threadsByAgent, contexts, events, appBusEvents),
    [currentProject?.name, projectId, agents, projectApps, connections, projectMCPServers, projectSubscriptions, agentConfigs, threadsByAgent, contexts, events, appBusEvents],
  );

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
            Live project view from agents, threads, app tools, telemetry, and app events.
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

      <SystemMap
        title="Live System"
        subtitle="Project agents, threads, app tools, app events, and integration activity."
        scope="project"
        boundaryLabel={currentProject?.name || projectId}
        nodes={model.nodes}
        edges={model.edges}
        activity={model.activity}
        stats={model.stats}
        loading={loading}
        wide
        heightClass="h-[620px] min-h-[460px]"
        emptyText="No project activity data yet."
        notice={
          !loading && agents.length === 0
            ? {
                title: "No agents in this project yet",
                detail: "Create or start an agent to see live threads, tool calls, and telemetry.",
              }
            : undefined
        }
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
          return !!parsed && parsed.app === sourceName && topicMatches(parsed.topic, event.topic || "");
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
    return !!parsed && parsed.app === delivered.app && topicMatches(parsed.topic, delivered.topic);
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
