import { expect, test } from "bun:test";
import { widgetProjects } from "./widgetContext";

const projects = [
  { id: "p1", name: "Sales", color: "#10B981" },
  { id: "p2", name: "Support", color: "" },
  { id: "p3", name: "Ops", color: "url(x)" },
];

test("a global widget sees every project with its colour", () => {
  expect(widgetProjects(projects, "global")).toEqual([
    { id: "p1", name: "Sales", color: "#10b981" },
    { id: "p2", name: "Support", color: "" },
    { id: "p3", name: "Ops", color: "" },
  ]);
});

test("a project widget sees only its own project", () => {
  expect(widgetProjects(projects, "project", "p2")).toEqual([{ id: "p2", name: "Support", color: "" }]);
  expect(widgetProjects(projects, "project")).toEqual([]);
});
