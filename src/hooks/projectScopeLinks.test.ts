import { describe, expect, test } from "bun:test";
import { scopeFromLink } from "./projectScopeLinks";

const PROJECTS = ["alpha", "beta"];
const link = (pathname: string, search: string) => scopeFromLink(pathname, new URLSearchParams(search), PROJECTS);

describe("scopeFromLink", () => {
  test("Home and Usage links set the sidebar once, then drop the parameter", () => {
    expect(link("/", "?scope=all")).toEqual({ scope: "all", strip: true });
    expect(link("/", "?project=beta")).toEqual({ scope: "project", projectId: "beta", strip: true });
    expect(link("/analytics", "?project=alpha&range=30d")).toEqual({ scope: "project", projectId: "alpha", strip: true });
  });

  test("an unknown project is dropped without changing the sidebar", () => {
    expect(link("/", "?project=deleted")).toEqual({ scope: "project", projectId: undefined, strip: true });
  });

  test("a project page keeps its parameter and moves the sidebar to its project", () => {
    expect(link("/pages/p1", "?project=beta")).toEqual({ scope: "project", projectId: "beta", strip: false });
  });

  test("global pages and other screens leave the sidebar alone", () => {
    expect(link("/pages/p1", "?scope=global")).toBeNull();
    expect(link("/agents", "?project=beta")).toBeNull();
    expect(link("/", "")).toBeNull();
  });
});
