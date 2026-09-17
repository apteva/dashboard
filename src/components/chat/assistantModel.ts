import type { Agent } from "../../api";
import type { ProjectUILayout } from "../apps/contributions";

export const ASSISTANT_PREFERENCES_SLOT = "dashboard.chat_assistant";
export type AssistantTarget = { kind: "helper" } | { kind: "agent"; id: number };
export interface AssistantPreferences {
  enabled: boolean;
  defaultTarget: AssistantTarget;
  allowSwitching: boolean;
  allAgents: boolean;
  sharePageContext: boolean;
  targets: AssistantTarget[];
  rememberTarget: boolean;
  lastTarget?: AssistantTarget;
}
export const defaultAssistantPreferences: AssistantPreferences = {
  enabled: false, defaultTarget: { kind: "helper" }, allowSwitching: true,
  targets: [{ kind: "helper" }], allAgents: false, rememberTarget: false, sharePageContext: true,
};
export const targetKey = (target: AssistantTarget) => target.kind === "helper" ? "helper" : `agent:${target.id}`;
function validTarget(value: any): value is AssistantTarget {
  return value?.kind === "helper" || (value?.kind === "agent" && Number.isSafeInteger(value.id) && value.id > 0);
}
export function readAssistantPreferences(project: ProjectUILayout): AssistantPreferences {
  const stored = project.slots?.[ASSISTANT_PREFERENCES_SLOT]?.[0];
  const raw = typeof stored === "object" ? stored.settings : undefined;
  const fallback = defaultAssistantPreferences;
  return {
    enabled: raw?.enabled === true,
    defaultTarget: validTarget(raw?.defaultTarget) ? raw.defaultTarget : fallback.defaultTarget,
    allowSwitching: raw?.allowSwitching !== false,
    allAgents: raw?.allAgents === true,
    sharePageContext: raw?.sharePageContext !== false,
    targets: Array.isArray(raw?.targets) ? raw.targets.filter(validTarget) : fallback.targets,
    rememberTarget: raw?.rememberTarget === true,
    lastTarget: validTarget(raw?.lastTarget) ? raw.lastTarget : undefined,
  };
}
export interface AssistantChoice { target: AssistantTarget; agent: Agent }
export function allowedAssistantChoices(preferences: AssistantPreferences, choices: AssistantChoice[]) {
  const allowed = new Set([targetKey(preferences.defaultTarget),
    ...(preferences.allowSwitching ? preferences.targets.map(targetKey) : [])]);
  if (preferences.allowSwitching && preferences.allAgents) return choices;
  return choices.filter((choice) => allowed.has(targetKey(choice.target)));
}
export function initialAssistantTarget(preferences: AssistantPreferences, choices: AssistantChoice[]): string {
  const keys = new Set(allowedAssistantChoices(preferences, choices).map((choice) => targetKey(choice.target)));
  const preferred = preferences.rememberTarget && preferences.lastTarget ? targetKey(preferences.lastTarget) : "";
  return keys.has(preferred) ? preferred : targetKey(preferences.defaultTarget);
}
