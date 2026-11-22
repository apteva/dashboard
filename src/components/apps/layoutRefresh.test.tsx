import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { auth, type TelemetryEvent } from "../../api";
import { isLayoutToolResult, refreshUILayout, useProjectUILayout, useUILayoutRefresh, type WidgetInstance } from "./contributions";

const originalMe = auth.me;
const originalBus = window.__aptevaTelemetryBus;
afterEach(() => { cleanup(); auth.me = originalMe; window.__aptevaTelemetryBus = originalBus; });

const home = (component: string): WidgetInstance[] => [{ id: component, component, size: "half" }];
const profile = (projectId: string, component: string, revision: number) =>
  ({ ui_layout: { projects: { [projectId]: { slots: { "dashboard.home": home(component) } } } }, ui_layout_revision: revision }) as never;
const toolResult = (name: string, success = true) =>
  ({ id: `${name}:${success}`, type: "tool.result", data: { name, success }, instance_id: 1, thread_id: "main", time: new Date().toISOString() }) as TelemetryEvent;

test("recognises completed agent edits of Pages and widgets only", () => {
  expect(isLayoutToolResult(toolResult("apteva-server_widget_add"))).toBe(true);
  expect(isLayoutToolResult(toolResult("widget_configure"))).toBe(true);
  expect(isLayoutToolResult(toolResult("apteva-server_page_create"))).toBe(true);
  expect(isLayoutToolResult(toolResult("apteva-server_page_get"))).toBe(false);
  expect(isLayoutToolResult(toolResult("apteva-server_widget_add", false))).toBe(false);
  expect(isLayoutToolResult(toolResult("notes_widget_add"))).toBe(false);
  expect(isLayoutToolResult({ ...toolResult("apteva-server_widget_add"), type: "tool.call" })).toBe(false);
});

test("shows a newer saved layout and ignores an older one", async () => {
  const { result } = renderHook(() => useProjectUILayout("refresh-project"));
  auth.me = mock(async () => profile("refresh-project", "native:apps", 3));
  await act(() => refreshUILayout());
  expect(result.current.project.slots?.["dashboard.home"]).toEqual(home("native:apps"));

  auth.me = mock(async () => profile("refresh-project", "native:agents", 2));
  await act(() => refreshUILayout());
  expect(result.current.project.slots?.["dashboard.home"]).toEqual(home("native:apps"));
});

test("reloads the layout when an agent's widget tool finishes", async () => {
  let listener: ((event: TelemetryEvent) => void) | undefined;
  window.__aptevaTelemetryBus = {
    ...originalBus!,
    subscribe: (_instance, fn) => { listener = fn; return () => { listener = undefined; }; },
  };
  const me = mock(async () => profile("agent-project", "native:usage", 9));
  auth.me = me;
  const { result } = renderHook(() => {
    useUILayoutRefresh(true);
    return useProjectUILayout("agent-project");
  });
  await waitFor(() => expect(listener).toBeDefined());

  act(() => listener!(toolResult("apteva-server_page_get")));
  expect(me).not.toHaveBeenCalled();

  act(() => listener!(toolResult("apteva-server_widget_add")));
  await waitFor(() => expect(result.current.project.slots?.["dashboard.home"]).toEqual(home("native:usage")));
  expect(me).toHaveBeenCalledTimes(1);
});
