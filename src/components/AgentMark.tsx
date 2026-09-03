// AgentMark is the shared product glyph for an Apteva agent. It is identity
// chrome, not an avatar: every agent uses the same mark, and semantic theme
// utilities plus currentColor make it follow every dashboard palette.
export function AgentMark({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const dimensions =
    size === "lg"
      ? "h-20 w-20 rounded-2xl"
      : size === "sm"
        ? "h-8 w-8 rounded-lg"
        : "h-10 w-10 rounded-xl";
  const glyphSize = size === "lg" ? 38 : size === "sm" ? 17 : 21;

  return (
    <span
      className={`${dimensions} inline-flex shrink-0 items-center justify-center border border-accent/25 bg-accent/10 text-accent shadow-sm`}
      aria-hidden="true"
    >
      <svg
        width={glyphSize}
        height={glyphSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5.5 18.5 10.2 6.4A2 2 0 0 1 12 5.1a2 2 0 0 1 1.8 1.3l4.7 12.1" />
        <path d="M8.2 14h7.6" />
        <path d="M7 18.5h2.2M14.8 18.5H17" />
        <circle
          cx="12"
          cy="18.5"
          r="1.15"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    </span>
  );
}
