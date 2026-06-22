import type { SleepState } from "../api";

export interface SleepLike {
  sleep_state?: SleepState;
  sleep_thread_id?: string;
  sleep_started_at?: string;
  next_wake_at?: string;
  sleep_total_ms?: number;
  sleep_remaining_ms?: number;
  sleep_iteration?: number;
}

export function sleepRemainingMs(sleep?: SleepLike | null, now = Date.now()): number {
  if (!sleep) return 0;
  if (sleep.next_wake_at) {
    const target = Date.parse(sleep.next_wake_at);
    if (Number.isFinite(target)) return Math.max(0, target - now);
  }
  return Math.max(0, Number(sleep.sleep_remaining_ms) || 0);
}

export function sleepProgress(sleep?: SleepLike | null, now = Date.now()): number | null {
  const total = Number(sleep?.sleep_total_ms) || 0;
  if (total <= 0) return null;
  const remaining = sleepRemainingMs(sleep, now);
  return Math.max(0, Math.min(1, (total - remaining) / total));
}

export function sleepLabel(sleep?: SleepLike | null, opts: { compact?: boolean; now?: number } = {}): string {
  const state = String(sleep?.sleep_state || "unknown");
  const compact = !!opts.compact;
  const remaining = sleepRemainingMs(sleep, opts.now ?? Date.now());
  if (state === "sleeping") {
    const time = formatRemaining(remaining);
    return compact ? `sleep ${time}` : `Sleeping · ${time}`;
  }
  if (state === "overdue") return compact ? "active" : "Active";
  if (state === "active") return compact ? "active" : "Active";
  if (state === "paused") return compact ? "paused" : "Paused";
  if (state === "stopped") return compact ? "stopped" : "Stopped";
  return compact ? "waiting" : "Waiting";
}

export function sleepTitle(sleep?: SleepLike | null, now = Date.now()): string {
  if (!sleep) return "Sleep state unknown";
  const parts: string[] = [sleepLabel(sleep, { now })];
  if (sleep.sleep_thread_id) parts.push(`thread ${sleep.sleep_thread_id}`);
  if (sleep.sleep_iteration) parts.push(`iteration #${sleep.sleep_iteration}`);
  if (sleep.next_wake_at) {
    const at = Date.parse(sleep.next_wake_at);
    if (Number.isFinite(at)) parts.push(`next wake ${new Date(at).toLocaleTimeString()}`);
  }
  if (sleep.sleep_started_at) {
    const at = Date.parse(sleep.sleep_started_at);
    if (Number.isFinite(at)) parts.push(`last step ${new Date(at).toLocaleTimeString()}`);
  }
  parts.push("events wake immediately");
  return parts.join(" · ");
}

export function sleepClassName(sleep?: SleepLike | null): string {
  const state = String(sleep?.sleep_state || "unknown");
  if (state === "sleeping") return "bg-blue/15 text-blue";
  if (state === "active") return "bg-green/15 text-green";
  if (state === "overdue") return "bg-green/15 text-green";
  if (state === "paused") return "bg-yellow/15 text-yellow";
  if (state === "stopped") return "bg-border text-text-dim";
  return "bg-border text-text-muted";
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}
