import type { TelemetryEvent } from "../api";

type ToolLifecyclePhase = 0 | 1 | 2;

function lifecyclePhase(event: TelemetryEvent): ToolLifecyclePhase | null {
  if (event.type === "llm.tool_chunk") return 0;
  if (event.type === "tool.call") return 1;
  if (event.type === "tool.result") return 2;
  return null;
}

function lifecycleKey(event: TelemetryEvent): string {
  const data = event.data || {};
  const explicitId = String(data.id || data.call_id || data.tool_call_id || "").trim();
  if (explicitId) return `${event.thread_id || "main"}#${explicitId}`;

  // Older providers can omit the call id on the streaming delta. tool.call
  // telemetry also omits iteration, so thread + tool is the only identity
  // shared by all three lifecycle events in that compatibility path.
  const name = String(data.tool || data.name || "").trim();
  return `${event.thread_id || "main"}#${name}`;
}

/**
 * Split a burst of telemetry so one tool call cannot cross more than one
 * visible lifecycle boundary in a browser frame.
 *
 * Core deliberately coalesces live telemetry for 25ms before forwarding it.
 * A fast tool can therefore reach the dashboard as chunk → call → result in
 * one burst. Reducing that entire burst in one React update means the browser
 * only ever paints the final result. This helper keeps parallel calls
 * independent while deferring later phases of the same call to the next
 * animation frame.
 */
export function splitToolTelemetryPaintFrame(events: TelemetryEvent[]): {
  paint: TelemetryEvent[];
  deferred: TelemetryEvent[];
} {
  const firstPhaseByCall = new Map<string, ToolLifecyclePhase>();
  for (const event of events) {
    const phase = lifecyclePhase(event);
    if (phase == null) continue;
    const key = lifecycleKey(event);
    if (!firstPhaseByCall.has(key)) firstPhaseByCall.set(key, phase);
  }

  const paint: TelemetryEvent[] = [];
  const deferred: TelemetryEvent[] = [];
  for (const event of events) {
    const phase = lifecyclePhase(event);
    if (phase == null) {
      paint.push(event);
      continue;
    }
    const visiblePhase = firstPhaseByCall.get(lifecycleKey(event));
    if (phase === visiblePhase) paint.push(event);
    else deferred.push(event);
  }
  return { paint, deferred };
}
