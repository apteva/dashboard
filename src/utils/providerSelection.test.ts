import { describe, expect, test } from "bun:test";
import { resolveEffectiveAgentProvider } from "./providerSelection";

describe("resolveEffectiveAgentProvider", () => {
  test("uses the effective runtime default instead of provider-list order", () => {
    expect(resolveEffectiveAgentProvider(
      "{}",
      [
        { name: "openai", default: false },
        { name: "openai-codex", default: true },
        { name: "openai-realtime", default: false },
      ],
    )).toBe("openai-codex");
  });

  test("uses the first runtime text provider when an old config has no default flag", () => {
    expect(resolveEffectiveAgentProvider(
      '{"default_provider":"openai-codex"}',
      [
        { name: "openai" },
        { name: "openai-codex" },
      ],
    )).toBe("openai");
  });

  test("falls back to the saved pin when runtime config is unavailable", () => {
    expect(resolveEffectiveAgentProvider(
      '{"default_provider":"OpenAI Codex"}',
    )).toBe("openai-codex");
  });
});
