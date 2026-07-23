import { describe, expect, test } from "bun:test";
import type { MCPServer } from "../api";
import {
  globalHelperCapabilityInventory,
  helperCapabilityKind,
} from "./helperCapabilities";

function row(overrides: Partial<MCPServer>): MCPServer {
  return {
    id: 1,
    name: "capability",
    command: "",
    args: "",
    description: "",
    status: "running",
    tool_count: 1,
    pid: 0,
    source: "app",
    connection_id: 0,
    created_at: "",
    proxy_config: {
      name: overrides.name || "capability",
      transport: "http",
      url: "http://127.0.0.1/mcp",
    },
    ...overrides,
  };
}

describe("globalHelperCapabilityInventory", () => {
  test("keeps only attachable global apps and integrations", () => {
    const result = globalHelperCapabilityInventory([
      row({ id: 1, name: "global-app", description: "B app", source: "app", project_id: "" }),
      row({ id: 2, name: "global-integration", description: "A integration", source: "local" }),
      row({ id: 3, name: "project-app", source: "app", project_id: "project-a" }),
      row({ id: 4, name: "custom", source: "custom" }),
      row({ id: 5, name: "unattachable", source: "remote", proxy_config: undefined }),
    ]);

    expect(result.map((candidate) => candidate.id)).toEqual([2, 1]);
    expect(result.map(helperCapabilityKind)).toEqual(["integration", "app"]);
  });
});
