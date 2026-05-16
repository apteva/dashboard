// connectFlow.ts — pure helpers for the integration connect flow,
// extracted from pages/Integrations.tsx so the wizard's Setup step
// and (eventually, post-refactor) the Integrations page itself can
// share one implementation.
//
// Two helpers:
//   - openOAuthPopup(url): centered browser popup for the upstream
//     authorize URL. Returns the window handle so the caller can
//     monitor close events if it wants to.
//   - pollConnection(id, opts): polls /connections/:id every 1.5s
//     until the row flips out of `pending` (active or failed) or
//     the attempt cap is hit. Calls onDone with the final status.
//
// Both are framework-agnostic — no React imports — so they can
// also be reused by ad-hoc scripts.

import { integrations } from "../../api";

/** Open the upstream OAuth authorize URL in a centered popup window.
 *  Must be called inside the user-gesture handler that triggered the
 *  connect (otherwise popup blockers fire). Returns the window
 *  reference, or null when the browser refused to open the window.
 */
export function openOAuthPopup(url: string): Window | null {
  const w = 540;
  const h = 680;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  return window.open(
    url,
    "apteva-oauth",
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no`,
  );
}

export type PollOutcome =
  | { status: "active"; tries: number }
  | { status: "failed"; tries: number }
  | { status: "timeout"; tries: number };

/** Poll a pending connection until it leaves the `pending` state.
 *  Defaults: 1500ms cadence, up to 120 attempts (= 3 min).
 *  onUpdate fires every poll with the latest snapshot (useful for
 *  showing "still waiting…" UI). onDone fires once with the final
 *  outcome — never both an active AND a timeout. Transient HTTP
 *  errors are swallowed so a flaky 502 doesn't kill the poll.
 */
export function pollConnection(
  id: number,
  opts: {
    onDone: (outcome: PollOutcome) => void;
    onUpdate?: (status: string, tries: number) => void;
    cadenceMs?: number;
    maxAttempts?: number;
  },
): { cancel: () => void } {
  const cadence = opts.cadenceMs ?? 1500;
  const cap = opts.maxAttempts ?? 120;
  let cancelled = false;
  let attempts = 0;

  const tick = async () => {
    if (cancelled) return;
    attempts += 1;
    try {
      const c = await integrations.get(id);
      if (cancelled) return;
      opts.onUpdate?.(c.status, attempts);
      if (c.status === "active") {
        opts.onDone({ status: "active", tries: attempts });
        return;
      }
      if (c.status === "failed") {
        opts.onDone({ status: "failed", tries: attempts });
        return;
      }
    } catch {
      // swallow — transient errors shouldn't abort the poll
    }
    if (attempts >= cap) {
      opts.onDone({ status: "timeout", tries: attempts });
      return;
    }
    setTimeout(tick, cadence);
  };

  setTimeout(tick, cadence);
  return { cancel: () => { cancelled = true; } };
}
