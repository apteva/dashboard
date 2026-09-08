import type { RunMode } from "./api";

export const behaviorDescriptions: Record<RunMode, string> = {
  autonomous: "Instructs the agent to act independently within its scope and permissions, respecting explicit approval requirements.",
  cautious: "Instructs the agent to ask and wait before state-changing actions. Read-only work can proceed within scope.",
  learn: "Instructs the agent to ask before unfamiliar tool and scope combinations, including reads, and reuse approvals available in context. No dedicated safety-profile storage.",
};
export const behaviorExplanation = "These choices add behavior instructions; they do not enforce approval gates.";
