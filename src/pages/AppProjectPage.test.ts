import { describe, expect, test } from "bun:test";
import type { AppRow } from "../api";
import { selectProjectAppInstallation, loadedAppMatchesRoute } from "./AppProjectPage";

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

describe("named app installations", () => {
  const stable = { name: "database", project_id: "p", install_id: 1, is_default: true, status: "running" } as AppRow;
  const candidate = { ...stable, install_id: 2, is_default: false };
  const global = { ...stable, project_id: "", install_id: 3 };
  test("uses the selected default independently of list order and resolves explicit candidates", () => {
    expect(selectProjectAppInstallation([candidate, global, stable], "database", "p")?.install_id).toBe(1);
    expect(selectProjectAppInstallation([stable, candidate], "database", "p", "2")?.install_id).toBe(2);
    expect(selectProjectAppInstallation([global], "database", "p", "99")).toBeUndefined();
  });
  test("rejects foreign installations and preserves an unavailable project's default", () => {
    expect(selectProjectAppInstallation([candidate], "database", "other", "2")).toBeUndefined();
    expect(selectProjectAppInstallation([{ ...stable, status: "disabled" }, candidate, global], "database", "p")?.status).toBe("disabled");
    expect(selectProjectAppInstallation([candidate, global], "database", "p")).toBeUndefined();
  });
});
