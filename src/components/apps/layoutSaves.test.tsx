import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { auth } from "../../api";
import { useProjectUILayout, type WidgetInstance } from "./contributions";

const originalPatch = auth.patchUILayoutSurface;
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); auth.patchUILayoutSurface = originalPatch; globalThis.fetch = originalFetch; });

const widget = (id: string): WidgetInstance => ({ id, component: "native:agents", size: "quarter" });
const conflict = (projectId: string, slots: Record<string, unknown>, revision: number) =>
  Object.assign(new Error("layout changed in another session"), {
    status: 409,
    body: { error: "layout changed in another session", revision, ui_layout: { projects: { [projectId]: { slots } } } },
  });

test("sends the known revision and the latest one after another surface changed", async () => {
  const sidebar = [{ id: "pinned", component: "notes:list", size: "half" }];
  const patch = mock(async (projectId: string, surface: string, value: unknown[], revision?: number) => {
    if (revision === 0) throw conflict(projectId, { "dashboard.sidebar": sidebar }, 4);
    return { value, revision: 5, ui_layout: { projects: { [projectId]: { slots: { "dashboard.sidebar": sidebar, [surface]: value } } } } };
  });
  auth.patchUILayoutSurface = patch as never;
  const { result } = renderHook(() => useProjectUILayout("retry-project"));

  await act(() => result.current.updateSurface("dashboard.home", [widget("a")]));

  expect(patch.mock.calls.map((call) => call[3])).toEqual([0, 4]);
  expect(result.current.saveState).toBe("saved");
  expect(Object.keys(result.current.project.slots || {}).sort()).toEqual(["dashboard.home", "dashboard.sidebar"]);
});

test("shows the other session's layout when it changed the same surface", async () => {
  const theirs: WidgetInstance[] = [{ id: "theirs", component: "native:apps", size: "full" }];
  const patch = mock(async (projectId: string) => { throw conflict(projectId, { "dashboard.home": theirs }, 7); });
  auth.patchUILayoutSurface = patch as never;
  const { result } = renderHook(() => useProjectUILayout("conflict-project"));

  await act(() => result.current.updateSurface("dashboard.home", [widget("mine")]));

  expect(patch).toHaveBeenCalledTimes(1);
  expect(result.current.saveState).toBe("conflict");
  expect(result.current.project.slots?.["dashboard.home"]).toEqual(theirs);
});

test("refuses a project layout save without a project instead of dropping it", async () => {
  const patch = mock(async () => ({ value: [], revision: 1, ui_layout: {} }));
  auth.patchUILayoutSurface = patch as never;
  const { result } = renderHook(() => useProjectUILayout(undefined));

  let failure: unknown;
  await act(async () => {
    await result.current.updateSurface("dashboard.home", [widget("a")], { rejectOnError: true }).catch((error) => { failure = error; });
  });

  expect(String(failure)).toContain("Choose a project");
  expect(result.current.saveState).toBe("error");
  expect(patch).not.toHaveBeenCalled();
});

test("puts the revision in If-Match only when one is known", async () => {
  const headers: Array<Record<string, string>> = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    headers.push({ ...(init?.headers as Record<string, string>) });
    return new Response(JSON.stringify({ value: [], revision: 1, ui_layout: {} }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  await auth.patchGlobalUILayoutSurface("dashboard.home", [], 3);
  await auth.patchUILayoutSurface("p1", "dashboard.home", []);

  expect(headers[0]["If-Match"]).toBe('"3"');
  expect(headers[1]).not.toHaveProperty("If-Match");
});
