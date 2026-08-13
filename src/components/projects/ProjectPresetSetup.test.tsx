import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectPresetSetup } from "./ProjectPresetSetup";

afterEach(() => {
  cleanup();
  mock.restore();
});

const businessPreset = {
  id: "business-lead-generation",
  category: "business" as const,
  name: "Lead-generation business",
  description: "Operate lead research and CRM follow-up.",
  agents: [{
    key: "lead-ops",
    name: "Lead Operations Agent",
    directive: "Use the project description as operating context.",
    mode: "cautious" as const,
    apps: ["tasks", "crm"],
  }],
  dashboard: ["native:inbox"],
};

const personalPreset = {
  ...businessPreset,
  id: "personal-assistant",
  category: "personal" as const,
  name: "Personal assistant",
};

const project = {
  id: "project-1",
  user_id: 1,
  name: "Default",
  description: "",
  color: "#6366f1",
  created_at: "",
};

describe("ProjectPresetSetup", () => {
  test("always filters the catalog by one selected category", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/project-presets")) {
        return Response.json({ schema_version: 1, presets: [personalPreset, businessPreset] });
      }
      if (url.endsWith("/api/projects") && (!init?.method || init.method === "GET")) {
        return Response.json([project]);
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    render(<ProjectPresetSetup projectId="project-1" />);

    const personal = await screen.findByRole("button", { name: "Personal" });
    expect(screen.getByRole("button", { name: /Personal assistant/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lead-generation business/ })).toBeNull();

    fireEvent.click(personal);
    expect(screen.getByRole("button", { name: /Personal assistant/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lead-generation business/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Business" }));
    expect(screen.queryByRole("button", { name: /Personal assistant/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Lead-generation business/ })).toBeTruthy();
  });

  test("creates every preset agent with authoritative preset app assignments", async () => {
    const onApplied = mock(() => {});
    const calls: Array<{ url: string; method: string; body?: any }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/api/project-presets")) {
        return Response.json({ schema_version: 1, presets: [businessPreset] });
      }
      if (url.endsWith("/api/projects") && method === "GET") {
        return Response.json([project]);
      }
      if (url.endsWith("/setup/apply")) {
        return Response.json({
          status: "applied",
          project_id: "project-1",
          preset_id: businessPreset.id,
          created_agents: [{ id: 9, name: "Lead Operations Agent", status: "stopped" }],
          existing_agents: [],
          warnings: [],
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    render(<ProjectPresetSetup projectId="project-1" onApplied={onApplied} />);

    fireEvent.change(await screen.findByLabelText("What should these agents help with?"), {
      target: { value: "Qualify medical clinic leads and prepare outreach for review" },
    });
    expect(screen.getByRole("region", { name: "What this setup includes" })).toBeTruthy();
    expect(screen.getByText("Lead Operations Agent")).toBeTruthy();
    expect(screen.getByText("crm", { selector: "span" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create setup" }));

    expect(await screen.findByText(/Setup created/)).toBeTruthy();
    const apply = calls.find((call) => call.url.endsWith("/setup/apply"));
    expect(apply?.body).toEqual({
      preset_id: "business-lead-generation",
      description: "Qualify medical clinic leads and prepare outreach for review",
    });
    expect(calls.some((call) => call.url.endsWith("/setup/preview"))).toBe(false);
    expect(onApplied).toHaveBeenCalledWith({
      created: 1,
      existing: 0,
      createdAgents: [{ id: 9, name: "Lead Operations Agent", status: "stopped" }],
    });
  });
});
