export interface ChatThinkingPlaceholder {
  since: number;
  threadId: string;
  generation: number;
  iteration: number | null;
}

export function telemetryIteration(data: Record<string, any> | undefined): number | null {
  const raw = data?.iteration;
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Only the beginning of visible tool work replaces the current reasoning
 * placeholder. A result can arrive after core has already started a newer LLM
 * pass (notably for a long-running tool), so completion must never clear the
 * newer pass's Thinking indicator.
 */
export function toolEventReplacesThinking(eventType: string): boolean {
  return eventType === "llm.tool_chunk" || eventType === "tool.call";
}

/**
 * A tool lifecycle is painted on a later animation frame so fast tools still
 * show their streaming/running/completed phases. Only clear the Thinking
 * placeholder that existed when that tool event was received; a newer
 * llm.start belongs to the follow-up reasoning pass and must survive.
 */
export function clearThinkingThroughGeneration(
  current: ChatThinkingPlaceholder | null,
  generation: number,
): ChatThinkingPlaceholder | null {
  if (current && current.generation > generation) return current;
  return null;
}

/**
 * Persisted llm.done telemetry can arrive just after the next live llm.start.
 * Match iterations so completion of the tool-selecting pass cannot erase the
 * placeholder for the answer-composing pass.
 */
export function clearThinkingForIteration(
  current: ChatThinkingPlaceholder | null,
  iteration: number | null,
): ChatThinkingPlaceholder | null {
  if (
    current &&
    current.iteration !== null &&
    iteration !== null &&
    current.iteration !== iteration
  ) {
    return current;
  }
  return null;
}
