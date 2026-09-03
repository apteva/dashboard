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
