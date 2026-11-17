import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const originalChat = { ...await import("./chatComponents") };
const originalEvents = { ...await import("../../hooks/usePanelEvents") };
const received = mock((_props: any) => null);
mock.module("./chatComponents", () => ({ ...originalChat, ChatComponentMount: received }));
mock.module("../../hooks/usePanelEvents", () => ({ ...originalEvents, usePanelEvents: () => ({ eventRevision: 0 }) }));
const { ContributionMount } = await import("./contributions");
afterEach(() => { cleanup(); received.mockClear(); });
afterAll(() => {
  mock.module("./chatComponents", () => originalChat);
  mock.module("../../hooks/usePanelEvents", () => originalEvents);
});
const app = { install_id: 7, name: "conversations", version: "0.24.19" };
const instance = { id: "helper", component: "conversations:agent-conversations", size: "full" as const,
  contribution: { key: "conversations:agent-conversations", app, spec: { name: "agent-conversations", entry: "/ui/widget.mjs" } },
  settings: { welcome_text: "Build something", context_label: "Discussing" } };
test("forwards the optional composer reference and scope to the app contribution", () => {
  const composerRef = mock(() => {});
  render(<ContributionMount composerRef={composerRef} instance={instance} apps={[app]} projectId="p1" agentId={42} slot="dashboard.build" />);
  const props = received.mock.calls.at(-1)![0];
  expect(props.projectId).toBe("p1");
  expect(props.comp.props.composerRef).toBe(composerRef);
  expect(props.comp.props.instanceId).toBe(42);
  expect(props.comp.props.widgetSettings).toEqual(instance.settings);
});
test("ordinary widgets receive no composer property", () => {
  render(<ContributionMount instance={instance} apps={[app]} projectId="p1" slot="dashboard.home" />);
  expect(Object.hasOwn(received.mock.calls.at(-1)![0].comp.props, "composerRef")).toBe(false);
});
