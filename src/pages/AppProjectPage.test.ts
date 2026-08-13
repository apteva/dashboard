import { describe, expect, test } from "bun:test";
import { loadedAppMatchesRoute } from "./AppProjectPage";

describe("loadedAppMatchesRoute", () => {
  const loaded = { projectId: "project-a", routeName: "api" };

  test("accepts only the project and route that produced the app row", () => {
    expect(loadedAppMatchesRoute(loaded, "project-a", "api")).toBe(true);
    expect(loadedAppMatchesRoute(loaded, "project-b", "api")).toBe(false);
    expect(loadedAppMatchesRoute(loaded, "project-a", "functions")).toBe(false);
  });

  test("does not render before project and route hydration", () => {
    expect(loadedAppMatchesRoute(loaded, undefined, "api")).toBe(false);
    expect(loadedAppMatchesRoute(loaded, "project-a", undefined)).toBe(false);
  });
});
