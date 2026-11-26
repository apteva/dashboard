import { describe, expect, test } from "bun:test";
import type { Agent } from "../api";
import { groupAgentsByProject } from "./Agents";
import { orderProjectChoices } from "../components/ProjectRequired";

const agent = (id: number, project_id?: string) => ({ id, name: `Agent ${id}`, project_id }) as Agent;
const projects = [
  { id: "alpha", name: "Alpha" },
  { id: "beta", name: "Beta" },
];

describe("groupAgentsByProject", () => {
  test("groups agents under their project in the sidebar's order", () => {
    const groups = groupAgentsByProject([agent(1, "beta"), agent(2, "alpha"), agent(3, "beta")], projects);
    expect(groups.map((group) => [group.name, group.agents.map((a) => a.id)])).toEqual([
      ["Alpha", [2]],
      ["Beta", [1, 3]],
    ]);
  });

  test("keeps agents of projects missing from the picker, after the known ones", () => {
    const groups = groupAgentsByProject([agent(1, "gone"), agent(2, "alpha"), agent(3)], projects);
    expect(groups.map((group) => group.name)).toEqual(["Alpha", "gone", "No project"]);
  });
});

describe("orderProjectChoices", () => {
  const full = projects.map((project) => ({ ...project, user_id: 1, description: "", color: "", created_at: "" }));

  test("puts the last project used first", () => {
    expect(orderProjectChoices(full, full[1]).map((project) => project.id)).toEqual(["beta", "alpha"]);
  });

  test("keeps the usual order when there is no last project", () => {
    expect(orderProjectChoices(full, null).map((project) => project.id)).toEqual(["alpha", "beta"]);
  });
});
