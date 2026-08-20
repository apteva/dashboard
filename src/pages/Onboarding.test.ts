import { describe, expect, test } from "bun:test";
import {
  activateOnboardingPresetAgents,
  isTypeableRuntimeEntry,
  ONBOARDING_STEP_IDS,
} from "./Onboarding";
import { runtimeEntryAsAppDetail, type RuntimeCatalogEntry } from "../api";

function entry(over: Partial<RuntimeCatalogEntry> = {}): RuntimeCatalogEntry {
  return {
    slug: "anthropic-api",
    name: "Anthropic",
    description: "",
    logo: null,
    role: "llm",
    provider_key: "anthropic",
    auth_types: ["api_key"],
    credential_fields: [{ name: "api_key", label: "API Key" }],
    ...over,
  };
}

describe("onboarding journey", () => {
  test("shows project value before asking for an LLM provider", () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual(["theme", "setup", "provider"]);
  });

  describe("runtime provider picker", () => {
    test("offers providers whose key can simply be pasted", () => {
      expect(isTypeableRuntimeEntry(entry())).toBe(true);
      expect(isTypeableRuntimeEntry(entry({ auth_types: ["bearer"] }))).toBe(true);
    });

    // A first-run screen shouldn't launch a popup and wait on a round
    // trip; these stay reachable from Settings.
    test("skips providers needing an interactive auth flow", () => {
      expect(
        isTypeableRuntimeEntry(
          entry({ slug: "openai-codex", auth_types: ["oauth_device_code"] }),
        ),
      ).toBe(false);
      expect(isTypeableRuntimeEntry(entry({ auth_types: ["oauth2"] }))).toBe(false);
    });

    // Ollama declares no secret; without a field the form would render
    // an empty box and "Save key" could never succeed.
    test("skips providers that declare no credential fields", () => {
      expect(isTypeableRuntimeEntry(entry({ credential_fields: [] }))).toBe(false);
      expect(isTypeableRuntimeEntry(entry({ credential_fields: undefined }))).toBe(false);
    });
  });

  describe("credential form adapter", () => {
    // The picker submits under credential_fields names (api_key), not
    // env var names (ANTHROPIC_API_KEY) — the catalog's runtime.env
    // block maps between them server-side.
    test("carries catalog labels into the shared credential form", () => {
      const detail = runtimeEntryAsAppDetail(
        entry({
          credential_fields: [
            { name: "api_key", label: "API Key", description: "From console.anthropic.com" },
          ],
        }),
      );
      expect(detail.auth.types).toEqual(["api_key"]);
      expect(detail.auth.credential_fields?.[0]?.label).toBe("API Key");
      expect(detail.auth.credential_fields?.[0]?.name).toBe("api_key");
      expect(detail.name).toBe("Anthropic");
    });

    test("preserves multi-field providers", () => {
      const detail = runtimeEntryAsAppDetail(
        entry({
          slug: "openai-api",
          auth_types: ["bearer"],
          credential_fields: [
            { name: "token", label: "API Key" },
            { name: "organizationId", label: "Organization ID" },
          ],
        }),
      );
      expect(detail.auth.credential_fields?.map((f) => f.name)).toEqual([
        "token",
        "organizationId",
      ]);
    });
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
