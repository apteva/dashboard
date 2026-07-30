import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentTasks,
  type AgentTask,
  type AgentTaskCounts,
  type AgentTaskState,
  type TelemetryEvent,
} from "../api";
import { useTelemetryEvents } from "./useTelemetryBus";
import { mergeAgentTaskSnapshot, sortAgentTasks } from "../components/tasks/taskModel";

const FALLBACK_REFRESH_MS = 60_000;
const availabilityByProject = new Map<string, boolean>();

export interface UseTasksOptions {
  projectId?: string;
  allProjects?: boolean;
  agentId?: number;
  states?: AgentTaskState[];
  originConversationId?: string;
  limit?: number;
}

export function useTasks(options: UseTasksOptions) {
  const statesKey = (options.states || []).join(",");
  const projectKey = options.projectId || "";
  const scopeKey = options.allProjects ? "*" : projectKey;
  const initialAvailability = scopeKey ? availabilityByProject.get(scopeKey) : undefined;
  const [rows, setRows] = useState<AgentTask[]>([]);
  const [counts, setCounts] = useState<AgentTaskCounts | undefined>();
  const [enabled, setEnabled] = useState<boolean | undefined>(initialAvailability);
  const [schedulingEnabled, setSchedulingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refreshTimer = useRef<number | null>(null);

  const states = useMemo(
    () => statesKey.split(",").filter(Boolean) as AgentTaskState[],
    [statesKey],
  );
  const refresh = useCallback(async (quiet = false) => {
    if (!options.agentId && !projectKey && !options.allProjects) {
      setRows([]);
      setCounts(undefined);
      setEnabled(false);
      setSchedulingEnabled(false);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const response = await agentTasks.list({
        projectId: projectKey || undefined,
        allProjects: options.allProjects,
        agentId: options.agentId,
        states,
        originConversationId: options.originConversationId,
        limit: options.limit || 100,
      });
      setRows(sortAgentTasks(response.tasks || []));
      setCounts(response.counts);
      setEnabled(true);
      setSchedulingEnabled(response.scheduling_enabled !== false);
      setError("");
      if (scopeKey) availabilityByProject.set(scopeKey, true);
    } catch (reason: any) {
      if (reason?.status === 404) {
        setRows([]);
        setCounts(undefined);
        setEnabled(false);
        setSchedulingEnabled(false);
        setError("");
        if (scopeKey) availabilityByProject.set(scopeKey, false);
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setLoading(false);
    }
  }, [options.agentId, options.allProjects, options.limit, options.originConversationId, projectKey, scopeKey, states]);

  useEffect(() => {
    setEnabled(scopeKey ? availabilityByProject.get(scopeKey) : undefined);
    void refresh();
  }, [refresh, scopeKey]);

  const matches = useCallback((task: AgentTask) => {
    if (projectKey && task.project_id !== projectKey) return false;
    if (options.agentId && task.agent_id !== options.agentId) return false;
    if (options.originConversationId && task.origin_conversation_id !== options.originConversationId) return false;
    if (states.length > 0 && !states.includes(task.state)) return false;
    return true;
  }, [options.agentId, options.originConversationId, projectKey, states]);

  const upsert = useCallback((task: AgentTask) => {
    if (!task?.id) return;
    setEnabled(true);
    setRows((current) => mergeAgentTaskSnapshot(current, task, matches, options.limit || 100));
  }, [matches, options.limit]);

  const scheduleAuthoritativeRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh(true);
    }, 250);
  }, [refresh]);

  useTelemetryEvents(
    options.agentId || (projectKey || options.allProjects ? null : undefined),
    (event: TelemetryEvent) => {
      if (!event.type.startsWith("task.")) return;
      const task = event.data?.task as AgentTask | undefined;
      if (!task?.id) {
        scheduleAuthoritativeRefresh();
        return;
      }
      upsert(task);
      scheduleAuthoritativeRefresh();
    },
  );

  useEffect(() => {
    const recover = () => void refresh(true);
    window.addEventListener("apteva.telemetry.gap", recover);
    window.addEventListener("apteva.telemetry.reconnected", recover);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, FALLBACK_REFRESH_MS);
    return () => {
      window.removeEventListener("apteva.telemetry.gap", recover);
      window.removeEventListener("apteva.telemetry.reconnected", recover);
      window.clearInterval(interval);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [refresh]);

  return { tasks: rows, counts, enabled, schedulingEnabled, loading, error, refresh, upsert };
}

export function useTaskTrackingAvailable(projectId?: string): boolean {
  const { enabled } = useTasks({ projectId, limit: 1 });
  return enabled === true;
}
