import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { mcpServers, projectGrants, type Agent, type AgentProjectGrants as GrantsResponse, type MCPServer, type MCPServerConfig } from "../api";
import { AgentProjectGrants, grantSummary } from "./AgentProjectGrants";

const originalGet = projectGrants.get;
const originalSet = projectGrants.set;
const originalTools = mcpServers.tools;
afterEach(() => { cleanup(); projectGrants.get = originalGet; projectGrants.set = originalSet; mcpServers.tools = originalTools; });

const agent = { id: 7, name: "Manager", project_id: "home", status: "running" } as Agent;
const attached: MCPServerConfig[] = [
  { name: "billing", transport: "http" },
  { name: "apteva-server", transport: "http" },
  { name: "notion-remote", transport: "http" },
  { name: "ledger", transport: "http" },
] as MCPServerConfig[];
const inventory = [
  { id: 11, name: "billing", description: "Billing", source: "app", proxy_config: { name: "billing", transport: "http" } },
  { id: 12, name: "apteva-server", description: "Apteva Server", source: "builtin", proxy_config: { name: "apteva-server", transport: "http" } },
  { id: 13, name: "notion-remote", description: "Notion", source: "remote", proxy_config: { name: "notion-remote", transport: "http" } },
  { id: 14, name: "ledger", description: "Ledger", source: "app", proxy_config: { name: "ledger", transport: "http" } },
] as MCPServer[];
const projects = [{ id: "shop-a", name: "Shop A" }, { id: "shop-b", name: "Shop B" }];
// Ledger is attached through a project install, and Shop B has its own billing.
const empty: GrantsResponse = { grants: [], home_project_id: "home", projects, targets: { billing: ["shop-a"], "apteva-server": ["shop-a", "shop-b"] } };
const label = (row: MCPServer) => row.description || row.name;

test("defaults to this project only, for global apps and Apteva Server only", async () => {
  projectGrants.get = async () => empty;
  const view = render(<AgentProjectGrants instance={agent} attached={attached} inventory={inventory} label={label} />);
  await waitFor(() => expect(view.getAllByText("This project only").length).toBe(2));
  expect(view.getByText("Billing")).toBeTruthy();
  expect(view.getByText("Apteva Server")).toBeTruthy();
  expect(view.queryByText("Notion")).toBeNull();
  expect(view.queryByText("Ledger")).toBeNull();
});

test("offers only the projects the install reaches", async () => {
  projectGrants.get = async () => empty;
  mcpServers.tools = (() => new Promise(() => {})) as never;
  const view = render(<AgentProjectGrants instance={agent} attached={attached} inventory={inventory} label={label} />);
  await waitFor(() => expect(view.getAllByText("Change").length).toBe(2));
  fireEvent.click(view.getAllByText("Change")[0]);
  fireEvent.click(view.getByLabelText(/Chosen projects/));
  expect(view.getByLabelText("Shop A")).toBeTruthy();
  expect(view.queryByLabelText("Shop B")).toBeNull();
});

test("keeps a leftover grant listed so it can be removed", async () => {
  const leftover = { agent_id: 7, target: "ledger", all_projects: true, project_ids: [], tools: [], created_by: 1, updated_at: "" };
  projectGrants.get = async () => ({ ...empty, grants: [leftover] });
  const view = render(<AgentProjectGrants instance={agent} attached={attached} inventory={inventory} label={label} />);
  await waitFor(() => expect(view.getByText("Ledger")).toBeTruthy());
});

test("is hidden for global agents and Helper", () => {
  let reads = 0;
  projectGrants.get = async () => { reads++; return empty; };
  const view = render(<AgentProjectGrants instance={{ ...agent, project_id: "" }} attached={attached} inventory={inventory} label={label} />);
  expect(view.container.innerHTML).toBe("");
  view.rerender(<AgentProjectGrants instance={{ ...agent, kind: "platform_helper" }} attached={attached} inventory={inventory} label={label} />);
  expect(view.container.innerHTML).toBe("");
  expect(reads).toBe(0);
});

test("summarises a grant by project names and tool count", () => {
  const grant = { agent_id: 7, target: "billing", all_projects: false, project_ids: ["shop-a", "gone"], tools: ["invoices_list"], created_by: 1, updated_at: "" };
  expect(grantSummary(grant, projects)).toBe("Shop A, gone · 1 tool");
  expect(grantSummary({ ...grant, all_projects: true, tools: [] }, projects)).toBe("All projects you can edit");
});

test("saves chosen projects and tools, then removing restores the default", async () => {
  const writes: unknown[] = [];
  let current = empty;
  projectGrants.get = async () => current;
  projectGrants.set = async (_id, grant) => {
    writes.push(grant);
    current = grant.all_projects || grant.project_ids.length
      ? { ...empty, grants: [{ agent_id: 7, created_by: 1, updated_at: "", ...grant }] }
      : empty;
    return current;
  };
  mcpServers.tools = (async () => ({ tools: [{ name: "invoice_send" }, { name: "invoices_list" }], allowed_tools: null })) as never;
  const view = render(<AgentProjectGrants instance={agent} attached={attached} inventory={inventory} label={label} />);
  await waitFor(() => expect(view.getAllByText("Change").length).toBe(2));

  fireEvent.click(view.getAllByText("Change")[0]);
  fireEvent.click(view.getByLabelText(/Chosen projects/));
  fireEvent.click(view.getByLabelText("Shop A"));
  fireEvent.click(view.getByLabelText("Only some tools"));
  await waitFor(() => expect(view.getByLabelText("invoices_list")).toBeTruthy());
  fireEvent.click(view.getByLabelText("invoices_list"));
  fireEvent.click(view.getByText("Save"));
  await waitFor(() => expect(view.getByText("Shop A · 1 tool")).toBeTruthy());
  expect(writes[0]).toEqual({ target: "billing", all_projects: false, project_ids: ["shop-a"], tools: ["invoices_list"] });

  fireEvent.click(view.getAllByText("Change")[0]);
  fireEvent.click(view.getByLabelText(/This project only/));
  fireEvent.click(view.getByText("Save"));
  await waitFor(() => expect(view.getAllByText("This project only").length).toBe(2));
  expect(writes[1]).toEqual({ target: "billing", all_projects: false, project_ids: [], tools: [] });
});

test("marks the tools that can run in every project at once", async () => {
  projectGrants.get = async () => empty;
  mcpServers.tools = (async () => ({
    tools: [{ name: "invoice_send" }, { name: "invoices_list", annotations: { readOnlyHint: true } }],
    allowed_tools: null,
  })) as never;
  const view = render(<AgentProjectGrants instance={agent} attached={attached} inventory={inventory} label={label} />);
  await waitFor(() => expect(view.getAllByText("Change").length).toBe(2));
  fireEvent.click(view.getAllByText("Change")[0]);
  fireEvent.click(view.getByLabelText(/All projects you can edit/));
  fireEvent.click(view.getByLabelText("Only some tools"));
  await waitFor(() => expect(view.getAllByText("read-only").length).toBe(1));
  expect(view.getByLabelText(/invoices_list/).closest("label")?.textContent).toContain("read-only");
  expect(view.getByLabelText(/invoice_send/).closest("label")?.textContent).not.toContain("read-only");
  expect(view.getByText(/can also run in every project at once/)).toBeTruthy();
});
