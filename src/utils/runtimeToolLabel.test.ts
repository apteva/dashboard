import { describe, expect, test } from "bun:test";
import { runtimeToolLabel } from "./runtimeToolLabel";

describe("runtimeToolLabel", () => {
  test("shows the actual tool name beside its operator reason", () => {
    expect(runtimeToolLabel("evolve", "Saving weekly report schedule")).toBe(
      "evolve — Saving weekly report schedule",
    );
  });

  test("uses the supplied fallback when no reason was emitted", () => {
    expect(runtimeToolLabel("affiliate_affiliate_stats", "", "Preparing affiliate stats")).toBe(
      "Preparing affiliate stats",
    );
  });
});
