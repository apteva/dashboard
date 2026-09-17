import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { AgentTemplate } from "../api";
import { TemplateStep } from "./AgentNew";

afterEach(cleanup);

const templates: AgentTemplate[] = [
  {
    id: "research", name: "Research bot", description: "Research a topic and save the findings.",
    highlights: ["Compare sources and save a report"],
    resolved_logos: [{ kind: "app", slug: "storage", label: "Storage", source: "direct", icon_url: "/storage.svg", icon_style: "monochrome" }],
  },
  {
    id: "slack", name: "Slack bot", description: "Help your team with daily questions.",
    highlights: ["Summarize team discussions"],
    resolved_logos: [{ kind: "integration", slug: "slack", label: "Slack", source: "direct", icon_url: "/slack.png" }],
  },
] as AgentTemplate[];

function Picker() {
  const [id, setID] = useState<string | null>(null);
  return <TemplateStep templates={templates} selectedID={id} onSelect={(t) => setID(t.id)} onSkipWizard={() => {}} />;
}

test("searches by app name and preserves the selected preview when filtering", () => {
  render(<Picker />);
  const search = screen.getByRole("searchbox", { name: "Search templates" });
  fireEvent.change(search, { target: { value: "storage" } });
  expect(screen.queryByRole("button", { name: /Slack bot/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Research bot/ }));
  expect(screen.getByRole("button", { name: /Research bot/ }).getAttribute("aria-pressed")).toBe("true");
  const preview = within(screen.getByRole("complementary", { name: "Template preview" }));
  expect(preview.getByText("Compare sources and save a report")).toBeTruthy();
  fireEvent.change(search, { target: { value: "no matching task" } });
  expect(screen.getByText(/No templates match/)).toBeTruthy();
  expect(preview.getByRole("heading", { name: "Research bot" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  fireEvent.click(screen.getByRole("button", { name: /Slack bot/ }));
  expect(preview.getByText("Summarize team discussions")).toBeTruthy();
  expect(preview.queryByText("Compare sources and save a report")).toBeNull();
});

test("renders theme-aware app masks, keeps brand images, and falls back on broken assets", () => {
  render(<Picker />);
  const appIcon = screen.getByRole("img", { name: "Storage" });
  const probe = appIcon.querySelector("img")!;
  const mask = probe.previousElementSibling as HTMLElement;
  expect(mask.style.maskImage).toContain("/storage.svg");
  fireEvent.error(probe);
  expect(mask.style.display).toBe("none");
  expect((mask.previousElementSibling as HTMLElement).style.visibility).toBe("visible");
  const brand = screen.getByRole("img", { name: "Slack" });
  const image = brand.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("/slack.png");
  fireEvent.error(image);
  expect(image.style.display).toBe("none");
  expect((image.previousElementSibling as HTMLElement).style.visibility).toBe("visible");
});
