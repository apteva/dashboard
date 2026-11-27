import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const originalChat = { ...await import("./chatComponents") };
const originalEvents = { ...await import("../../hooks/usePanelEvents") };
const originalProjects = { ...await import("../../hooks/useProjects") };
const received = mock((_props: any) => null);
const projects = [
  { id: "p1", name: "Sales", color: "#10B981" },
  { id: "p2", name: "Support", color: "" },
];
mock.module("./chatComponents", () => ({ ...originalChat, ChatComponentMount: received }));
mock.module("../../hooks/usePanelEvents", () => ({ ...originalEvents, usePanelEvents: () => ({ eventRevision: 0 }) }));
mock.module("../../hooks/useProjects", () => ({ ...originalProjects, useProjects: () => ({ projects }) }));
const { ContributionMount } = await import("./contributions");
afterEach(() => { cleanup(); received.mockClear(); });
afterAll(() => {
  mock.module("./chatComponents", () => originalChat);
  mock.module("../../hooks/usePanelEvents", () => originalEvents);
  mock.module("../../hooks/useProjects", () => originalProjects);
});
const app = { install_id: 7, name: "crm", version: "1.0.0" };
const instance = { id: "inbox", component: "crm:inbox", size: "half" as const,
  contribution: { key: "crm:inbox", app, spec: { name: "inbox", entry: "/ui/inbox.mjs" } } };
const widgetContextOf = () => received.mock.calls.at(-1)![0].comp.props.widgetContext;

test("a global widget receives every project with its colour", () => {
  render(<ContributionMount instance={instance} apps={[app]} dashboardScope="global" slot="dashboard.home" />);
  expect(widgetContextOf().projects).toEqual([
    { id: "p1", name: "Sales", color: "#10b981" },
    { id: "p2", name: "Support", color: "" },
  ]);
});

test("a project widget receives only its own project", () => {
  render(<ContributionMount instance={instance} apps={[app]} projectId="p1" slot="dashboard.home" />);
  expect(widgetContextOf().projects).toEqual([{ id: "p1", name: "Sales", color: "#10b981" }]);
});
