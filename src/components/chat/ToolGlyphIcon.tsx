import type { ToolGlyph } from "./toolVisuals";

export function ToolGlyphIcon({ glyph }: { glyph: ToolGlyph }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 16,
    height: 16,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (glyph === "agent") return <svg {...common}><circle cx="12" cy="8" r="3"/><path d="M6.5 19c.8-3.4 2.6-5 5.5-5s4.7 1.6 5.5 5"/><path d="M18 6h3m-1.5-1.5v3"/></svg>;
  if (glyph === "chart") return <svg {...common}><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg>;
  if (glyph === "document") return <svg {...common}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6m-6 4h6"/></svg>;
  if (glyph === "globe") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>;
  if (glyph === "memory") return <svg {...common}><path d="M9 5a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 5 14v2a3 3 0 0 0 4 2.8M15 5a3 3 0 0 1 5 2.2A3.5 3.5 0 0 1 19 14v2a3 3 0 0 1-4 2.8M9 4v16m6-16v16M9 9h6m-6 6h6"/></svg>;
  if (glyph === "message") return <svg {...common}><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8m-8 3h5"/></svg>;
  if (glyph === "search") return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;
  if (glyph === "table") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>;
  return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z"/></svg>;
}
