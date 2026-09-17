import { describe, expect, test } from "bun:test";
import {
  isTypeableRuntimeEntry,
  isOnboardingRuntimeEntry,
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
  test("connects AI before workspace configuration", () => {
    expect([...ONBOARDING_STEP_IDS]).toEqual(["provider", "setup"]);
  });

  describe("runtime provider picker", () => {
    test("offers providers whose key can simply be pasted", () => {
      expect(isTypeableRuntimeEntry(entry())).toBe(true);
      expect(isTypeableRuntimeEntry(entry({ auth_types: ["bearer"] }))).toBe(true);
    });

    test("interactive sign-in is separate from pasted credentials", () => {
      expect(
        isTypeableRuntimeEntry(
          entry({ slug: "openai-codex", auth_types: ["oauth_device_code"] }),
        ),
      ).toBe(false);
      expect(isTypeableRuntimeEntry(entry({ auth_types: ["oauth2"] }))).toBe(false);
    });

    test("offers device-code providers without requiring credential fields", () => {
      expect(isOnboardingRuntimeEntry(entry({ slug: "openai-codex", auth_types: ["oauth_device_code"], credential_fields: [] }))).toBe(true);
      expect(isOnboardingRuntimeEntry(entry())).toBe(true);
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

});
