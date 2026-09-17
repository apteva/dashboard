import type { TelemetryEvent } from "../api";

export function threadTokenUsage(events: TelemetryEvent[]) {
  const usage = { in: 0, out: 0, cache: 0, cacheWrite: 0, cacheReported: false };
  const seen = new Set<string>();
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  for (const event of events) {
    // Other execution events repeat these counters; only completed LLM calls count.
    if (event.type !== "llm.done" || (event.id && seen.has(event.id))) continue;
    if (event.id) seen.add(event.id);
    const data = event.data || {};
    usage.in += count(data.tokens_in);
    usage.out += count(data.tokens_out);
    usage.cache += count(data.tokens_cached);
    usage.cacheWrite += count(data.cache_write_tokens);
    usage.cacheReported ||= data.tokens_cached != null;
  }
  return usage;
}
