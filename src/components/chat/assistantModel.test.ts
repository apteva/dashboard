import { describe, expect, test } from "bun:test";
import type { Agent, AppRow } from "../../api";
import { selectAssistantContribution } from "../../hooks/useChatAssistant";
import { ASSISTANT_PREFERENCES_SLOT, allowedAssistantChoices, defaultAssistantPreferences, initialAssistantTarget, readAssistantPreferences, targetKey, type AssistantChoice } from "./assistantModel";

const choices: AssistantChoice[] = [
  { target: { kind: "helper" }, agent: { id: 1, name: "Helper" } as Agent },
  { target: { kind: "agent", id: 2 }, agent: { id: 2, name: "Research" } as Agent },
  { target: { kind: "agent", id: 3 }, agent: { id: 3, name: "Finance" } as Agent },
];
describe("chat assistant preferences", () => {
  test("is opt-in and defaults to Helper without requiring a numeric Helper identity", () => {
    expect(readAssistantPreferences({})).toMatchObject({ enabled: false, defaultTarget: { kind: "helper" } });
  });
  test("only explicitly allowed targets appear and switching off restricts to default", () => {
    const preferences = { ...defaultAssistantPreferences, targets: [choices[1]!.target] };
    expect(allowedAssistantChoices(preferences, choices).map((item) => targetKey(item.target))).toEqual(["helper", "agent:2"]);
    expect(allowedAssistantChoices({ ...preferences, allowSwitching: false }, choices)).toEqual([choices[0]!]);
  });
  test("ignores remembered targets when removed, inaccessible, or switching is disabled", () => {
    const preferences = { ...defaultAssistantPreferences, rememberTarget: true, lastTarget: choices[1]!.target, targets: [choices[1]!.target] };
    expect(initialAssistantTarget(preferences, choices)).toBe("agent:2");
    expect(initialAssistantTarget(preferences, [choices[0]!])).toBe("helper");
    expect(initialAssistantTarget({ ...preferences, targets: [] }, choices)).toBe("helper");
    expect(initialAssistantTarget({ ...preferences, allowSwitching: false }, choices)).toBe("helper");
  });
  test("does not silently send to a different agent when the default becomes unavailable", () => {
    expect(initialAssistantTarget(defaultAssistantPreferences, [choices[1]!])).toBe("helper");
  });
  test("preferences round trip through the existing per-project surface representation", () => {
    const settings = { ...defaultAssistantPreferences, enabled: true, defaultTarget: choices[1]!.target, rememberTarget: true, lastTarget: choices[1]!.target };
    expect(readAssistantPreferences({ slots: { [ASSISTANT_PREFERENCES_SLOT]: [{ id: "chat-assistant", component: "dashboard:chat-assistant-preferences", size: "full", settings }] } })).toEqual(settings);
    expect(readAssistantPreferences({})).toEqual({ ...defaultAssistantPreferences, lastTarget: undefined });
  });
  test("rejects malformed targets and future target kinds until supported", () => {
    const result = readAssistantPreferences({ slots: { [ASSISTANT_PREFERENCES_SLOT]: [{ id: "config", component: "config", size: "full", settings: { defaultTarget: { kind: "agent", id: -1 }, targets: [{ kind: "other" }, null, { kind: "agent", id: "2" }] } }] } });
    expect(result.defaultTarget).toEqual({ kind: "helper" });
    expect(result.targets).toEqual([]);
  });
});
describe("Conversations dependency", () => {
  const app = (project_id: string, status = "running") => ({ name: "conversations", project_id, status, ui_components: [{ name: "agent-conversations", slots: ["dashboard.build"] }] }) as AppRow;
  test("requires the running Conversations component; prioritizes this project's install", () => {
    expect(selectAssistantContribution([], "one")).toBeNull();
    expect(selectAssistantContribution([app("one", "disabled")], "one")).toBeNull();
    expect(selectAssistantContribution([app("two")], "one")).toBeNull();
    const project = app("one");
    expect(selectAssistantContribution([app(""), project], "one")?.app).toBe(project);
    expect(selectAssistantContribution([app("")], "one")?.app.name).toBe("conversations");
  });
});
