import type { RunMode } from "./api";

export const behaviorDescriptions: Record<RunMode, string> = {
  autonomous: "Instructs the agent to act independently within its scope and permissions, respecting explicit approval requirements.",
  cautious: "Instructs the agent to ask and wait before state-changing actions. Read-only work can proceed within scope.",
  learn: "Instructs the agent to ask before unfamiliar tool and scope combinations, including reads, and reuse approvals available in context. No dedicated safety-profile storage.",
};
export const behaviorExplanation = "These choices add behavior instructions; they do not enforce approval gates.";


export const defaultProactivity = 25;
export function proactivityLabel(value: number): string {
  if (value === 0) return "Reactive";
  if (value <= 25) return "Conservative";
  if (value <= 50) return "Balanced";
  if (value <= 75) return "Proactive";
  return "Highly proactive";
}
export function proactivityDescription(value: number): string {
  if (value === 0) return "Responds to events and completes assigned work, including recurring responsibilities. Initiates no unsolicited work.";
  if (value <= 25) return "Makes tiny adjacent follow-ups when the need and exact action are already known. Does not start unsolicited investigations.";
  if (value <= 50) return "Investigates observed problems with clear expected benefit and completes one bounded improvement. Skips weak leads and speculative experiments.";
  if (value <= 75) return "Validates a promising but uncertain lead and may run a small reversible experiment. Needs an existing lead; does not start discovery without one.";
  return "Reviews unexamined areas, compares opportunities, and coordinates worthwhile initiatives within its goals. Still sleeps when nothing useful remains; does not invent busywork.";
}
