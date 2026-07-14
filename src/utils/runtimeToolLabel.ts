export function runtimeToolLabel(name: string, reason: string, fallback?: string): string {
  const toolName = name.trim();
  const activity = reason.trim();
  if (toolName && activity) return `${toolName} — ${activity}`;
  return activity || fallback || toolName;
}
