import { expect, test } from "bun:test";
import type { AppRow, MarketplaceEntry } from "../api";
import { agentAppRecommendations } from "./agentAppRecommendations";
const app = (name: string, project_id: string, id: number, metadata?: object) =>
  ({
    name,
    project_id,
    install_id: id,
    status: "running",
    display_name: name,
    agent_setup: metadata,
  }) as AppRow;
const catalog = (name: string, recommended = true) =>
  ({
    name,
    display_name: name,
    agent_setup: { recommended, reason: "Registry reason" },
    manifest_url: "https://example.test/manifest",
  }) as MarketplaceEntry;

test("recommendations combine template and manifest hints, deduplicate scope and omit selected or deprecated apps", () => {
  const result = agentAppRecommendations(
    [
      app("arbitrary", "", 1, { recommended: true, reason: "Global reason" }),
      app("arbitrary", "p", 2, { recommended: true, reason: "Project reason" }),
      app("private", "other", 3, { recommended: true }),
      app("legacy", "p", 4),
      app("opted-out", "p", 5, { recommended: false }),
    ],
    [
      catalog("arbitrary"),
      catalog("opted-out"),
      catalog("selected"),
      { ...catalog("retired"), deprecated: true },
      catalog("uninstalled"),
    ],
    ["legacy"],
    new Set(["selected"]),
    "p",
  );
  expect(result.map((r) => r.slug)).toEqual([
    "legacy",
    "arbitrary",
    "uninstalled",
  ]);
  expect(result[1].installed?.install_id).toBe(2);
  expect(result[1].reason).toBe("Project reason");
  expect(result[0].fromTemplate).toBe(true);
});
test("apps without metadata gain no recommendation by their name, and visible installed releases override registry hints", () => {
  expect(
    agentAppRecommendations(
      [app("a2a", "", 1), app("tasks", "", 2)],
      [catalog("a2a"), catalog("tasks")],
      [],
      new Set(),
      "p",
    ),
  ).toEqual([]);
  expect(
    agentAppRecommendations(
      [app("private", "other", 3, { recommended: true })],
      [],
      [],
      new Set(),
      "p",
    ),
  ).toEqual([]);
});
