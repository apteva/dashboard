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
    expect(layout).toContain('section: "nav.monitor"');
    expect(layout).toContain('section: "nav.skills"');
    expect(layout).toContain('shows("nav.agentNew")');
  });
});

describe("appearance copy", () => {
  const LOCALES = ["en", "fr", "es"];

  test("every audience has a label and description in every locale", () => {
    for (const locale of LOCALES) {
      const appearance = JSON.parse(source(`./i18n/locales/${locale}.json`)).settings.appearance;
      for (const audience of AUDIENCES) {
        expect(appearance[`audience_${audience}`]).toBeTruthy();
        expect(appearance[`audience_${audience}Description`]).toBeTruthy();
      }
      expect(appearance.audience).toBeTruthy();
      expect(appearance.audienceHint).toBeTruthy();
    }
  });
});

describe("audience vocabulary", () => {
  const LOCALES = ["en", "fr", "es"];

  const leafPaths = (node: unknown, prefix = ""): string[] => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [prefix];
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafPaths(value, prefix ? `${prefix}.${key}` : key),
    );
  };
  const lookup = (node: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>(
      (cursor, key) =>
        cursor && typeof cursor === "object" ? (cursor as Record<string, unknown>)[key] : undefined,
      node,
    );

  test("every override shadows a real base key in every locale", () => {
    // An override whose path doesn't exist in the base bundle is dead
    // config at best and a typo hiding a missing rename at worst.
    for (const locale of LOCALES) {
      const bundle = JSON.parse(source(`./i18n/locales/${locale}.json`));
      const vocabulary = bundle._audienceVocabulary ?? {};
      for (const [audience, overrides] of Object.entries(vocabulary)) {
        expect(AUDIENCES).toContain(audience as Audience);
        for (const path of leafPaths(overrides)) {
          expect(`${locale}/${audience}: ${path} = ${lookup(bundle, path)}`).not.toInclude("undefined");
        }
      }
    }
  });

  test("locales agree on which audiences they override", () => {
    const shapes = LOCALES.map((locale) => {
      const vocabulary = JSON.parse(source(`./i18n/locales/${locale}.json`))._audienceVocabulary ?? {};
      return Object.entries(vocabulary)
        .map(([audience, overrides]) => `${audience}:${leafPaths(overrides).sort().join(",")}`)
        .sort()
        .join(" | ");
    });
    expect(new Set(shapes).size).toBe(1);
  });

  test("Agents keeps its name in every audience and locale", () => {
    // The product's core noun is exempt from vocabulary: renaming it
    // per audience would fork docs, support, and muscle memory.
    for (const locale of LOCALES) {
      const vocabulary = JSON.parse(source(`./i18n/locales/${locale}.json`))._audienceVocabulary ?? {};
      for (const overrides of Object.values(vocabulary)) {
        expect(lookup(overrides, "nav.agents")).toBeUndefined();
      }
    }
  });
});

describe("settings tabs", () => {
  test("every audience keeps at least the ungated core tabs", () => {
    // appearance, channels, data and account carry no section key, so
    // even personal retains a working Settings page. If someone gates
    // all of them the page becomes an empty shell — fail loudly here.
    const settings = source("./pages/Settings.tsx");
    for (const core of ['id: "appearance"', 'id: "channels"', 'id: "data"', 'id: "account"']) {
      const line = settings.split("\n").find((l) => l.includes(core)) ?? "";
      expect(line).not.toInclude("section:");
    }
  });
});
