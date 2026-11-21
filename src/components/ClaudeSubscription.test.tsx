import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import { claudeSubscription, type ClaudeSubscriptionStatus } from "../api";
import { ClaudeSubscriptionPoolSection, cliVersion, forDuration, processActivity } from "./ClaudeSubscription";

const originalStatus = claudeSubscription.status;
afterEach(() => {
  cleanup();
  claudeSubscription.status = originalStatus;
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function status(pool: Partial<NonNullable<ClaudeSubscriptionStatus["pool"]>>): ClaudeSubscriptionStatus {
  return {
    available: true,
    installed: true,
    connected: true,
    connection_id: 153,
    version: "2.1.329 (Claude Code)",
    sign_in_command: "claude auth login",
    login: { running: false },
    auth: { logged_in: true, auth_method: "claude.ai", subscription_type: "max", subscription: true, checked_at: minutesAgo(0) },
    settings: { pool_size: 4, idle_seconds: 600, queue_seconds: 60 },
    pool: {
      max_processes: 4,
      running: 0,
      busy: 0,
      waiting: 0,
      sessions: 0,
      idle_seconds: 600,
      queue_seconds: 60,
      memory_kb: 0,
      processes: [],
      ...pool,
    },
  } as ClaudeSubscriptionStatus;
}

// An agent pacing between turns: both of its processes wait on tools.
const pacing = status({
  running: 2,
  busy: 2,
  generating: 0,
  waiting_tool: 2,
  sessions: 2,
  memory_kb: 600 * 1024,
  processes: [
    { session: "a", owner: "agent-141", owner_label: "Personal Agent", model: "sonnet", pid: 11, state: "waiting_tool", detail: "done", since: minutesAgo(3), started_at: minutesAgo(30), turns: 12, memory_kb: 300 * 1024 },
    { session: "b", owner: "agent-141:chat", owner_label: "Personal Agent · chat", model: "sonnet", pid: 12, state: "waiting_tool", detail: "pace", since: minutesAgo(7), started_at: minutesAgo(20), turns: 4, memory_kb: 300 * 1024 },
  ],
});

function tile(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.parentElement as HTMLElement;
}

test("processes waiting on tools count as waiting, not generating", async () => {
  claudeSubscription.status = mock(async () => pacing);
  const { container } = render(<ClaudeSubscriptionPoolSection />);
  await screen.findByText("Processes");

  expect(within(tile("Processes")).getByText("2 of 4")).toBeTruthy();
  expect(within(tile("Generating")).getByText("0")).toBeTruthy();
  expect(within(tile("Waiting")).getByText("2")).toBeTruthy();
  expect(tile("Waiting").getAttribute("title")).toContain("pace");
  expect(within(tile("Queued")).getByText("0")).toBeTruthy();
  expect(tile("Queued").className).not.toContain("yellow");

  expect(screen.getByText("Waiting on pace")).toBeTruthy();
  expect(screen.getByText("Waiting on done")).toBeTruthy();
  expect(screen.getByText("for 7 min")).toBeTruthy();
  expect(container.querySelectorAll('[data-tone="waiting"]').length).toBe(2);
  expect(container.querySelector('[data-tone="generating"]')).toBeNull();

  const text = container.textContent || "";
  expect(text).not.toMatch(/busy/i);
  expect(text).not.toContain("Claude Code");
  expect(text).toContain("claude 2.1.329");
});

test("a generating process gets the accent, and queued turns stand out", async () => {
  claudeSubscription.status = mock(async () =>
    status({
      running: 1,
      busy: 1,
      generating: 1,
      waiting_tool: 0,
      waiting: 2,
      processes: [
        { session: "c", owner: "agent-7", owner_label: "Support", model: "opus", pid: 13, state: "replying", since: minutesAgo(0), started_at: minutesAgo(1), turns: 1 },
      ],
    }),
  );
  const { container } = render(<ClaudeSubscriptionPoolSection />);
  await screen.findByText("Processes");

  expect(within(tile("Generating")).getByText("1")).toBeTruthy();
  expect(tile("Queued").className).toContain("yellow");
  expect(screen.getByText("Generating", { selector: "span" })).toBeTruthy();
  expect(container.querySelector('[data-tone="generating"]')).not.toBeNull();
});

test("older servers without the counts still get them from the process list", async () => {
  const old = status({ ...pacing.pool });
  delete old.pool!.generating;
  delete old.pool!.waiting_tool;
  old.pool!.processes = [...old.pool!.processes, { ...old.pool!.processes[0], session: "d", pid: 14, state: "finishing", detail: "" }];
  claudeSubscription.status = mock(async () => old);
  render(<ClaudeSubscriptionPoolSection />);
  await screen.findByText("Processes");

  expect(within(tile("Generating")).getByText("1")).toBeTruthy();
  expect(within(tile("Waiting")).getByText("2")).toBeTruthy();
});

test("states, durations and versions read plainly", () => {
  expect(processActivity({ state: "replying" })).toEqual({ label: "Generating", tone: "generating" });
  expect(processActivity({ state: "finishing" })).toEqual({ label: "Finishing", tone: "generating" });
  expect(processActivity({ state: "starting" }).tone).toBe("generating");
  expect(processActivity({ state: "waiting_tool", detail: "pace" })).toEqual({ label: "Waiting on pace", tone: "waiting" });
  expect(processActivity({ state: "waiting_tool" }).label).toBe("Waiting on a tool");
  expect(processActivity({ state: "idle" })).toEqual({ label: "Idle", tone: "idle" });

  const now = Date.parse("2026-11-20T12:00:00Z");
  expect(forDuration("2026-11-20T11:59:15Z", now)).toBe("for 45 s");
  expect(forDuration("2026-11-20T11:53:00Z", now)).toBe("for 7 min");
  expect(forDuration("2026-11-20T10:00:00Z", now)).toBe("for 2 h");
  expect(forDuration("2026-11-20T09:55:00Z", now)).toBe("for 2 h 5 min");
  expect(forDuration("not a date", now)).toBe("");

  expect(cliVersion("2.1.329 (Claude Code)")).toBe("2.1.329");
  expect(cliVersion("2.1.329")).toBe("2.1.329");
  expect(cliVersion(undefined)).toBe("");
});
