export interface RuntimeThoughtText {
  reasoning?: string;
  response?: string;
}

export function appendRuntimeThoughtText(
  current: RuntimeThoughtText,
  kind: "reasoning" | "response",
  chunk: string,
): RuntimeThoughtText {
  if (!chunk) return current;
  if (kind === "reasoning") {
    return { ...current, reasoning: `${current.reasoning || ""}${chunk}` };
  }
  return { ...current, response: `${current.response || ""}${chunk}` };
}

export function cleanReasoningDisplay(value: string): string {
  return value.replace(/^\s*\*\*([^*\n]+)\*\*(?:\s*\n\s*\n)?/, "$1\n\n").trim();
}
