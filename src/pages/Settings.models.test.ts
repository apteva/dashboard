import { describe, expect, test } from "bun:test";
import {
  availableRuntimeEntries,
  groupRuntimeConnectionsByProvider,
  primaryRuntimeConnections,
} from "./Settings";
import type { RuntimeCatalogEntry, RuntimeConnection } from "../api";

function connection(over: Partial<RuntimeConnection> = {}): RuntimeConnection {
  return {
    id: 1,
    name: "key",
    app_slug: "opencode-go",
    app_name: "OpenCode Go",
    provider_key: "opencode-go",
    role: "llm",
    project_id: "",
    scope: "global",
    is_primary: false,
    runtime_config: {},
    ...over,
  };
}

function catalogEntry(over: Partial<RuntimeCatalogEntry> = {}): RuntimeCatalogEntry {
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

describe("primaryRuntimeConnections", () => {
  // The server sorts by (project scope, is_primary, id), so first-wins
  // is the whole precedence rule. Reimplementing it here is what the
  // deleted runtimeProviderKey()/isTextProvider() pair used to do.
  test("keeps the first connection per provider", () => {
    const result = primaryRuntimeConnections([
      connection({ id: 56, name: "chosen", is_primary: true }),
      connection({ id: 54, name: "other" }),
      connection({ id: 12, app_slug: "gemini", provider_key: "google", name: "gemini" }),
    ]);
    expect(result.map((row) => row.id)).toEqual([56, 12]);
  });

  test("does not reorder providers", () => {
    const result = primaryRuntimeConnections([
      connection({ id: 1, app_slug: "gemini", provider_key: "google" }),
      connection({ id: 2, app_slug: "anthropic-api", provider_key: "anthropic" }),
    ]);
    expect(result.map((row) => row.provider_key)).toEqual(["google", "anthropic"]);
  });

  test("handles an empty list", () => {
    expect(primaryRuntimeConnections([])).toEqual([]);
  });
});

describe("groupRuntimeConnectionsByProvider", () => {
  test("buckets several credentials under one provider", () => {
    const groups = groupRuntimeConnectionsByProvider([
      connection({ id: 54 }),
      connection({ id: 56 }),
      connection({ id: 58 }),
      connection({ id: 12, app_slug: "gemini", provider_key: "google" }),
    ]);
    expect(groups.length).toBe(2);
    const [key, group] = groups[0]!;
    expect(key).toBe("opencode-go");
    // A group of more than one is exactly where the primary radio
    // renders; singletons show no control because there is no choice.
    expect(group.map((row) => row.id)).toEqual([54, 56, 58]);
    expect(groups[1]![1].length).toBe(1);
  });

  test("preserves server order within a group", () => {
    const groups = groupRuntimeConnectionsByProvider([
      connection({ id: 58, is_primary: true }),
      connection({ id: 54 }),
    ]);
    expect(groups[0]![1].map((row) => row.id)).toEqual([58, 54]);
  });
});

describe("availableRuntimeEntries", () => {
  test("hides providers already connected", () => {
    const available = availableRuntimeEntries(
      [catalogEntry(), catalogEntry({ slug: "gemini", provider_key: "google", name: "Gemini" })],
      [connection({ app_slug: "gemini", provider_key: "google" })],
    );
    expect(available.map((entry) => entry.slug)).toEqual(["anthropic-api"]);
  });

  // Keyed on slug, not provider_key: an extra credential for an already
  // connected provider is added from its existing card, but a different
  // catalog entry mapping to the same runtime stays offerable.
  test("keys on slug rather than provider key", () => {
    const available = availableRuntimeEntries(
      [catalogEntry({ slug: "openai-codex", provider_key: "openai-codex" })],
      [connection({ app_slug: "openai-api", provider_key: "openai" })],
    );
    expect(available.map((entry) => entry.slug)).toEqual(["openai-codex"]);
  });

  test("returns everything when nothing is connected", () => {
    expect(availableRuntimeEntries([catalogEntry()], []).length).toBe(1);
  });
});
