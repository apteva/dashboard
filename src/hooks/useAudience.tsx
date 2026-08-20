// useAudience — controls how much of the product a given user sees.
//
// The third appearance axis, alongside useTheme's theme (identity) and
// mode (palette):
//
//   data-theme    terminal | clean       font, radii, shadows
//   data-mode     dark | light           palette
//   data-audience personal | business | developer   surface density
//
// Orthogonal by design: a personal user can still run terminal-dark.
// Presets suggest a pairing; they never couple the two.
//
// Unlike theme, audience changes what is *mounted*, not just how it's
// painted, so the React context — not the DOM attribute — is the source
// of truth. The attribute is set anyway so CSS can key off it later
// (density, chrome weight) without another provider.
//
// Nesting: the three tiers are strictly nested — everything personal
// sees, business sees; everything business sees, developer sees. So a
// gateable surface is registered with the *minimum* tier that shows it
// rather than a three-column matrix. That keeps the registry small
// (only gated surfaces need a key), makes "show advanced features" a
// single tier bump, and means a new section can only ever be added in
// one consistent direction.
//
// Default is "developer": the dashboard behaves exactly as it did
// before this hook existed until someone opts into a narrower view.
//
// Storage: localStorage under `apteva.audience`, mirroring useTheme's
// device-local persistence and cross-tab sync. The proposal's
// destination is users.preferences so it follows an account across
// devices and can be seeded once from the onboarding preset — that
// needs a server column, so it is deliberately a later step.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { applyAudienceVocabulary } from "../i18n";

export type Audience = "personal" | "business" | "developer";

const RANK: Record<Audience, number> = { personal: 0, business: 1, developer: 2 };

export const AUDIENCES: Audience[] = ["personal", "business", "developer"];

// Every gated surface in the dashboard, mapped to the minimum audience
// that sees it. Surfaces absent from this registry are always visible —
// only things that disappear for someone need a key.
//
// Keys are namespaced by where they live (`nav.*`, `agent.*`) so the
// contract test can assert the registry and the call sites stay in
// sync. Adding a key here without referencing it — or referencing one
// that isn't here — fails that test.
export const AUDIENCE_SECTIONS = {
  // Sidebar entries. Dashboard, Chat, Agents, Build and Settings are
  // unlisted: every audience sees them. Integrations and Apps can hide
  // at personal because the capability stays reachable — the platform
  // MCP gateway gives the Helper create_connection / list_integrations
  // / apps_install / apps_marketplace, so "connect my Gmail" works as
  // a conversation on /build.
  "nav.agentNew": "business",
  "nav.monitor": "business",
  "nav.integrations": "business",
  "nav.apps": "business",
  "nav.usage": "business",
  "nav.skills": "developer",

  // Settings tabs. appearance, channels, data and account are
  // unlisted: every audience sees them.
  "settings.projects": "business",
  "settings.helper": "business",
  "settings.providers": "business",
  "settings.subscriptions": "business",
  "settings.apiKeys": "business",
  "settings.users": "business",
  "settings.mcp": "developer",
  "settings.server": "developer",

  // Agent detail. Details, Directive, Capabilities, Current work,
  // Pause and Delete are unlisted: every audience sees them.
  "agent.provider": "business",
  "agent.realtimeVoice": "business",
  "agent.resetContext": "business",
  "agent.technical": "developer",
  "agent.stepMode": "developer",
  "agent.stepControls": "developer",
  "agent.diagnostics": "developer",
} as const satisfies Record<string, Audience>;

export type AudienceSection = keyof typeof AUDIENCE_SECTIONS;

const STORAGE_KEY = "apteva.audience";
const DEFAULT: Audience = "developer";

interface AudienceCtx {
  audience: Audience;
  setAudience: (next: Audience) => void;
  /** True when the current audience is allowed to see `section`. */
  shows: (section: AudienceSection) => boolean;
}

const Ctx = createContext<AudienceCtx | null>(null);

function isAudience(value: unknown): value is Audience {
  return value === "personal" || value === "business" || value === "developer";
}

function readStored(): Audience {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isAudience(raw) ? raw : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** Pure form of `shows`, so tests and non-React callers can use it. */
export function audienceShows(audience: Audience, section: AudienceSection): boolean {
  return RANK[audience] >= RANK[AUDIENCE_SECTIONS[section]];
}

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [audience, setAudienceState] = useState<Audience>(readStored);

  useEffect(() => {
    document.documentElement.setAttribute("data-audience", audience);
    // Vocabulary is part of the audience: business sees "Connected
    // accounts" where developer sees "Integrations", through the same
    // t() keys. Deterministic rebuild, so flipping back restores base.
    applyAudienceVocabulary(audience);
  }, [audience]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, audience);
    } catch {}
  }, [audience]);

  // Cross-tab sync, same contract as useTheme: an Appearance change in
  // one window updates the others immediately.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      if (isAudience(e.newValue)) setAudienceState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAudience = useCallback((next: Audience) => setAudienceState(next), []);
  const shows = useCallback(
    (section: AudienceSection) => audienceShows(audience, section),
    [audience],
  );

  const value = useMemo<AudienceCtx>(
    () => ({ audience, setAudience, shows }),
    [audience, setAudience, shows],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAudience(): AudienceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback for components rendered outside the provider — not
    // expected in the running app, but safe in isolated test contexts.
    // Defaults to developer so an unwrapped tree shows everything
    // rather than silently hiding surfaces.
    return {
      audience: DEFAULT,
      setAudience: () => {},
      shows: (section) => audienceShows(DEFAULT, section),
    };
  }
  return ctx;
}
