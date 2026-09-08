import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { apps, projects, type AppRow } from "../api";
import { ProjectProvider } from "../hooks/useProjects";
import { __installedAppsTestHelpers, buildChatComponentModuleURL, useInstalledApps } from "../components/apps/chatComponents";
import { Apps } from "./Apps";

const originalApps = { ...apps };
const originalProjectsList = projects.list;
const originalFetch = globalThis.fetch;
const code: AppRow = {
  install_id: 12, app_id: 3, name: "code", display_name: "Code", version: "1.0.0",
  description: "Repository workspace", icon: "", project_id: "github-project",
  status: "running", source: "git", upgrade_policy: "manual", default_for_new_agents: false,
  permissions: [], bindings: { github: 92 },
  surfaces: { kind: "service", mcp_tool_count: 1, skill_count: 0, http_route_count: 0,
    ui_panel_count: 0, ui_app: false, channel_count: 0, worker_count: 0, prompt_fragment_count: 0 },
};
const github: AppRow = {
  ...code, install_id: 0, app_id: 0, name: "github", display_name: "GitHub",
  source: "integration", bindings: undefined, available_version: "2.0.0",
  ui_components: [{ name: "issue-card", entry: "/ui/IssueCard.mjs", slots: ["chat.message_attachment"] }],
};

beforeEach(() => {
  __installedAppsTestHelpers.cache.clear();
  sessionStorage.clear();
  localStorage.clear();
  apps.list = mock(async () => [code, github]);
  apps.upgrade = mock(async () => ({ status: "upgraded", version: "2.0.0" }));
  apps.uninstall = mock(async () => ({ status: "uninstalled" }));
  projects.list = mock(async () => [{ id: "github-project", name: "GitHub project" }] as Awaited<ReturnType<typeof projects.list>>);
  globalThis.fetch = mock(async () => Response.json([code, github])) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  Object.assign(apps, originalApps);
  projects.list = originalProjectsList;
  globalThis.fetch = originalFetch;
  __installedAppsTestHelpers.cache.clear();
});

const mount = () => render(<MemoryRouter><ProjectProvider><Apps /></ProjectProvider></MemoryRouter>);

test("management hides GitHub while shared discovery retains issue cards and Code's binding", async () => {
  mount();
  const catalog = renderHook(() => useInstalledApps("github-project"));
  await screen.findByText("1 installed");
  await waitFor(() => expect(catalog.result.current).toHaveLength(2));
  expect(screen.getByText("Code")).toBeTruthy();
  expect(screen.queryByText("GitHub")).toBeNull();
  expect((screen.getByRole("button", { name: "All up to date" }) as HTMLButtonElement).disabled).toBe(true);
  const discovered = catalog.result.current.find((row) => row.name === "github")!;
  expect(discovered.ui_components).toEqual(github.ui_components);
  expect(buildChatComponentModuleURL(discovered.name, discovered.ui_components![0]!.entry, discovered.version, discovered.source))
    .toBe("/api/integrations/github/ui/IssueCard.mjs?v=1.0.0");
  expect(code.bindings).toEqual({ github: 92 });

  fireEvent.change(screen.getByPlaceholderText("Search installed apps…"), { target: { value: "GitHub" } });
  expect(screen.getByText("0 of 1 installed")).toBeTruthy();
  expect(screen.queryByText("GitHub")).toBeNull();
  expect(apps.upgrade).not.toHaveBeenCalled();
  expect(apps.uninstall).not.toHaveBeenCalled();
});

test("integration-only catalogs show the genuine empty installed state", async () => {
  apps.list = mock(async () => [github]);
  mount();
  await screen.findByText("No apps installed yet.");
  expect(screen.queryByText("GitHub")).toBeNull();
  expect(screen.queryByPlaceholderText("Search installed apps…")).toBeNull();
});
