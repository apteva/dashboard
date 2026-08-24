import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider } from "../../hooks/useAuth";
import { PresetSettings } from "./PresetSettings";

afterEach(() => {
  cleanup();
  mock.restore();
});

const project = { id: "project-1", user_id: 1, name: "Operations", description: "", color: "#6366f1", created_at: "" };
const systemPreset = {
  id: "work-ops", kind: "project_setup", scope: "system", source: "system", schema_version: 1,
  name: "Operations starter", description: "A starting point.",
  definition: { category: "work", agents: [{ key: "operator", name: "Operator", directive: "Operate.", mode: "cautious", apps: ["notes"] }], dashboard: ["native:usage"] },
};

function renderSettings() {
  render(<AuthProvider><PresetSettings /></AuthProvider>);
}

describe("PresetSettings", () => {
  test("captures a project through the generic presets API", async () => {
    const calls: Array<{ url: string; method: string; body?: any }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/api/auth/me")) return Response.json({ user_id: 1, email: "admin@test.local", role: "admin", created_at: "", onboarded: true });
      if (url.endsWith("/api/presets") && method === "GET") return Response.json({ presets: [systemPreset] });
      if (url.endsWith("/api/projects")) return Response.json([project]);
      if (url.endsWith("/api/presets/capture") && method === "POST") return Response.json({ ...systemPreset, id: "usr-1-operations", name: body.name, scope: body.scope, source: "user", owner_id: 1 }, { status: 201 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

	renderSettings();
	const saveProject = await screen.findByRole("button", { name: "Save project as preset" });
	await waitFor(() => expect(saveProject.hasAttribute("disabled")).toBe(false));
	fireEvent.click(saveProject);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My operations" } });
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "shared" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/presets/capture") && call.method === "POST")).toBe(true));
    const capture = calls.find((call) => call.url.endsWith("/api/presets/capture"));
    expect(capture?.body).toEqual({ project_id: "project-1", name: "My operations", description: "", category: "work", scope: "shared" });
  });

  test("duplicates a built-in preset as a personal editable preset", async () => {
    const creates: any[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (url.endsWith("/api/auth/me")) return Response.json({ user_id: 1, email: "admin@test.local", role: "admin", created_at: "", onboarded: true });
      if (url.endsWith("/api/projects")) return Response.json([project]);
      if (url.endsWith("/api/presets") && method === "GET") return Response.json({ presets: [systemPreset] });
      if (url.endsWith("/api/presets") && method === "POST") {
        creates.push(JSON.parse(String(init?.body)));
        return Response.json({ ...systemPreset, id: "usr-1-copy", name: "Copy of Operations starter", scope: "personal", source: "user", owner_id: 1 }, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(creates.length).toBe(1));
    expect(creates[0].scope).toBe("personal");
    expect(creates[0].definition).toEqual(systemPreset.definition);
  });
});
