import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatComponentMount, componentAllowedInSlot, type InstalledAppRow, type UIComponentSpec } from "./chatComponents";
import { ContributionMount, contributionsFor } from "./contributions";

const pageSlot = "page.50e70d75b13031e3adff2e799b45c566";
const apps: InstalledAppRow[] = [
  { name: "functions", install_id: 45, version: "1.16.0", status: "running", ui_components: [
    { name: "function-activity", entry: "/ui/FunctionActivityWidget.mjs", slots: ["dashboard.home"], visibility: "project", supported_sizes: ["half", "full"] },
  ] },
  { name: "telephony", install_id: 46, version: "0.10.3", status: "running", ui_components: [
    { name: "audio-health", entry: "/ui/AudioHealthWidget.mjs", slots: ["dashboard.home"], visibility: "project", supported_sizes: ["half", "full"] },
  ] },
  { name: "crm", install_id: 47, version: "1", status: "running", ui_components: [
    { name: "customer-inbox", entry: "/ui/Inbox.mjs", slots: ["dashboard.home"] },
  ] },
];
afterEach(cleanup);

describe("custom page widget discovery and mounting", () => {
  test.each(apps)("mounts $name dashboard widgets through the custom page contribution host", (app) => {
    const contributions = contributionsFor([app], pageSlot);
    expect(contributions).toHaveLength(1);
    const contribution = contributions[0]!;
    const html = renderToStaticMarkup(<ContributionMount
      instance={{ id: "widget", component: contribution.key, size: "half", contribution }}
      apps={[app]} slot={pageSlot} projectId="project-1"
    />);
    // SSR stops at the module's Suspense boundary; slot validation must pass first.
    expect(html).toContain(`data-app-contribution="${contribution.key}"`);
    expect(html).not.toContain("component unavailable");
    expect(html).not.toContain("not allowed in slot");
  });

  test.each(["chat.message_attachment", "dashboard.agent_card", "dashboard.build", "other.page", "page"])("rejects a dashboard widget in %s", (slot) => {
    expect(contributionsFor(apps, slot)).toEqual([]);
    const { container } = render(<ChatComponentMount comp={{ app: "telephony", name: "audio-health" }} apps={apps} slot={slot} projectId="p1" />);
    expect(container.textContent).toContain("not allowed in slot");
  });

  test("does not offer undeclared legacy components as dashboard contributions", () => {
    const legacy = { ...apps[0]!, ui_components: [{ name: "legacy", entry: "/ui/Legacy.mjs" }] };
    expect(contributionsFor([legacy], pageSlot)).toEqual([]);
    // Preserve the renderer's legacy unspecified-slot behavior for chat attachments.
    expect(componentAllowedInSlot(legacy.ui_components[0]!, "chat.message_attachment")).toBe(true);
  });

  test.each(["dashboard.home", pageSlot])("denies project-only widgets in a global %s even when mounted directly", (slot) => {
    expect(contributionsFor(apps, slot, "global")).toEqual([]);
    const { container } = render(<ChatComponentMount comp={{ app: "telephony", name: "audio-health" }} apps={apps} slot={slot} dashboardScope="global" />);
    expect(container.textContent).toContain("not allowed in slot");
  });

  test("allows explicit global opt-in while denying project use of a global-only widget", () => {
    const spec: UIComponentSpec = { ...apps[0]!.ui_components![0]!, dashboard_scopes: ["global"] };
    const app = { ...apps[0]!, ui_components: [spec] };
    expect(contributionsFor([app], pageSlot, "global")).toHaveLength(1);
    expect(componentAllowedInSlot(spec, pageSlot, "global")).toBe(true);
    expect(contributionsFor([app], pageSlot, "project")).toEqual([]);
    expect(componentAllowedInSlot(spec, pageSlot, "project")).toBe(false);
  });

  test("preserves exact contextual slots and explicit page registrations", () => {
    const contextual: UIComponentSpec = { name: "detail", entry: "/ui/Detail.mjs", slots: ["dashboard.agent_card"] };
    expect(componentAllowedInSlot(contextual, "dashboard.agent_card")).toBe(true);
    expect(componentAllowedInSlot(contextual, pageSlot)).toBe(false);
    expect(componentAllowedInSlot({ ...contextual, slots: [pageSlot] }, pageSlot)).toBe(true);
    expect(componentAllowedInSlot({ ...contextual, slots: ["project.page"] }, pageSlot)).toBe(true);
    expect(componentAllowedInSlot({ ...contextual, slots: [] }, pageSlot)).toBe(false);
  });
});
