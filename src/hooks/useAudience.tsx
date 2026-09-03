// useAudience — controls how much of the product a given user sees.
//
// This is a presentation preference: it hides or reveals registered navigation
// and controls, and Personal selects a focused home shell. It never changes
// capabilities, registered routes, or authorization.
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
// Storage: the authenticated user's server-side preferences are the source of
// truth. `apteva.audience` is read only to migrate the former device-local
// setting for legacy accounts, then removed after the first successful save.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { auth, type InterfaceLevel } from "../api";
import { useAuth } from "./useAuth";

export type Audience = InterfaceLevel;

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
  // Sidebar entries. Personal uses the same Layout shell but replaces the
  // operational links with its agent list. Routes stay registered, and the
  // platform gateway keeps advanced work reachable through Conversations.
  "nav.dashboard": "business",
  "nav.build": "business",
  "nav.agents": "business",
  "nav.appPages": "business",
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
  saving: boolean;
  setAudience: (next: Audience) => Promise<void>;
  /** True when the current audience is allowed to see `section`. */
  shows: (section: AudienceSection) => boolean;
}

const Ctx = createContext<AudienceCtx | null>(null);

function isAudience(value: unknown): value is Audience {
  return value === "personal" || value === "business" || value === "developer";
}

function readLegacyStored(): Audience | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isAudience(raw) ? raw : null;
  } catch {
    return null;
  }
}

function clearLegacyStored() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** Pure form of `shows`, so tests and non-React callers can use it. */
export function audienceShows(audience: Audience, section: AudienceSection): boolean {
  return RANK[audience] >= RANK[AUDIENCE_SECTIONS[section]];
}

export function AudienceProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const [audience, setAudienceState] = useState<Audience>(() => readLegacyStored() ?? DEFAULT);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const migrationAttempted = useRef<number | null>(null);
  const serverAudience =
    user && isAudience(user.interfaceLevel) ? user.interfaceLevel : null;
  const effectiveAudience = pending ? audience : serverAudience ?? audience;

  // A valid server value always wins. Legacy accounts return null so the first
  // browser they use can import the old local value; absent one, developer
  // preserves the interface they saw before levels were introduced.
  useEffect(() => {
    if (!user) return;
    if (serverAudience) {
      setAudienceState(serverAudience);
      clearLegacyStored();
      return;
    }
    if (migrationAttempted.current === user.id) return;
    migrationAttempted.current = user.id;
    const migrated = readLegacyStored() ?? DEFAULT;
    setAudienceState(migrated);
    setPending(true);
    void auth
      .updatePreferences({ interface_level: migrated })
      .then(async () => {
        clearLegacyStored();
        await refresh();
      })
      .catch(() => {})
      .finally(() => setPending(false));
  }, [user, serverAudience, refresh]);

  const setAudience = useCallback(async (next: Audience) => {
    if (!user) throw new Error("Sign in to save interface preferences");
    const previous = effectiveAudience;
    setAudienceState(next);
    setPending(true);
    setSaving(true);
    try {
      await auth.updatePreferences({ interface_level: next });
      clearLegacyStored();
      await refresh();
    } catch (error) {
      setAudienceState(previous);
      throw error;
    } finally {
      setPending(false);
      setSaving(false);
    }
  }, [effectiveAudience, refresh, user]);
  const shows = useCallback(
    (section: AudienceSection) => audienceShows(effectiveAudience, section),
    [effectiveAudience],
  );

  const value = useMemo<AudienceCtx>(
    () => ({ audience: effectiveAudience, saving, setAudience, shows }),
    [effectiveAudience, saving, setAudience, shows],
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
      saving: false,
      setAudience: async () => {},
      shows: (section) => audienceShows(DEFAULT, section),
    };
  }
  return ctx;
}
