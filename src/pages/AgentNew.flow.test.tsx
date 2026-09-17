import { afterEach, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AgentNew } from "./AgentNew";
import {
  agentTemplates,
  apps,
  instances,
  integrations,
  type AgentTemplate,
  type ConnectionInfo,
} from "../api";

const originals = [agentTemplates, apps, instances, integrations].map(
  (target) => ({ target, values: { ...target } }),
);
afterEach(() => {
  cleanup();
  for (const { target, values } of originals) Object.assign(target, values);
});

test("late template accounts seed once, refresh preserves removals, and create keeps selected apps and scoped access", async () => {
  const template = {
    id: "research",
    source: "builtin",
    sort_order: 0,
    created_at: "",
    updated_at: "",
    name: "Research agent",
    description: "Research with GitHub and storage.",
    directive: "Research and save findings.",
    mode: "learn",
    unconscious: true,
    recommended_apps: [],
    highlights: [],
    requirements: [
      { kind: "app", slug: "storage", required: true },
      { kind: "integration", compatible_slugs: ["github"], required: true },
    ],
  } as AgentTemplate;
  const installed = [
    {
      install_id: 1,
      name: "conversations",
      display_name: "Conversations",
      status: "running",
      default_for_new_agents: true,
      project_id: "",
      surfaces: {},
    },
    {
      install_id: 3,
      name: "storage",
      display_name: "Storage",
      status: "running",
      project_id: "",
      surfaces: {},
    },
  ];
  const connections = [
    {
      id: 10,
      app_slug: "github",
      app_name: "GitHub",
      name: "Work GitHub",
      status: "active",
    },
    {
      id: 11,
      app_slug: "stripe",
      app_name: "Stripe",
      name: "Work Stripe",
      status: "active",
    },
  ] as ConnectionInfo[];
  let resolveConnections!: (value: ConnectionInfo[]) => void;
  const lateConnections = new Promise<ConnectionInfo[]>((resolve) => {
    resolveConnections = resolve;
  });
  agentTemplates.list = mock(async () => [template]);
  apps.list = mock(async () => installed as any);
  apps.marketplace = mock(async () => ({ apps: [] }) as any);
  apps.permissions = mock(
    async () =>
      ({
        permissions: [{ name: "media.read" }],
        resources: [{ name: "folder", label: "Folder" }],
      }) as any,
  );
  integrations.runtimeConnections = mock(async () => [{ role: "llm" }] as any);
  integrations.connections = mock(() => lateConnections);
  instances.create = mock(async () => ({ id: 999 }) as any);
  render(
    <MemoryRouter initialEntries={["/agents/new"]}>
      <Routes>
        <Route path="/agents/new" element={<AgentNew />} />
        <Route path="/agents/999" element={<p>Agent created</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Research agent/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to details →" }),
  );
  await act(async () => resolveConnections(connections));
  fireEvent.click(screen.getByRole("button", { name: "Continue to setup →" }));
  expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Stripe" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove Work GitHub" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy(),
  );
  expect(
    screen.queryByRole("button", { name: "Remove Work GitHub" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose account →" }));
  const dialog = within(
    screen.getByRole("dialog", { name: "Choose integrations" }),
  );
  fireEvent.click(dialog.getByRole("checkbox", { name: /GitHub/ }));
  fireEvent.click(dialog.getByRole("button", { name: "Done" }));
  const card = screen
    .getByRole("heading", { name: "Storage" })
    .closest("article")!;
  await waitFor(() =>
    expect(within(card).getByText("App access · Full")).toBeTruthy(),
  );
  fireEvent.click(within(card).getByText("App access · Full"));
  fireEvent.click(within(card).getByRole("button", { name: "limited" }));
  fireEvent.change(
    within(card).getByRole("textbox", { name: /Allowed folders/ }),
    { target: { value: "/research" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to review →" }));
  expect(screen.getByText("Conversations, Storage")).toBeTruthy();
  expect(screen.getByText("GitHub — Work GitHub")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create agent →" }));
  await screen.findByText("Agent created");
  const options = (instances.create as ReturnType<typeof mock>).mock
    .calls[0]![5] as any;
  expect(options.boundAppInstallIDs).toEqual([1, 3]);
  expect(options.boundConnectionIDs).toEqual([10]);
  expect(options.boundAppGrants).toEqual([
    {
      install_id: 3,
      default_effect: "deny",
      rules: [
        {
          effect: "allow",
          permission: "media.read",
          resource: "folder/research/**",
        },
      ],
    },
  ]);
});


async function mountRequiredAppFixture(status: "pending" | "error" | "disabled") {
 const template = {id:"research",name:"Research agent",description:"Research",directive:"Research",mode:"learn",unconscious:false,requirements:[{kind:"app",slug:"storage",required:true}]} as AgentTemplate;
 const storage = {install_id:3,name:"storage",display_name:"Storage",status:status as string,project_id:"",surfaces:{},version:"1.0",status_message:"Queued — waiting for a build slot"};
 agentTemplates.list=mock(async()=>[template]);
 apps.list=mock(async()=>[storage] as any);
 apps.install=mock(async()=>({install_id:3}) as any);
 apps.marketplace=mock(async()=>({apps:[]}) as any);
 apps.permissions=mock(async()=>({permissions:[],resources:[]}) as any);
 integrations.runtimeConnections=mock(async()=>[{role:"llm"}] as any);
 integrations.connections=mock(async()=>[]);
 instances.create=mock(async()=>({id:999}) as any);
 render(<MemoryRouter initialEntries={["/agents/new"]}><Routes><Route path="/agents/new" element={<AgentNew/>}/><Route path="/agents/999" element={<p>Agent created</p>}/></Routes></MemoryRouter>);
 fireEvent.click(await screen.findByRole("button",{name:/Research agent/}));
 fireEvent.click(screen.getByRole("button",{name:"Continue to details →"}));
 fireEvent.click(screen.getByRole("button",{name:"Continue to setup →"}));
 fireEvent.click(screen.getByRole("button",{name:"Continue to review →"}));
 fireEvent.click(screen.getByRole("button",{name:"Create agent →"}));
 return storage;
}

test("waits for an existing queued required app and attaches it once ready",async()=>{
 const storage=await mountRequiredAppFixture("pending");
 await screen.findByText("Queued — waiting for a build slot");
 expect(instances.create).not.toHaveBeenCalled();
 expect(apps.install).not.toHaveBeenCalled();
 storage.status="running";
 await screen.findByText("Agent created",{}, {timeout:3000});
 expect((instances.create as ReturnType<typeof mock>).mock.calls[0]![5]).toEqual(expect.objectContaining({boundAppInstallIDs:[3]}));
});
for(const status of ["error","disabled"] as const)test(`blocks creation until a required ${status} app is repaired`,async()=>{
 const storage=await mountRequiredAppFixture(status);
 await screen.findByText(/storage: required app is not running/);
 expect(instances.create).not.toHaveBeenCalled();
 expect(apps.install).not.toHaveBeenCalled();
 storage.status="running";
 fireEvent.click(screen.getByRole("button",{name:"Create agent →"}));
 await screen.findByText("Agent created");
 expect((instances.create as ReturnType<typeof mock>).mock.calls[0]![5]).toEqual(expect.objectContaining({boundAppInstallIDs:[3]}));
});


test("a queued required app that fails never creates an incomplete agent", async () => {
  const storage = await mountRequiredAppFixture("pending");
  await screen.findByText("Queued — waiting for a build slot");
  expect((screen.getByRole("button", { name: "Installing apps…" }) as HTMLButtonElement).disabled).toBe(true);
  storage.status = "error";
  await screen.findByText(/storage: required app is not running/, {}, { timeout: 3000 });
  expect(instances.create).not.toHaveBeenCalled();
  expect(apps.install).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Create agent →" }) as HTMLButtonElement).disabled).toBe(false);
});
