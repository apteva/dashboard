import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";

export type DashboardLanguage = "en" | "fr" | "es";

export const DASHBOARD_LANGUAGES: DashboardLanguage[] = ["en", "fr", "es"];

const STORAGE_KEY = "apteva.language";

export function normalizeDashboardLanguage(value: unknown): DashboardLanguage {
  const raw = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (raw.startsWith("fr")) return "fr";
  if (raw.startsWith("es")) return "es";
  return "en";
}

function initialLanguage(): DashboardLanguage {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeDashboardLanguage(stored);
  } catch {
    // localStorage can be unavailable in private or embedded contexts.
  }
  return normalizeDashboardLanguage(window.navigator?.language);
}

const BASE_LOCALES: Record<DashboardLanguage, Record<string, unknown>> = { en, fr, es };

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// ─── Audience vocabulary ─────────────────────────────────────────────
//
// Each locale file may carry a `_audienceVocabulary` block: per-audience
// label overrides layered onto the base bundle (e.g. business renames
// nav.integrations to "Connected accounts"). Call sites keep using
// t("nav.integrations") unchanged — the audience decides what that key
// resolves to. Rebuilding is deterministic: always base ⊕ overrides for
// the requested audience, so switching audiences never leaves stale
// labels behind.

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = target[key];
      const nested =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : (target[key] = {} as Record<string, unknown>);
      deepMerge(nested as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

export function audienceVocabulary(language: DashboardLanguage, audience: string): Record<string, unknown> {
  const block = BASE_LOCALES[language]?.["_audienceVocabulary"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  return block?.[audience] ?? {};
}

export function applyAudienceVocabulary(audience: string) {
  for (const language of DASHBOARD_LANGUAGES) {
    const merged = structuredClone(BASE_LOCALES[language]) as Record<string, unknown>;
    deepMerge(merged, audienceVocabulary(language, audience));
    i18n.removeResourceBundle(language, "translation");
    i18n.addResourceBundle(language, "translation", merged, true, true);
  }
  // react-i18next re-renders on languageChanged; re-asserting the current
  // language is the supported way to flush the rebuilt bundles through.
  void i18n.changeLanguage(i18n.language);
}

export async function setDashboardLanguage(language: unknown) {
  const normalized = normalizeDashboardLanguage(language);
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Best effort only; server persistence is the source of truth.
  }
  await i18n.changeLanguage(normalized);
  return normalized;
}

export default i18n;
