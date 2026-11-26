import { describe, expect, test } from "bun:test";
import { resolveProjectIDForTab, resolveProjectScopeForTab } from "./useProjects";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const PROJECT_KEY = "apteva_project_id";
const PROJECTS = ["default", "personal"];

describe("resolveProjectIDForTab", () => {
  test("claims the shared default so another tab cannot change it on refresh", () => {
    const shared = new MemoryStorage();
    const tabA = new MemoryStorage();
    const tabB = new MemoryStorage();
    shared.setItem(PROJECT_KEY, "default");

    expect(resolveProjectIDForTab(PROJECTS, tabA, shared)).toBe("default");
    expect(tabA.getItem(PROJECT_KEY)).toBe("default");

    expect(resolveProjectIDForTab(PROJECTS, tabB, shared)).toBe("default");
    tabB.setItem(PROJECT_KEY, "personal");
    shared.setItem(PROJECT_KEY, "personal");

    // Tab A reloads after tab B switched. Its claimed tab selection wins.
    expect(resolveProjectIDForTab(PROJECTS, tabA, shared)).toBe("default");
  });

  test("keeps an explicit tab selection ahead of the shared new-tab default", () => {
    const shared = new MemoryStorage();
    const tab = new MemoryStorage();
    shared.setItem(PROJECT_KEY, "personal");
    tab.setItem(PROJECT_KEY, "default");

    expect(resolveProjectIDForTab(PROJECTS, tab, shared)).toBe("default");
  });

  test("repairs stale tab and shared selections with an available project", () => {
    const shared = new MemoryStorage();
    const tab = new MemoryStorage();
    shared.setItem(PROJECT_KEY, "deleted-shared");
    tab.setItem(PROJECT_KEY, "deleted-tab");

    expect(resolveProjectIDForTab(PROJECTS, tab, shared)).toBe("default");
    expect(tab.getItem(PROJECT_KEY)).toBe("default");
    expect(shared.getItem(PROJECT_KEY)).toBe("default");
  });
});

const SCOPE_KEY = "apteva_project_scope";

describe("resolveProjectScopeForTab", () => {
  test("defaults to one project and claims that for the tab", () => {
    const shared = new MemoryStorage();
    const tab = new MemoryStorage();

    expect(resolveProjectScopeForTab(3, tab, shared)).toBe("project");
    expect(tab.getItem(SCOPE_KEY)).toBe("project");
  });

  test("new tabs inherit All projects; a tab's own choice wins afterwards", () => {
    const shared = new MemoryStorage();
    const tabA = new MemoryStorage();
    shared.setItem(SCOPE_KEY, "all");

    expect(resolveProjectScopeForTab(2, tabA, shared)).toBe("all");

    // Another tab goes back to one project; tab A keeps All projects on reload.
    shared.setItem(SCOPE_KEY, "project");
    expect(resolveProjectScopeForTab(2, tabA, shared)).toBe("all");
  });

  test("All projects needs at least two projects", () => {
    const shared = new MemoryStorage();
    const tab = new MemoryStorage();
    tab.setItem(SCOPE_KEY, "all");

    expect(resolveProjectScopeForTab(1, tab, shared)).toBe("project");
    // The stored choice survives, so adding a second project restores it.
    expect(tab.getItem(SCOPE_KEY)).toBe("all");
    expect(resolveProjectScopeForTab(2, tab, shared)).toBe("all");
  });

  test("ignores unknown stored values", () => {
    const shared = new MemoryStorage();
    const tab = new MemoryStorage();
    tab.setItem(SCOPE_KEY, "everything");
    shared.setItem(SCOPE_KEY, "all");

    expect(resolveProjectScopeForTab(2, tab, shared)).toBe("all");
    expect(tab.getItem(SCOPE_KEY)).toBe("all");
  });
});
