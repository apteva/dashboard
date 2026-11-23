import { expect, test } from "bun:test";
import { agentTemplates, instances } from "./api";

function captureRequests() {
  const previous = globalThis.fetch;
  const calls: { url: string; method: string; body: any }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ id: 1, linked: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
}

test("agent creation sends the template link only for a real template", async () => {
  const { calls, restore } = captureRequests();
  try {
    await instances.create("Pinned", "role", "learn", undefined, false, { templateId: "research", templateVersion: 3, followTemplate: false });
    await instances.create("Following", "role", "learn", undefined, false, { templateId: "mine", followTemplate: true });
    await instances.create("Scratch", "role", "learn", undefined, false, { templateId: "empty", templateVersion: 1 });
    await instances.create("Plain", "role", "learn");
    expect(calls[0]!.body).toMatchObject({ template_id: "research", template_version: 3, follow_template: false });
    expect(calls[1]!.body).toMatchObject({ template_id: "mine", follow_template: true });
    expect(calls[1]!.body).not.toHaveProperty("template_version");
    for (const call of calls.slice(2)) {
      expect(call.body).not.toHaveProperty("template_id");
      expect(call.body).not.toHaveProperty("template_version");
      expect(call.body).not.toHaveProperty("follow_template");
    }
  } finally { restore(); }
});

test("template link calls use the agent's template routes and expected_version guards edits", async () => {
  const { calls, restore } = captureRequests();
  try {
    await instances.template.get(7);
    await instances.template.set(7, { version: 2 });
    await instances.template.unlink(7);
    await instances.template.save(7, { name: "Support" });
    await agentTemplates.version("my template", 4);
    await agentTemplates.update("t1", { name: "T" }, 5);
    await agentTemplates.update("t1", { name: "T" });
    expect(calls.map((call) => `${call.method} ${call.url.replace(/^.*\/api/, "")}`)).toEqual([
      "GET /agents/7/template",
      "PUT /agents/7/template",
      "DELETE /agents/7/template",
      "POST /agents/7/template/save",
      "GET /agent-templates/my%20template/versions/4",
      "PUT /agent-templates/t1",
      "PUT /agent-templates/t1",
    ]);
    expect(calls[1]!.body).toEqual({ version: 2 });
    expect(calls[5]!.body).toEqual({ name: "T", expected_version: 5 });
    expect(calls[6]!.body).toEqual({ name: "T" });
  } finally { restore(); }
});
