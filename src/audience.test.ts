import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  AUDIENCES,
  AUDIENCE_SECTIONS,
  audienceShows,
  type Audience,
  type AudienceSection,
} from "./hooks/useAudience";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const GATED_FILES = [
  "./components/Layout.tsx",
  "./components/AgentView.tsx",
  "./pages/Settings.tsx",
];

const sectionKeys = Object.keys(AUDIENCE_SECTIONS) as AudienceSection[];

describe("audience tiers", () => {
  test("tiers are strictly nested — developer sees everything personal does", () => {
    for (const section of sectionKeys) {
      const visible = AUDIENCES.filter((a) => audienceShows(a, section));
      // Visibility must be an upward-closed suffix of personal → business
      // → developer. If a section were visible to personal but not to
      // developer the registry's minimum-tier model would be a lie.
      const expected = AUDIENCES.slice(AUDIENCES.indexOf(visible[0] as Audience));
      expect(visible).toEqual(expected);
    }
  });

  test("developer sees every gated section", () => {
    for (const section of sectionKeys) {
      expect(audienceShows("developer", section)).toBe(true);
    }
  });

  test("personal is strictly narrower than developer", () => {
    const personal = sectionKeys.filter((s) => audienceShows("personal", s));
    expect(personal.length).toBeLessThan(sectionKeys.length);
  });
});

describe("section registry stays in sync with call sites", () => {
  // Two reference styles, both legitimate: a direct `shows("key")` call
  // in JSX, and a `section: "key"` field on a nav entry that Layout
  // filters as data. Both count as a live call site.
  const referenced = new Set<string>();
  for (const file of GATED_FILES) {
    const text = source(file);
    for (const match of text.matchAll(/shows\(\s*["']([a-zA-Z.]+)["']\s*\)/g)) {
      referenced.add(match[1]!);
    }
    for (const match of text.matchAll(/section:\s*["']([a-zA-Z.]+)["']/g)) {
      referenced.add(match[1]!);
    }
  }

  test("every referenced section key exists in the registry", () => {
    const unknown = [...referenced].filter((key) => !sectionKeys.includes(key as AudienceSection));
    expect(unknown).toEqual([]);
  });

  test("every registry key is referenced somewhere", () => {
    // A key registry rots fast when entries outlive their call sites.
    // Anything unreferenced is either a missed gate or dead config.
    const orphans = sectionKeys.filter((key) => !referenced.has(key));
    expect(orphans).toEqual([]);
  });
});

describe("audience never unmounts a route", () => {
  test("Layout gates nav entries, not the router", () => {
    const app = source("./App.tsx");
    // Routes must stay registered at every audience so deep links and
    // Helper-driven navigation keep working. If App.tsx ever gates a
    // <Route> on audience, that contract is broken.
    expect(app).not.toMatch(/shows\(|useAudience\(\)\.shows/);
    expect(app).toContain("AudienceProvider");
  });

  test("gated nav entries carry a section key rather than being deleted", () => {
    const layout = source("./components/Layout.tsx");
    expect(layout).toContain('section: "nav.dashboard"');
    expect(layout).toContain('section: "nav.monitor"');
    expect(layout).toContain('section: "nav.skills"');
    expect(layout).toContain('shows("nav.appPages")');
  });

  test("interface level does not alter vocabulary or authorization", () => {
    const hook = source("./hooks/useAudience.tsx");
    const i18n = source("./i18n/index.ts");
    expect(hook).not.toContain("data-audience");
    expect(hook).not.toContain("applyAudienceVocabulary");
    expect(i18n).not.toContain("audienceVocabulary");
  });

  test("personal home uses the shared Layout shell without gating routes", () => {
    const app = source("./App.tsx");
    const layout = source("./components/Layout.tsx");
    const personal = source("./pages/Personal.tsx");
    expect(app).toContain('audience === "personal" ? <Personal /> : <Dashboard />');
    expect(layout).toContain("<SidebarAgentLink");
    expect(layout).toContain("{renderSidebar(false)}");
    expect(layout).not.toContain("isPersonalHome");
    expect(personal).not.toContain("<aside");
  });

  test("server preferences replace device-local persistence", () => {
    const hook = source("./hooks/useAudience.tsx");
    expect(hook).toContain("updatePreferences({ interface_level:");
    expect(hook).toContain("localStorage.removeItem(STORAGE_KEY)");
    expect(hook).not.toContain("localStorage.setItem(STORAGE_KEY");
  });
});

describe("interface settings copy", () => {
  const LOCALES = ["en", "fr", "es"];

  test("every audience has a label and description in every locale", () => {
    for (const locale of LOCALES) {
      const interfaceSettings = JSON.parse(source(`./i18n/locales/${locale}.json`)).settings.interface;
      for (const audience of AUDIENCES) {
        expect(interfaceSettings[audience]).toBeTruthy();
        expect(interfaceSettings[`${audience}Description`]).toBeTruthy();
      }
      expect(interfaceSettings.level).toBeTruthy();
      expect(interfaceSettings.hint).toBeTruthy();
    }
  });
});

describe("settings tabs", () => {
  test("every audience keeps at least the ungated core tabs", () => {
    // interface, appearance, channels, data and account carry no section key, so
    // even personal retains a working Settings page. If someone gates
    // all of them the page becomes an empty shell — fail loudly here.
    const settings = source("./pages/Settings.tsx");
    for (const core of ['id: "interface"', 'id: "appearance"', 'id: "channels"', 'id: "data"', 'id: "account"']) {
      const line = settings.split("\n").find((l) => l.includes(core)) ?? "";
      expect(line).not.toInclude("section:");
    }
  });
});
