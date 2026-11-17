import type { ReactNode } from "react";
import type { ProjectPreset } from "../../api";

// Workspace symbols have their own visual vocabulary; agent avatars represent people/roles.
const symbols = {
  compass: <><circle cx="12" cy="12" r="8" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  home: <><path d="m3.5 10 8.5-7 8.5 7M6 8v12h12V8M10 20v-6h4v6" /></>,
  wellbeing: <><path d="M12 20S3.5 15 3.5 9a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2c0 6-8.5 11-8.5 11Z" /><path d="M7 12h3l1.5-3 2 6L15 12h2" /></>,
  creator: <><path d="m5 16 11-11 3 3L8 19l-4 1zM13 8l3 3M14 20h6" /></>,
  briefcase: <><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M9 7V4h6v3M4 12c5 3 11 3 16 0M10 12v3h4v-3" /></>,
  sales: <><path d="M4 5h16l-6 7v7l-4 2v-9z" /><path d="M8 8h8" /></>,
  support: <><path d="M5 13v-2a7 7 0 0 1 14 0v2M19 16v2a2 2 0 0 1-2 2h-4" /><rect x="3" y="11" width="4" height="6" rx="1.5" /><rect x="17" y="11" width="4" height="6" rx="1.5" /></>,
  research: <><circle cx="10" cy="10" r="6" /><path d="m14.5 14.5 5.5 5.5M7 10h6M10 7v6" /></>,
  video: <><rect x="3" y="5" width="13" height="11" rx="2" /><path d="m8 8 4 2.5-4 2.5zM7 20h13M19 6v10M19 16l-2-2M19 16l2-2" /></>,
  target: <><circle cx="11" cy="13" r="7" /><circle cx="11" cy="13" r="3" /><path d="m11 13 8-8M16 3v5h5" /></>,
  services: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 9h6M9 13h3M9 17l2 2 5-5" /></>,
  shop: <><path d="M5 9v11h14V9M3 9l2-5h14l2 5M3 9c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0M9 20v-6h6v6" /></>,
  location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  webinar: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="m10 7 5 3-5 3zM12 16v4M7 21l5-3 5 3" /></>,
  code: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18M9 11l-3 3 3 3M15 11l3 3-3 3" /></>,
  team: <><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" /></>,
  servers: <><rect x="4" y="3" width="16" height="7" rx="2" /><rect x="4" y="14" width="16" height="7" rx="2" /><path d="M8 6.5h.01M8 17.5h.01M13 6.5h3M13 17.5h3M12 10v4" /></>,
  quality: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" /></>,
  chart: <><path d="M4 4v16h17M8 16v-4M13 16V8M18 16V5" /></>,
  scratch: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12h8M12 8v8" /></>,
} satisfies Record<string, ReactNode>;

type SymbolName = keyof typeof symbols;
const presetSymbols: Record<string, SymbolName> = {
  "personal-assistant": "compass", "personal-household": "home", "personal-wellbeing": "wellbeing", "personal-creator": "creator",
  "work-executive": "briefcase", "work-sales": "sales", "work-support": "support", "work-research": "research", "work-youtube-to-blog": "video",
  "business-lead-generation": "target", "business-professional-services": "services", "business-ecommerce": "shop", "business-local-services": "location", "business-webinars": "webinar",
  "development-software": "code", "development-engineering-team": "team", "development-product-team": "team", "development-devops": "servers", "development-qa": "quality", "development-data": "chart",
};
const categorySymbols: Record<ProjectPreset["category"], SymbolName> = {
  personal: "compass", business: "shop", work: "briefcase", development: "code",
};

export function PresetMark({ preset, size = "sm" }: { preset?: Pick<ProjectPreset, "id" | "category"> | null; size?: "sm" | "md" }) {
  const symbol = preset ? presetSymbols[preset.id] || categorySymbols[preset.category] || "compass" : "scratch";
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-accent/35 text-accent ${size === "md" ? "h-11 w-11" : "h-9 w-9"}`}>
    <svg width={size === "md" ? 26 : 22} height={size === "md" ? 26 : 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{symbols[symbol]}</svg>
  </span>;
}
