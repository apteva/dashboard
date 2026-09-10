import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { integrations, type AppDetail, type AppSummary, type ConnectionInfo } from "../api";
import { Integrations } from "./Integrations";

const originals = { ...integrations };
afterEach(() => { cleanup(); Object.assign(integrations, originals); });
const apps: AppSummary[] = [
  { slug: "alpha", name: "Alpha CRM", description: "Manage customer relationships", categories: ["sales"], logo: null, auth_types: ["api_key"], tool_count: 4, has_webhooks: false },
  { slug: "beta", name: "Beta Mail", description: "Send newsletters", categories: ["email"], logo: null, auth_types: ["api_key"], tool_count: 8, has_webhooks: false },
];
const detail: AppDetail = { ...apps[0]!, base_url: "", auth: { types: ["api_key"], credential_fields: [] }, tools: [] };
function setup() {
  integrations.connections = mock(async () => Array.from({ length: 47 }, (_, i) => ({
    id: i + 1, name: `Connected service ${i + 1}`, app_name: "Alpha CRM", app_slug: "alpha", source: "local", status: "active", project_id: "project-1", auth_type: "api_key", tool_count: 4,
  } as ConnectionInfo)));
  integrations.catalog = mock(async () => apps);
  integrations.listGroups = mock(async () => [{ id: "office", name: "Office Suite", description: "Workspace services", members: [{ slug: "calendar", name: "Calendar", tool_count: 2 }], has_account_scope: true, has_project_scope: false }]);
  integrations.app = mock(async () => detail);
  render(<MemoryRouter><Integrations /></MemoryRouter>);
}

test("catalog opens from the top with 47 connections and selection opens one setup dialog", async () => {
  setup();
  await screen.findByText("Connected (47)");
  expect(integrations.catalog).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Connect Alpha CRM" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Search connected integrations"), { target: { value: "service 47" } });
  expect(screen.getByRole("button", { name: "Open Connected service 47 connection" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open Connected service 1 connection" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add integration" }));
  const modal = await screen.findByRole("dialog", { name: "Add integration" });
  await within(modal).findByRole("button", { name: "Connect Alpha CRM" });
  expect(within(modal).getByText("47 connections")).toBeTruthy();
  fireEvent.click(within(modal).getByRole("button", { name: "Connect Alpha CRM" }));
  await screen.findByRole("dialog", { name: "Connect Alpha CRM" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.queryByLabelText("Search integrations")).toBeNull();
  expect(integrations.app).toHaveBeenCalledWith("alpha");
});

test("search matches descriptions and suite members; categories and empty states clear correctly", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Add integration" }));
  await screen.findByRole("button", { name: "Connect Alpha CRM" });
  fireEvent.change(screen.getByLabelText("Search integrations"), { target: { value: "CUSTOMER" } });
  expect(screen.getByRole("button", { name: "Connect Alpha CRM" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect Beta Mail" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Search integrations"), { target: { value: "calendar" } });
  expect(screen.getByRole("button", { name: "Connect Office Suite" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Integration category"), { target: { value: "email" } });
  expect(screen.getByText("No integrations found")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.change(screen.getByLabelText("Integration category"), { target: { value: "email" } });
  expect(screen.getByRole("button", { name: "Connect Beta Mail" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect Alpha CRM" })).toBeNull();
  expect(integrations.catalog).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("catalog load errors can be retried and detail errors keep selection available", async () => {
  setup();
  integrations.catalog = mock(async () => { throw new Error("Offline"); });
  fireEvent.click(screen.getByRole("button", { name: "Add integration" }));
  await screen.findByRole("alert");
  integrations.catalog = mock(async () => apps);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Connect Alpha CRM" });
  integrations.app = mock(async () => { throw new Error("Offline"); });
  fireEvent.click(screen.getByRole("button", { name: "Connect Alpha CRM" }));
  await screen.findByText("Couldn't open Alpha CRM. Please try again.");
  await waitFor(() => expect((screen.getByRole("button", { name: "Connect Alpha CRM" }) as HTMLButtonElement).disabled).toBe(false));
});

test("closing the catalog cancels a pending selection", async () => {
  setup();
  let resolve!: (app: AppDetail) => void;
  integrations.app = mock(() => new Promise<AppDetail>((done) => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Add integration" }));
  fireEvent.click(await screen.findByRole("button", { name: "Connect Alpha CRM" }));
  fireEvent.click(screen.getByRole("button", { name: "Close integration catalog" }));
  await act(async () => { resolve(detail); });
  expect(screen.queryByRole("dialog")).toBeNull();
});
