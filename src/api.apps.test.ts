import { describe, expect, test } from "bun:test";
import { appIconRuntimeURL } from "./api";

describe("installed app icon runtime URLs", () => {
  test("reloads a sidecar icon when installation becomes running", () => {
    const icon = "/api/apps/jobs/ui/icon.svg?install_id=7&project_id=default&v=0.1.12";
    const pending = appIconRuntimeURL(icon, "0.1.12", "pending");
    const running = appIconRuntimeURL(icon, "0.1.12", "running");

    expect(pending).toContain("runtime=0.1.12%3Apending");
    expect(running).toContain("runtime=0.1.12%3Arunning");
    expect(running).not.toBe(pending);
  });

  test("does not rewrite legacy remote artwork", () => {
    const icon = "https://cdn.example.com/jobs.svg";
    expect(appIconRuntimeURL(icon, "0.1.12", "running")).toBe(icon);
  });
});
