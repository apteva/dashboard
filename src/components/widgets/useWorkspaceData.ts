import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apps, instances, integrations, skills, mcpServers, telemetry, chat, core, instanceSkills, type Agent, type AppRow, type ConnectionInfo, type Skill, type MCPServer, type MCPServerConfig, type InstanceSkill, type InstanceStats, type CurrentStatusMessageRow } from "../../api";
import { useTelemetryEvents } from "../../hooks/useTelemetryBus";
import { keepIfEqual } from "../../utils/keepIfEqual";

export interface AgentAttachments { servers: MCPServerConfig[]; skills: InstanceSkill[]; error?: string }
export interface WorkspaceData {
  agents: Agent[]; apps: AppRow[]; connections: ConnectionInfo[]; skills: Skill[];
  inventory: MCPServer[]; stats: InstanceStats[]; statuses: CurrentStatusMessageRow[];
  attachments: Record<number, AgentAttachments>; loading: boolean; errors: string[];
}
const empty = (): WorkspaceData => ({ agents: [], apps: [], connections: [], skills: [], inventory: [], stats: [], statuses: [], attachments: {}, loading: true, errors: [] });
/** Agent runs emit bursts of telemetry; refresh what they change at most this often. */
export const LIVE_RELOAD_MS = 10_000;

/** Merges app lists in a fixed order: global installs first, then each
 * project in the order given. Requests run in parallel, so the order must
 * not depend on which one finished first. A later row for the same install
 * replaces an earlier one in place. */
export function mergeAppLists(globalRows: AppRow[], projectRows: Array<AppRow[] | undefined>): AppRow[] {
  const rows = new Map<number, AppRow>();
  for (const row of globalRows) rows.set(row.install_id, row);
  for (const list of projectRows) for (const row of list || []) rows.set(row.install_id, row);
  return [...rows.values()];
}

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
      const globalRows = await apps.list(undefined, "global");
      const projectRows: Array<AppRow[] | undefined> = new Array(ids.length);
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (index < ids.length && !cancelled) {
          const position = index++;
          projectRows[position] = await apps.list(ids[position]);
        }
      }));
      return mergeAppLists(globalRows, projectRows);
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
        const sameScope = previous.scope === scope;
        const old = sameScope ? previous.data : empty();
        const data: WorkspaceData = { ...old, loading: false };
        const failed = new Set<string>();
        selected.forEach((source, i) => {
          const result = results[i];
          if (result.status === "fulfilled") Object.assign(data, { [source.key]: keepIfEqual(old[source.key], result.value as never) });
          else failed.add(source.name);
        });
        // A live reload leaves the other sources' last outcome in place.
        data.errors = keepIfEqual(old.errors, sources.flatMap(source => failed.has(source.name) || (!selected.includes(source) && old.errors.includes(failure(source.name))) ? [failure(source.name)] : []));
        // Nothing changed: keep the state object so nothing re-renders.
        if (sameScope && !old.loading && (Object.keys(data) as Array<keyof WorkspaceData>).every(key => data[key] === old[key])) return previous;
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
  // An agent's attachments are read again when its config or status changes.
  // A refresh or an attachment-changing event reads them all again.
  const attachmentsRead = useRef<{ scope: string; revision: number; attachmentRevision: number; signatures: Map<number, string> }>({ scope: "", revision: -1, attachmentRevision: -1, signatures: new Map() });
  useEffect(() => {
    if (!enabled || !relationships) return;
    let cancelled = false;
    const agents = data.agents;
    const read = attachmentsRead.current;
    const full = read.scope !== scope || read.revision !== revision || read.attachmentRevision !== attachmentRevision;
    const signatures = new Map(agents.map(agent => [agent.id, JSON.stringify([agent.config, agent.status])]));
    const targets = agents.filter(agent => full || read.signatures.get(agent.id) !== signatures.get(agent.id) || !data.attachments[agent.id]);
    const next: Record<number, AgentAttachments> = {};
    let index = 0;
    const worker = async () => {
      while (index < targets.length && !cancelled) {
        const agent = targets[index++];
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
    void Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker)).then(() => {
      if (cancelled) return;
      attachmentsRead.current = { scope, revision, attachmentRevision, signatures };
      setState(previous => {
        if (previous.scope !== scope) return previous;
        const old = previous.data.attachments;
        const attachments: Record<number, AgentAttachments> = {};
        for (const agent of agents) {
          const entry = next[agent.id] ? keepIfEqual(old[agent.id], next[agent.id]) : old[agent.id];
          if (entry) attachments[agent.id] = entry;
        }
        const ids = Object.keys(attachments);
        const unchanged = ids.length === Object.keys(old).length && ids.every(id => old[Number(id)] === attachments[Number(id)]);
        return unchanged ? previous : { scope, data: { ...previous.data, attachments } };
      });
    });
    return () => { cancelled = true; };
  }, [scope, attachmentKey, enabled, relationships, revision, attachmentRevision]);
  return useMemo(() => ({ ...data, refresh }), [data, refresh]);
}
