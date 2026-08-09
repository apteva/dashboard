import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("dashboard theme contracts", () => {
  test("defines the subtle surface in every palette and exposes it to Tailwind", () => {
    const css = source("./index.css");
    expect(css.match(/^\s*--bg-subtle:/gm)).toHaveLength(4);
    expect(css).toContain("--color-bg-subtle: var(--bg-subtle);");
  });

  test("defines a theme-aware recurring-work color in every palette", () => {
    const css = source("./index.css");
    expect(css.match(/^\s*--recurring:/gm)).toHaveLength(4);
    expect(css).toContain("--color-recurring: var(--recurring);");
  });

  test("keeps Build primary actions readable on every accent palette", () => {
    const build = source("./pages/Build.tsx");
    expect(build).not.toMatch(/bg-accent[^"\n]*text-black/);
    expect(build).not.toMatch(/\b(?:text|bg|border)-danger\b/);
  });

  test("does not use the undefined danger alias in Settings", () => {
    expect(source("./pages/Settings.tsx")).not.toMatch(/\b(?:text|bg|border)-danger\b/);
  });

  test("keeps chat Markdown headings and post-list sections visually separated", () => {
    const css = source("./index.css");
    expect(css).toContain("margin: 1rem 0 0.7rem 0;");
    expect(css).toContain(".chat-md :is(ul, ol) + :is(p, h1, h2, h3, h4) { margin-top: 1rem; }");
  });
});
