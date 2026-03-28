export function StatusDot({ status }: { status: string }) {
  const color =
    status === "running" || status === "reactive" || status === "fast"
      ? "bg-green"
      : status === "normal"
      ? "bg-blue"
      : status === "error"
      ? "bg-red"
      : "bg-text-muted";

  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
