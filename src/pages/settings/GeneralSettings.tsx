import { PRODUCT_TOUR, requestProductTour } from "../../components/tour/config";

import { useState } from "react";

import { auth } from "../../api";

import { useAuth } from "../../hooks/useAuth";
import { useTheme, type ThemeName, type ThemeMode } from "../../hooks/useTheme";
import { useAudience, AUDIENCES } from "../../hooks/useAudience";

import { useTranslation } from "react-i18next";
import { DASHBOARD_LANGUAGES, normalizeDashboardLanguage, setDashboardLanguage, type DashboardLanguage } from "../../i18n";

export function AppearanceTab() {
  const { theme, mode, resolvedMode, setTheme, setMode } = useTheme();
  const { user, refresh } = useAuth();
  const { t, i18n } = useTranslation();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageMessage, setLanguageMessage] = useState<string | null>(null);
  const currentLanguage = normalizeDashboardLanguage(i18n.resolvedLanguage || i18n.language);

  async function chooseLanguage(language: DashboardLanguage) {
    const previous = currentLanguage;
    setSavingLanguage(true);
    setLanguageMessage(null);
    await setDashboardLanguage(language);
    try {
      await auth.updatePreferences({ language });
      await refresh();
      setLanguageMessage(i18n.t("settings.appearance.languageSaved"));
    } catch {
      await setDashboardLanguage(previous);
      setLanguageMessage(i18n.t("settings.appearance.languageSaveFailed"));
    } finally {
      setSavingLanguage(false);
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <h2 className="text-text font-medium mb-1">{t("settings.appearance.title")}</h2>
        <p className="text-text-muted text-sm">
          {t("settings.appearance.description")}
        </p>
      </div>

      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">{t("settings.appearance.theme")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <ThemeCard
            value="terminal"
            label={t("settings.appearance.themeTerminal")}
            description={t("settings.appearance.themeTerminalDescription")}
            selected={theme === "terminal"}
            onSelect={() => setTheme("terminal")}
          />
          <ThemeCard
            value="clean"
            label={t("settings.appearance.themeClean")}
            description={t("settings.appearance.themeCleanDescription")}
            selected={theme === "clean"}
            onSelect={() => setTheme("clean")}
          />
        </div>
      </section>

      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">{t("settings.appearance.mode")}</h3>
        <div className="flex flex-wrap gap-2">
          {(["auto", "dark", "light"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                mode === m
                  ? "border-accent text-text bg-bg-card"
                  : "border-border text-text-muted hover:text-text hover:border-text-dim"
              }`}
            >
              {m === "auto"
                ? t("settings.appearance.modeAuto")
                : m === "dark"
                  ? t("settings.appearance.modeDark")
                  : t("settings.appearance.modeLight")}
              {m === "auto" && (
                <span className="ml-2 text-text-dim text-xs">
                  ({t("settings.appearance.currently")} {resolvedMode})
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-text-dim text-xs mt-2">
          {t("settings.appearance.autoModeHint")}
        </p>
      </section>

      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">{t("settings.appearance.language")}</h3>
        <div className="flex flex-wrap gap-2">
          {DASHBOARD_LANGUAGES.map((language) => (
            <button
              key={language}
              onClick={() => chooseLanguage(language)}
              disabled={savingLanguage || user === false}
              className={`px-4 py-2 text-sm rounded border transition-colors ${
                currentLanguage === language
                  ? "border-accent text-text bg-bg-card"
                  : "border-border text-text-muted hover:text-text hover:border-text-dim"
              } disabled:opacity-60`}
            >
              {t(`language.${language}`)}
            </button>
          ))}
        </div>
        <p className="text-text-dim text-xs mt-2">{t("settings.appearance.languageDescription")}</p>
        {languageMessage && (
          <p className="text-text-muted text-xs mt-2">{languageMessage}</p>
        )}
      </section>
    </div>
  );
}

export function InterfaceTab() {
  const { audience, saving, setAudience } = useAudience();
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);

  async function chooseAudience(value: (typeof AUDIENCES)[number]) {
    if (saving) return;
    setMessage(value === "developer" ? null : t("settings.interface.preparing"));
    try {
      await setAudience(value);
      setMessage(t("settings.interface.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("settings.interface.saveFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <h2 className="text-text font-medium mb-1">{t("settings.interface.title")}</h2>
        <p className="text-text-muted text-sm">{t("settings.interface.description")}</p>
      </div>
      {PRODUCT_TOUR.enabled && <section className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-text">Explore Apteva</h3>
        <p className="mt-1 text-sm text-text-muted">A quick, interactive guide to agents, apps, connected accounts, and your workspace. Skip at any time.</p>
        <button type="button" onClick={requestProductTour} className="mt-3 min-h-10 rounded-lg border border-accent px-4 text-sm font-semibold text-accent hover:bg-accent/10">Show me around</button>
      </section>}
      <section>
        <h3 className="text-text-muted text-xs uppercase tracking-wide mb-3">
          {t("settings.interface.level")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
          {AUDIENCES.map((value) => (
            <button
              key={value}
              type="button"
              disabled={saving}
              onClick={() => void chooseAudience(value)}
              className={`text-left border rounded-lg p-3 transition-colors disabled:opacity-60 ${
                audience === value
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-text-dim"
              }`}
            >
              <div className="text-text text-sm font-bold">
                {t(`settings.interface.${value}`)}
              </div>
              <div className="text-text-muted text-xs mt-1 leading-relaxed">
                {t(`settings.interface.${value}Description`)}
              </div>
            </button>
          ))}
        </div>
        <p className="text-text-dim text-xs mt-2">{t("settings.interface.hint")}</p>
        {message && <p className="text-text-muted text-xs mt-2">{message}</p>}
      </section>
    </div>
  );
}

function ThemeCard({
  value,
  label,
  description,
  selected,
  onSelect,
}: {
  value: ThemeName;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  void value;
  return (
    <button
      onClick={onSelect}
      className={`text-left border rounded-lg p-4 transition-colors ${
        selected
          ? "border-accent bg-bg-card"
          : "border-border hover:border-text-dim"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 rounded-full border ${
            selected ? "bg-accent border-accent" : "border-border"
          }`}
        />
        <span className="text-text font-medium">{label}</span>
      </div>
      <p className="text-text-muted text-xs leading-relaxed">{description}</p>
    </button>
  );
}
