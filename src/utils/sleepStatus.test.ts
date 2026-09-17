import { describe, expect, test } from "bun:test";
import { sleepClassName, sleepLabel, sleepProgress, sleepRemainingMs, sleepTitle } from "./sleepStatus";

const now = Date.parse("2026-09-10T07:20:55Z");

describe("runtime sleep status", () => {
  test("cleared wake stays waiting before and after the old 30s interval", () => {
    const sleep = { sleep_state: "waiting", next_wake_at: "", sleep_total_ms: 30000, sleep_remaining_ms: 30000 };
    for (const elapsed of [0, 4000, 30000, 90000]) {
      expect(sleepLabel(sleep, { now: now + elapsed })).toBe("Waiting for an event");
      expect(sleepRemainingMs(sleep, now + elapsed)).toBe(0);
      expect(sleepProgress(sleep, now + elapsed)).toBeNull();
    }
    expect(sleepTitle(sleep, now)).toContain("no scheduled wake");
    expect(sleepClassName(sleep)).not.toContain("green");
  });

  test("only an actual scheduled wake counts down", () => {
    const sleep = { sleep_state: "sleeping", next_wake_at: "2026-09-10T07:21:25Z", sleep_total_ms: 30000 };
    expect(sleepLabel(sleep, { compact: true, now: now + 4000 })).toBe("sleep 26s");
    expect(sleepProgress(sleep, now + 15000)).toBe(0.5);
    expect(sleepLabel(sleep, { now: now + 30000 })).toBe("Wake due");
    expect(sleepLabel(sleep, { now: now + 90000 })).toBe("Wake due");
    expect(sleepClassName(sleep, now + 90000)).toContain("yellow");
    expect(sleepProgress(sleep, now + 90000)).toBeNull();
  });

  test("duration alone cannot create a countdown", () => {
    const sleep = { sleep_state: "sleeping", sleep_remaining_ms: 30000, sleep_total_ms: 30000 };
    expect(sleepRemainingMs(sleep, now)).toBe(0);
    expect(sleepProgress(sleep, now)).toBeNull();
    expect(sleepLabel(sleep, { now })).not.toContain("30s");
  });

  test("an overdue timer never claims the agent is active", () => {
    const sleep = { sleep_state: "overdue", next_wake_at: "2026-09-10T07:20:00Z" };
    expect(sleepLabel(sleep, { compact: true, now })).toBe("wake due");
    expect(sleepClassName(sleep)).toContain("yellow");
    expect(sleepProgress(sleep, now)).toBeNull();
  });

  test("an early event wake can be active while retaining its timer", () => {
    const sleep = { sleep_state: "active", next_wake_at: "2026-09-10T07:21:25Z", sleep_total_ms: 30000 };
    expect(sleepLabel(sleep, { now })).toBe("Active");
    expect(sleepRemainingMs(sleep, now)).toBe(0);
    expect(sleepProgress(sleep, now)).toBeNull();
    expect(sleepTitle(sleep, now)).toContain("next wake");
    expect(sleepClassName(sleep)).toContain("green");
  });

  test("paused and stopped states do not display a countdown", () => {
    for (const state of ["paused", "stopped"]) {
      const sleep = { sleep_state: state, next_wake_at: "2026-09-10T07:21:25Z" };
      expect(sleepLabel(sleep, { compact: true, now })).toBe(state);
      expect(sleepRemainingMs(sleep, now)).toBe(0);
      expect(sleepTitle(sleep, now)).not.toContain("events wake immediately");
    }
  });
});
