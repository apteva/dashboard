// useTheme — manages the dashboard's theme + mode preference.
//
// State model:
//   - theme: "terminal" | "clean"           (identity: font + radii + accent)
//   - mode:  "auto" | "dark" | "light"      ("auto" follows OS prefers-color-scheme)
//
// Persisted in localStorage as `apteva.appearance` = {theme, mode}.
// The actual `data-mode` attribute on <html> is always the resolved
// dark/light value — `auto` is just the user's preference; the
// effective DOM attribute is dark or light at any given moment.
//
// FOUC: the inline script in index.html sets data-theme + data-mode
// synchronously before this hook runs. The hook keeps the DOM in
// sync with React state going forward.
//
// Cross-tab sync: the storage listener picks up changes from another
// tab so an Appearance toggle in one window updates the others
// immediately.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeName = "terminal" | "clean";
export type ThemeMode = "auto" | "dark" | "light";
type ResolvedMode = "dark" | "light";

interface Appearance {
  theme: ThemeName;
  mode: ThemeMode;
}

interface ThemeCtx {
  theme: ThemeName;
  mode: ThemeMode;
  resolvedMode: ResolvedMode;     // what's actually applied to the DOM right now
  setTheme: (t: ThemeName) => void;
  setMode: (m: ThemeMode) => void;
}

const STORAGE_KEY = "apteva.appearance";
const DEFAULT: Appearance = { theme: "terminal", mode: "auto" };

const Ctx = createContext<ThemeCtx | null>(null);

function readStored(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === "clean" ? "clean" : "terminal",
      mode: parsed.mode === "dark" || parsed.mode === "light" ? parsed.mode : "auto",
    };
  } catch {
    return DEFAULT;
  }
}

function systemMode(): ResolvedMode {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolve(mode: ThemeMode): ResolvedMode {
  return mode === "auto" ? systemMode() : mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readStored);
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() => resolve(appearance.mode));

  // Apply data-* attributes whenever theme or resolved mode changes.
  // The inline bootstrap in index.html already set the initial
  // values; this useEffect keeps them in sync from here on.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-theme", appearance.theme);
    html.setAttribute("data-mode", resolvedMode);
  }, [appearance.theme, resolvedMode]);

  // Persist + cross-tab sync. We write to localStorage on every
  // change and listen for storage events from other tabs.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {}
  }, [appearance]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue);
        setAppearance({
          theme: next.theme === "clean" ? "clean" : "terminal",
          mode: next.mode === "dark" || next.mode === "light" ? next.mode : "auto",
        });
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Live OS-mode tracking when mode = auto. Listening to the
  // matchMedia change event re-resolves the effective mode whenever
  // the user flips their OS theme; we only react when mode is auto
  // so explicit dark/light selections aren't overridden.
  useEffect(() => {
    if (appearance.mode !== "auto") {
      setResolvedMode(appearance.mode);
      return;
    }
    setResolvedMode(systemMode());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedMode(systemMode());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance.mode]);

  const setTheme = useCallback((theme: ThemeName) => {
    setAppearance((prev) => ({ ...prev, theme }));
  }, []);
  const setMode = useCallback((mode: ThemeMode) => {
    setAppearance((prev) => ({ ...prev, mode }));
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({ theme: appearance.theme, mode: appearance.mode, resolvedMode, setTheme, setMode }),
    [appearance.theme, appearance.mode, resolvedMode, setTheme, setMode],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback for components rendered outside the provider — not
    // expected in the running app but safe in isolated test contexts.
    return {
      theme: "terminal",
      mode: "auto",
      resolvedMode: "dark",
      setTheme: () => {},
      setMode: () => {},
    };
  }
  return ctx;
}
