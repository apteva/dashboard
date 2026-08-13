import { describe, expect, test } from "bun:test";
import { activateOnboardingPresetAgents, ONBOARDING_STEP_IDS } from "./Onboarding";

describe("onboarding journey", () => {
  test("shows project value before asking for an LLM provider", () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual(["theme", "setup", "provider"]);
  });

  test("starts preset-created agents after the provider is connected", async () => {
    const started: number[] = [];
    const result = await activateOnboardingPresetAgents([11, 12], async (id) => {
      started.push(id);
      if (id === 12) throw new Error("start failed");
    });

    expect(started).toEqual([11, 12]);
    expect(result).toEqual({ started: 1, failed: 1 });
  });
});
