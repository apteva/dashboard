import { expect, test } from "bun:test";
import { normalizeProjectColor } from "./projectColor";

test("keeps short and long hex colours, lower-cased and trimmed", () => {
  expect(normalizeProjectColor(" #6366F1 ")).toBe("#6366f1");
  expect(normalizeProjectColor("#ABC")).toBe("#abc");
});

test("returns empty for no colour or anything that is not a hex colour", () => {
  for (const raw of [undefined, null, 12, "", "red", "#12", "#12345g", "#1234567", "red; background:url(x)", "#fff;"]) {
    expect(normalizeProjectColor(raw)).toBe("");
  }
});
