import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { instances, type Agent } from "../api";
import { AgentRestartNotice } from "./AgentRestartNotice";
import { providerSaveNotice, restartNeededMessage } from "../utils/providerRestart";

const originalInstances = { ...instances };
afterEach(() => {
  cleanup();
  Object.assign(instances, originalInstances);
});

function agent(extra: Partial<Agent> = {}): Agent {
  return {
    id: 7,
    user_id: 1,
    name: "Personal Agent",
    directive: "",
    mode: "autonomous",
    config: "{}",
    port: 4100,
    pid: 1,
    status: "running",
    created_at: "2026-11-20T00:00:00Z",
    ...extra,
  };
}

test("a provider switch that restarted the agent says so, and a failed restart says what to do", () => {
  expect(providerSaveNotice("Personal Agent", { restarted: true, restart_reason: "provider_unavailable" })).toEqual({
    tone: "success",
    message: "Restarted Personal Agent so it can use its new provider.",
  });
  const failed = providerSaveNotice("Personal Agent", { restarted: false, restart_error: "core did not come back" });
  expect(failed?.tone).toBe("error");
  expect(failed?.message).toContain("core did not come back");
  expect(failed?.message).toContain("Restart it to apply the change");
  // Saves that applied live have nothing to report.
  expect(providerSaveNotice("Personal Agent", {})).toBeNull();
  expect(providerSaveNotice("Personal Agent", undefined)).toBeNull();
});

test("only a running agent that needs it is asked to restart", () => {
  expect(restartNeededMessage(agent())).toBe("");
  expect(restartNeededMessage(agent({ status: "stopped", needs_restart: true }))).toBe("");
  expect(restartNeededMessage(agent({ needs_restart: true, restart_reason: "provider_credentials_changed" }))).toContain("credentials changed");
  const unavailable = restartNeededMessage(agent({
    needs_restart: true,
    restart_reason: "provider_unavailable",
    provider_unavailable: { name: "claude-subscription", reason: "CLAUDE_SUBSCRIPTION_CONNECTION_ID was not set when the agent started" },
  }));
  expect(unavailable).toContain("can't run claude-subscription");
  expect(unavailable).toContain("isn't using another provider");
});

test("Restart restarts the agent and reloads it", async () => {
  const restart = mock(async () => ({ status: "restarted" }));
  instances.restart = restart;
  const reloaded = mock(() => {});
  render(<AgentRestartNotice agent={agent({ needs_restart: true, restart_reason: "provider_credentials_changed" })} onRestarted={reloaded} />);

  expect(screen.getByText("Restart needed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  await waitFor(() => expect(reloaded).toHaveBeenCalledTimes(1));
  expect(restart).toHaveBeenCalledWith(7);
});

test("a failed restart stays on screen with its error", async () => {
  instances.restart = mock(async () => { throw new Error("no LLM provider configured"); });
  const reloaded = mock(() => {});
  render(<AgentRestartNotice agent={agent({ needs_restart: true })} onRestarted={reloaded} />);

  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(await screen.findByText("no LLM provider configured")).toBeTruthy();
  expect(reloaded).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Restart" }) as HTMLButtonElement).disabled).toBe(false);
});

test("nothing shows when no restart is needed", () => {
  const { container } = render(<AgentRestartNotice agent={agent()} onRestarted={() => {}} />);
  expect(container.textContent).toBe("");
});
