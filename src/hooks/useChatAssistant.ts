import { useCallback, useEffect, useState } from "react";
import { apps, instances, platformHelper, type AppRow, type PlatformHelperStatus } from "../api";
import { contributionsFor, fetchEligibleContributionKeys, useProjectUILayout, type Contribution } from "../components/apps/contributions";
import { ASSISTANT_PREFERENCES_SLOT, readAssistantPreferences, type AssistantChoice, type AssistantPreferences } from "../components/chat/assistantModel";
import { useOptionalAuth } from "./useAuth";

export const ASSISTANT_CHAT_SLOT = "dashboard.build";
export function selectAssistantContribution(rows: AppRow[], projectId: string): Contribution | null {
  const matches = contributionsFor(rows, ASSISTANT_CHAT_SLOT).filter((item) => item.app.name === "conversations" && item.spec.name === "agent-conversations");
  return matches.find((item) => (item.app as AppRow).project_id === projectId)
    || matches.find((item) => !(item.app as AppRow).project_id) || null;
}
export function useAssistantPreferences(projectId?: string) {
  const auth = useOptionalAuth();
  const { project, updateSurface, saveState } = useProjectUILayout(projectId);
  const preferences = readAssistantPreferences(project);
  const save = async (next: AssistantPreferences) => {
    await updateSurface(ASSISTANT_PREFERENCES_SLOT, [{
      id: "chat-assistant", component: "dashboard:chat-assistant-preferences", size: "full", settings: { ...next },
    }]);
    // Newly mounted settings and project switches read Auth's snapshot, too.
    // Refresh also restores the confirmed preference if an optimistic save failed.
    await auth?.refresh().catch(() => {});
  };
  return { preferences, save, saveState };
}
interface Directory {
  projectId: string; rows: AppRow[]; contribution: Contribution | null;
  choices: AssistantChoice[]; helper: PlatformHelperStatus | null;
}
export function useAssistantDirectory(projectId: string, enabled = true) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      const [rows, agents, helper] = await Promise.all([
        apps.list(projectId), instances.list(projectId), platformHelper.status().catch(() => null),
      ]);
      const contribution = selectAssistantContribution(rows, projectId);
      const candidates: AssistantChoice[] = agents.filter((agent) => agent.project_id === projectId && agent.kind !== "platform_helper")
        .map((agent) => ({ target: { kind: "agent", id: agent.id }, agent }));
      if (helper?.activated && helper.conversations_installed && helper.agent) candidates.unshift({ target: { kind: "helper" }, agent: helper.agent });
      const choices = contribution ? (await Promise.all(candidates.map(async (choice) => {
        const eligible = await fetchEligibleContributionKeys(projectId, ASSISTANT_CHAT_SLOT, choice.agent.id).catch(() => new Set<string>());
        return eligible.has(contribution.key) ? choice : null;
      }))).filter((choice): choice is AssistantChoice => choice !== null) : [];
      // The shared mount resolves by app name: put the selected install first
      // when both a project install and a global install exist.
      const scopedRows = contribution ? [contribution.app as AppRow, ...rows.filter((row) => row.install_id !== contribution.app.install_id)] : rows;
      if (!cancelled) setDirectory({ projectId, rows: scopedRows, contribution, choices, helper });
    })().catch((reason) => {
      if (!cancelled) { setDirectory(null); setError(reason instanceof Error ? reason.message : "Unable to load chat assistant."); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [enabled, projectId, revision]);
  useEffect(() => {
    for (const event of ["apteva:apps-changed", "apteva:helper-changed", "apteva:agents-changed"]) window.addEventListener(event, refresh);
    return () => { for (const event of ["apteva:apps-changed", "apteva:helper-changed", "apteva:agents-changed"]) window.removeEventListener(event, refresh); };
  }, [refresh]);
  return { directory: enabled && directory?.projectId === projectId ? directory : null, loading, error, refresh };
}
