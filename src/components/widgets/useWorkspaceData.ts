import { useCallback, useEffect, useRef, useState } from "react";
import { apps, instances, integrations, skills, mcpServers, telemetry, chat, core, instanceSkills, type Agent, type AppRow, type ConnectionInfo, type Skill, type MCPServer, type MCPServerConfig, type InstanceSkill, type InstanceStats, type CurrentStatusMessageRow } from "../../api";
import { useTelemetryEvents } from "../../hooks/useTelemetryBus";

export interface AgentAttachments { servers: MCPServerConfig[]; skills: InstanceSkill[]; error?: string }
export interface WorkspaceData {
  agents: Agent[]; apps: AppRow[]; connections: ConnectionInfo[]; skills: Skill[];
  inventory: MCPServer[]; stats: InstanceStats[]; statuses: CurrentStatusMessageRow[];
  attachments: Record<number, AgentAttachments>; loading: boolean; errors: string[];
}
const empty = (): WorkspaceData => ({ agents: [], apps: [], connections: [], skills: [], inventory: [], stats: [], statuses: [], attachments: {}, loading: true, errors: [] });
/** Agent runs emit bursts of telemetry; refresh what they change at most this often. */
export const LIVE_RELOAD_MS = 10_000;

/** One resource snapshot per canvas. Consumers never create their own polling loops. */
export function useWorkspaceData(projectId: string | undefined, global: boolean, enabled: boolean, relationships: boolean, projectIds: string[]) {
  const scope = global ? "global" : projectId || "";
  const projectKey = [...projectIds].sort().join(",");
  const [revision, setRevision] = useState(0);
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [state, setState] = useState<{ scope: string; data: WorkspaceData }>({ scope, data: empty() });
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  const invalidate = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled || !scope) return;
    let cancelled = false, pending = false, loadedFull = false;
    let reloadRequested: "live" | "full" | undefined;
    let debounce: number | undefined;
    let liveDebounce: number | undefined;
    let lastLiveReload = 0;
    let attachmentsDebounce: number | undefined;
    let lastAttachmentRefresh = 0;
    const refreshAttachments = () => {
      // Batch bursts of completed tools, but never postpone indefinitely.
      if (attachmentsDebounce !== undefined || document.hidden) return;
      attachmentsDebounce = window.setTimeout(() => { attachmentsDebounce = undefined; lastAttachmentRefresh = Date.now(); setAttachmentRevision(n => n + 1); }, Math.max(400, 10_000 - (Date.now() - lastAttachmentRefresh)));
    };
    const loadApps = async () => {
      if (!global) return apps.list(projectId);
      const ids = [...projectIds];
      const rows = new Map<number, AppRow>();
      for (const row of await apps.list(undefined, "global")) rows.set(row.install_id, row);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (index < ids.length && !cancelled) {
          const id = ids[index++];
          for (const row of await apps.list(id)) rows.set(row.install_id, row);
        }
      }));
      return [...rows.values()];
    };
    // Live sources are what agent activity changes; the rest refresh on
    // explicit change events and the 30 s timer.
    const sources: Array<{ key: keyof WorkspaceData; name: string; live?: boolean; fetch: () => Promise<unknown> }> = [
      { key: "agents", name: "Agents", live: true, fetch: () => instances.list(projectId) },
      { key: "apps", name: "Apps", fetch: loadApps },
      { key: "connections", name: "Integrations", fetch: () => integrations.connections(projectId, { includeAppOwned: true }) },
      { key: "skills", name: "Skills", fetch: () => skills.list(projectId) },
      { key: "inventory", name: "Capabilities", fetch: () => mcpServers.list(projectId, { includeAppOwned: true }) },
      { key: "stats", name: "Usage", live: true, fetch: () => telemetry.projectStats(projectId, "24h") },
      { key: "statuses", name: "Agent status", live: true, fetch: () => chat.currentStatuses(projectId) },
    ];
    const failure = (name: string) => `${name} could not be refreshed.`;
    const load = async (live = false) => {
      if (cancelled || document.hidden) return;
      if (pending) { reloadRequested = live && reloadRequested !== "full" ? "live" : "full"; return; }
      pending = true;
      const selected = live && loadedFull ? sources.filter(source => source.live) : sources;
      const results = await Promise.allSettled(selected.map(source => source.fetch()));
      pending = false;
      if (cancelled) return;
      if (selected === sources) loadedFull = true;
      setState(previous => {
        const old = previous.scope === scope ? previous.data : empty();
        const data: WorkspaceData = { ...old, loading: false };
        const failed = new Set<string>();
        selected.forEach((source, i) => {
          const result = results[i];
          if (result.status === "fulfilled") Object.assign(data, { [source.key]: result.value });
          else failed.add(source.name);
        });
        // A live reload leaves the other sources' last outcome in place.
        data.errors = sources.flatMap(source => failed.has(source.name) || (!selected.includes(source) && old.errors.includes(failure(source.name))) ? [failure(source.name)] : []);
        return { scope, data };
      });
      const requested = reloadRequested;
      reloadRequested = undefined;
      if (requested === "full") schedule();
      else if (requested === "live") scheduleLive();
    };
    const schedule = (event?: Event) => {
      if (event && ["apteva:agents-changed", "apteva:apps-changed", "apteva:connections-changed", "apteva:skills-changed", "apteva.telemetry.reconnected", "apteva.telemetry.gap", "visibilitychange"].includes(event.type)) refreshAttachments();
      if (debounce !== undefined) return;
      debounce = window.setTimeout(() => {
        debounce = undefined;
        void load();
      }, 400);
    };
    const scheduleLive = () => {
      if (liveDebounce !== undefined || debounce !== undefined) return;
      liveDebounce = window.setTimeout(() => {
        liveDebounce = undefined;
        lastLiveReload = Date.now();
        void load(true);
      }, Math.max(400, LIVE_RELOAD_MS - (Date.now() - lastLiveReload)));
    };
    invalidate.current = () => { scheduleLive(); refreshAttachments(); };
    void load();
    const timer = window.setInterval(() => { void load(); if (!document.hidden) refreshAttachments(); }, 30_000);
    const events = ["apteva:agents-changed", "apteva:apps-changed", "apteva:connections-changed", "apteva:skills-changed", "apteva.statusMessage", "apteva.telemetry.reconnected", "apteva.telemetry.gap"];
    events.forEach(event => window.addEventListener(event, schedule));
    document.addEventListener("visibilitychange", schedule);
    return () => { cancelled = true; invalidate.current = () => {}; window.clearInterval(timer); window.clearTimeout(debounce); window.clearTimeout(liveDebounce); window.clearTimeout(attachmentsDebounce); events.forEach(event => window.removeEventListener(event, schedule)); document.removeEventListener("visibilitychange", schedule); };
  }, [scope, projectId, global, enabled, revision, projectKey]);
  useTelemetryEvents(enabled ? null : undefined, event => {
    // Helper may create the first agent, so invalidation cannot depend on the
    // creator being in the existing agent snapshot. The page owns bus scope.
    if (state.scope !== scope) return;
    if (["thread.done", "tool.result", "error", "llm.error"].includes(event.type)) invalidate.current();
  });
  const data = state.scope === scope ? state.data : empty();
  const attachmentKey = JSON.stringify(data.agents.map(agent => [agent.id, agent.config, agent.status]));
  useEffect(() => {
    if (!enabled || !relationships) return;
    let cancelled = false;
    const agents = data.agents;
    const next: Record<number, AgentAttachments> = {};
    let index = 0;
    const worker = async () => {
      while (index < agents.length && !cancelled) {
        const agent = agents[index++];
        const [config, attachedSkills] = await Promise.allSettled([core.config(agent.id), instanceSkills.list(agent.id)]);
        let fallback: MCPServerConfig[] = [];
        try { const stored = JSON.parse(agent.config); if (Array.isArray(stored?.mcp_servers)) fallback = stored.mcp_servers; } catch { /* Legacy config may be absent. */ }
        next[agent.id] = {
          servers: config.status === "fulfilled" ? config.value.mcp_servers || [] : data.attachments[agent.id]?.servers || fallback,
          skills: attachedSkills.status === "fulfilled" ? attachedSkills.value : data.attachments[agent.id]?.skills || [],
          error: config.status === "rejected" || attachedSkills.status === "rejected" ? "Some attachments could not be confirmed. Showing available configuration." : undefined,
        };
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, agents.length) }, worker)).then(() => {
      if (!cancelled) setState(previous => previous.scope === scope ? { scope, data: { ...previous.data, attachments: next } } : previous);
    });
    return () => { cancelled = true; };
  }, [scope, attachmentKey, enabled, relationships, revision, attachmentRevision]);
  return { ...data, refresh };
}
