import { describe, expect, test } from "bun:test";
import { resolveProjectIDForTab } from "./useProjects";

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
