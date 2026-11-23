import { describe, expect, test } from "bun:test";
import type { AgentTemplate, AppRow } from "../api";
import { boundAppInstallIDsPayload } from "../api";
import { defaultAgentAppInstallIDs, effectiveAgentAppInstallIDs, wizardFollowsTemplate, wizardTemplateCreateOptions } from "./AgentNew";

function app(installId: number, isDefault: boolean, status: AppRow["status"] = "running"): AppRow {
  return {
    install_id: installId,
    app_id: installId,
    name: `app-${installId}`,
    display_name: `App ${installId}`,
    version: "1.0.0",
    description: "",
    icon: "",
    project_id: "project-a",
    status,
    source: "registry",
    upgrade_policy: "manual",
    default_for_new_agents: isDefault,
    permissions: [],
    surfaces: {
      kind: "service",
      mcp_tool_count: 1,
      skill_count: 0,
      http_route_count: 0,
      ui_panel_count: 0,
      ui_app: false,
      channel_count: 0,
      worker_count: 0,
      prompt_fragment_count: 0,
    },
  };
}

describe("new-agent default apps", () => {
  test("preselects only running apps marked as defaults", () => {
    const selected = defaultAgentAppInstallIDs([
      app(1, true),
      app(2, false),
      app(3, true, "disabled"),
    ]);
    expect(Array.from(selected)).toEqual([1]);
  });

  test("preserves explicit empty opt-out in the API payload", () => {
    expect(boundAppInstallIDsPayload(undefined)).toEqual({});
    expect(boundAppInstallIDsPayload([])).toEqual({ bound_app_install_ids: [] });
    expect(boundAppInstallIDsPayload([4])).toEqual({ bound_app_install_ids: [4] });
  });

  test("keeps template-required apps attached even when optional defaults are unchecked", () => {
    expect(effectiveAgentAppInstallIDs([], [app(7, false), app(8, true)], ["app-7"])).toEqual([7]);
  });
});

describe("template link for a new agent", () => {
  const template = (source: AgentTemplate["source"], id = "t1") => ({ id, source, version: 4 }) as AgentTemplate;

  test("the user's own templates are followed and others stay pinned unless the operator chooses", () => {
    expect(wizardFollowsTemplate(template("user"), {})).toBe(true);
    expect(wizardFollowsTemplate(template("builtin"), {})).toBe(false);
    expect(wizardFollowsTemplate(template("app"), {})).toBe(false);
    expect(wizardFollowsTemplate(template("builtin"), { followTemplate: true })).toBe(true);
    expect(wizardFollowsTemplate(template("user"), { followTemplate: false })).toBe(false);
  });

  test("a following agent takes the latest version and a pinned one names the version shown", () => {
    expect(wizardTemplateCreateOptions(template("user"), {})).toEqual({ templateId: "t1", followTemplate: true });
    expect(wizardTemplateCreateOptions(template("builtin"), {})).toEqual({ templateId: "t1", templateVersion: 4, followTemplate: false });
    expect(wizardTemplateCreateOptions(template("builtin", "empty"), {})).toEqual({});
    expect(wizardTemplateCreateOptions(null, {})).toEqual({});
  });
});
