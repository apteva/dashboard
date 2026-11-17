import { AppIcon, type AppIconSize } from "@apteva/ui-kit";
import type { WidgetDefinition } from "./WidgetCanvas";

function symbol(content: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`)}`;
}

const grid = symbol('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>');
const robot = symbol('<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 4v3M2 12v4m20-4v4M9 16h6"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="12" cy="3" r="1"/>');
const activity = symbol('<path d="M3 12h4l3-7 4 14 3-7h4"/>');
const document = symbol('<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h4"/>');
const icons: Record<string, string> = {
  "native:helper": "/apteva-mark-mask.png",
  "native:system-map": symbol('<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="2" y="16" width="6" height="5" rx="1.5"/><rect x="16" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M5 16v-4h14v4"/>'),
  "native:workspace-summary": symbol('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M10 9v12m4-8h3m-3 4h3"/>'),
  "native:quick-actions": symbol('<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>'),
  "native:context-inspector": symbol('<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6m-3-3h6"/>'),
  "native:readiness": symbol('<path d="m12 3 10 18H2L12 3ZM12 9v5m0 3h.01"/>'),
  "native:agents": robot,
  "native:apps": grid,
  "native:integrations": symbol('<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4"/>'),
  "native:skills": symbol('<path d="M12 6C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 2Zm0 0v14M6 8h3m-3 4h3m6-4h3m-3 4h3"/>'),
  "native:agent-activity": activity,
  "native:activity": symbol('<path d="M5 3v18M5 6h5m-5 6h10m-10 6h5"/><circle cx="13" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>'),
  "native:usage": symbol('<path d="M3 3v18h18M7 17v-5m5 5V7m5 10v-8"/>'),
  "native:result-preview": document,
  "native:agent-results": document,
};

/** The same framed, themed identity used by Apps, including native symbols. */
export function WidgetIcon({ definition, size = "md" }: {
  definition: Pick<WidgetDefinition, "key" | "label" | "icon" | "iconStyle">;
  size?: AppIconSize;
}) {
  const fallback = icons[definition.key] || grid;
  return <AppIcon name={definition.label} src={definition.icon || fallback}
    iconStyle={definition.icon ? definition.iconStyle : "monochrome"} size={size}
    className="rounded-lg border border-border text-accent" />;
}
