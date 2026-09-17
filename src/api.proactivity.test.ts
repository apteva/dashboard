import { expect, test } from "bun:test";
import { instances } from "./api";

test("creation and config updates serialize explicit zero and omit unspecified proactivity", async () => {
  const previous = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: 1 }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await instances.create("Reactive", "role", "cautious", undefined, false, { proactivity: 0 });
    await instances.updateConfig(1, { proactivity: 0 });
    await instances.updateConfig(1, { mode: "learn" });
    expect(bodies[0]?.proactivity).toBe(0);
    expect(bodies[0]?.mode).toBe("cautious");
    expect(bodies[1]?.proactivity).toBe(0);
    expect(bodies[2]).not.toHaveProperty("proactivity");
  } finally { globalThis.fetch = previous; }
});
