import { useState, useEffect, useRef } from "react";
import type { SubscribeFn } from "./InstanceView";

interface Props {
  subscribe: SubscribeFn;
  threadId?: string; // defaults to "main"
}

// ChatStatusDot replaces the old multi-line "Thinking… <live reasoning
// preview>" block that used to live inside ChatPanel. It consumes the
// same telemetry events (llm.start / llm.done / llm.error / tool.call
// / tool.result) but renders them as a single colored dot + one-word
// status in the chat header. No reasoning preview — that belongs in
// Activity where operators look for it.
//
// State machine:
//   idle      → llm.start              → thinking
//   thinking  → tool.call               → calling(tool)
//   calling   → tool.result (last one)  → back to idle (next llm.start flips to thinking)
//   any       → llm.error               → error
//   any       → llm.done (no tools)     → idle
export function ChatStatusDot({ subscribe, threadId = "main" }: Props) {
  const [state, setState] = useState<DotState>({ kind: "idle" });

  // Track in-flight tool calls by id so we can tell when the LAST one
  // finishes and go back to idle. A counter would race on
  // tool.call/tool.result ordering; per-id map is correct regardless
  // of arrival order.
  const activeToolsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setState({ kind: "idle" });
    activeToolsRef.current = new Map();
    return subscribe((event) => {
      // Only main-thread activity feeds the chat status by default;
      // sub-thread activity is visible in the fleet view.
      if (event.thread_id !== threadId && event.thread_id !== "") return;
      const data = event.data || {};

      switch (event.type) {
        case "llm.start":
          if (activeToolsRef.current.size === 0) setState({ kind: "thinking" });
          return;
        case "llm.done":
          if (activeToolsRef.current.size === 0) setState({ kind: "idle" });
          return;
        case "llm.error":
        case "llm.err":
          setState({ kind: "error", message: String(data.error || "LLM error") });
          return;
        case "tool.call": {
          const id = String(data.id || "");
          const name = String(data.name || "tool");
          if (id) activeToolsRef.current.set(id, name);
          setState({ kind: "calling", tool: name });
          return;
        }
        case "tool.result": {
          const id = String(data.id || "");
          if (id) activeToolsRef.current.delete(id);
          if (activeToolsRef.current.size === 0) {
            setState({ kind: "idle" });
          } else {
            const iter = activeToolsRef.current.values();
            const next = iter.next();
            const tool = next.done ? "tool" : next.value;
            setState({ kind: "calling", tool });
          }
          return;
        }
      }
    });
  }, [subscribe, threadId]);

  const view = renderFor(state);
  return (
    <span
      className="flex items-center gap-1.5 text-[10px] text-text-dim shrink-0"
      title={view.title}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${view.color} ${
          state.kind === "thinking" || state.kind === "calling" ? "animate-pulse" : ""
        }`}
      />
      <span className="uppercase tracking-wide truncate max-w-[120px]">{view.label}</span>
    </span>
  );
}

type DotState =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "calling"; tool: string }
  | { kind: "error"; message: string };

function renderFor(s: DotState): { color: string; label: string; title: string } {
  switch (s.kind) {
    case "idle":
      return { color: "bg-text-dim", label: "idle", title: "Agent is idle." };
    case "thinking":
      return { color: "bg-accent", label: "thinking", title: "Agent is reasoning." };
    case "calling":
      return { color: "bg-accent", label: s.tool, title: `Agent is calling tool: ${s.tool}` };
    case "error":
      return { color: "bg-red", label: "error", title: s.message };
  }
}
