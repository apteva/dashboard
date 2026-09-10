import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
  apps,
  integrations,
  type AgentTemplate,
  type AppRow,
  type ConnectionInfo,
  type MarketplaceEntry,
} from "../api";
import {
  INITIAL,
  SetupStep,
  templateAgentConnectionIDs,
  type WizardState,
} from "./AgentNew";

const originalPermissions = apps.permissions;
const originalCatalog = integrations.catalog;
afterEach(() => {
  cleanup();
  apps.permissions = originalPermissions;
  integrations.catalog = originalCatalog;
});
beforeEach(() => {
  apps.permissions = mock(
    async () => ({ permissions: [], resources: [] }) as any,
  );
});
const app = (id: number, name: string, display: string): AppRow =>
  ({
    install_id: id,
    name,
    display_name: display,
    description: `${display} tools`,
    icon: "/icon.svg",
    icon_style: "monochrome",
    status: "running",
    project_id: "p",
    version: "1.0",
    surfaces: { mcp_tool_count: 2 },
  }) as AppRow;
const connection = (
  id: number,
  slug: string,
  name: string,
  project_id = "",
): ConnectionInfo =>
  ({
    id,
    app_slug: slug,
    app_name: name,
    name: `${name} account ${id}`,
    status: "active",
    project_id,
  }) as ConnectionInfo;
const installed = [
  app(1, "conversations", "Conversations"),
  app(2, "tasks", "Tasks"),
  app(3, "storage", "Storage"),
  app(4, "ads", "Ads"),
  ...Array.from({ length: 95 }, (_, i) =>
    app(i + 5, `app-${i}`, `Unrelated app ${i}`),
  ),
];
const connected = [
  connection(10, "github", "GitHub"),
  connection(11, "stripe", "Stripe"),
];
const template = {
  id: "helper",
  name: "Helper",
  requirements: [
    { kind: "app", slug: "storage", required: true },
    { kind: "integration", compatible_slugs: ["github"], required: true },
  ],
  resolved_logos: [],
} as unknown as AgentTemplate;
function Fixture({
  tpl = template,
  refresh = async () => {},
}: {
  tpl?: AgentTemplate;
  refresh?: () => Promise<void>;
}) {
  const [state, setState] = useState<WizardState>({
    ...INITIAL,
    boundAppInstallIDs: new Set([1]),
    boundConnectionIDs: new Set([10]),
    appAccess: {},
  });
  return (
    <SetupStep
      template={tpl}
      installedApps={installed}
      marketplace={[]}
      connections={connected}
      state={state}
      setState={setState}
      onRefresh={refresh}
      onConnected={() => {}}
      projectId="p"
    />
  );
}

test("shows selections and essentials, keeps the full app inventory inside a searchable picker", async () => {
  render(<Fixture />);
  expect(screen.getByRole("heading", { name: "Conversations" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Storage" })).toBeTruthy();
  expect(screen.queryByText("Ads")).toBeNull();
  expect(screen.queryByText("Unrelated app 90")).toBeNull();
  expect(screen.queryByText("Stripe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add Tasks" }));
  expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove Tasks" }));
  expect(screen.getByRole("button", { name: "Add Tasks" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "+ Add apps" }));
  const dialog = within(screen.getByRole("dialog", { name: "Choose apps" }));
  const required = dialog.getByRole("checkbox", { name: /Storage/ });
  expect(required.getAttribute("aria-checked")).toBe("true");
  expect((required as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(dialog.getByRole("searchbox"), {
    target: { value: "unrelated app 90" },
  });
  expect(dialog.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(dialog.getByRole("checkbox", { name: /Unrelated app 90/ }));
  fireEvent.click(dialog.getByRole("button", { name: "Done" }));
  expect(
    screen.getByRole("heading", { name: "Unrelated app 90" }),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(apps.permissions).toHaveBeenCalled());
  const requested = (
    apps.permissions as ReturnType<typeof mock>
  ).mock.calls.map((call) => call[0]);
  expect(new Set(requested).size).toBe(requested.length);
});

test("adds and removes selected accounts without listing unrelated integrations on the main step", async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add integrations" }));
  const dialog = within(
    screen.getByRole("dialog", { name: "Choose integrations" }),
  );
  fireEvent.change(dialog.getByRole("searchbox"), {
    target: { value: "Stripe account" },
  });
  fireEvent.click(dialog.getByRole("checkbox", { name: /Stripe/ }));
  fireEvent.click(dialog.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("heading", { name: "Stripe" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Stripe account 11" }),
  );
  expect(screen.queryByRole("heading", { name: "Stripe" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove GitHub account 10" }),
  );
  expect(screen.getByText("Needed for template")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose account →" })).toBeTruthy();
  await act(async () => {});
});

test("keeps app access controls available on template-required selections", async () => {
  apps.permissions = mock(
    async () =>
      ({
        permissions: [{ name: "media.read" }],
        resources: [{ name: "folder", label: "Folder" }],
      }) as any,
  );
  render(<Fixture />);
  const card = screen
    .getByRole("heading", { name: "Storage" })
    .closest("article")!;
  await waitFor(() =>
    expect(within(card).getByText("App access · Full")).toBeTruthy(),
  );
  fireEvent.click(within(card).getByText("App access · Full"));
  fireEvent.click(within(card).getByRole("button", { name: "limited" }));
  expect(within(card).getByText("App access · Limited")).toBeTruthy();
  expect(
    within(card).getByRole("textbox", { name: /Allowed folders/ }),
  ).toBeTruthy();
});

test("seeds one active matching account per requirement and prefers project scope", () => {
  expect([
    ...templateAgentConnectionIDs(
      template,
      [
        connection(1, "github", "GitHub"),
        connection(2, "github", "GitHub", "p"),
        connection(3, "stripe", "Stripe", "p"),
      ],
      "p",
    ),
  ]).toEqual([2]);
  const inactive = {
    ...connection(2, "github", "GitHub", "p"),
    status: "expired",
  };
  expect([
    ...templateAgentConnectionIDs(
      template,
      [inactive, connection(1, "github", "GitHub")],
      "p",
    ),
  ]).toEqual([1]);
  expect([...templateAgentConnectionIDs(template, [inactive], "p")]).toEqual(
    [],
  );
});
