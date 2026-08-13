import {
  useState,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
  createElement,
} from "react";
import { auth, setAuthInvalidHandler, type PlatformRole } from "../api";
import {
  normalizeDashboardLanguage,
  setDashboardLanguage,
  type DashboardLanguage,
} from "../i18n";

// Auth state lives in a single React Context at the root of the app so
// every consumer — ProtectedRoute, Login, Layout — reads the same
// authenticated flag + user profile. A single shared state cell
// avoids the earlier race where multiple useAuth() call sites each
// owned a local useState and bounced off each other after login.

export interface AuthUser {
  id: number;
  email: string;
  // Platform role: 'user' (default) or 'admin'. Admins see the
  // /admin/users page and are implicit owners on every project.
  role: PlatformRole;
  createdAt: string;
  // false for users who registered but haven't finished the welcome
  // flow. Drives <OnboardingGate> in App.tsx.
  onboarded: boolean;
  language: DashboardLanguage;
  uiLayout: Record<string, unknown>;
  uiLayoutRevision: number;
  mfaEnabled: boolean;
  mfaType: string;
  mfaRecoveryCodesRemaining: number;
}

interface AuthState {
  // null = still probing on mount, false = not logged in, user object = logged in.
  user: AuthUser | null | false;
  // Legacy boolean view retained so existing ProtectedRoute checks keep working.
  authenticated: boolean | null;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  verifyMFA: (code: string) => Promise<{
    usedRecoveryCode: boolean;
    recoveryCodesRemaining: number;
  }>;
  register: (
    email: string,
    password: string,
    setupToken?: string,
    inviteToken?: string,
  ) => Promise<any>;
  logout: () => void;
  // Refresh the user profile after a settings change (email edit, etc.).
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // null → probing, false → unauthenticated, AuthUser → authenticated.
  const [user, setUser] = useState<AuthUser | null | false>(null);

  const loadMe = async () => {
    try {
      const r = await auth.me();
      setUser({
        id: r.user_id,
        email: r.email,
        role: (r.role as PlatformRole) || "user",
        createdAt: r.created_at,
        onboarded: r.onboarded,
        language: normalizeDashboardLanguage(r.language),
        uiLayout:
          r.ui_layout && typeof r.ui_layout === "object" ? r.ui_layout : {},
        uiLayoutRevision: Number(r.ui_layout_revision || 0),
        mfaEnabled: Boolean(r.mfa_enabled),
        mfaType: r.mfa_type || "",
        mfaRecoveryCodesRemaining: Number(r.mfa_recovery_codes_remaining || 0),
      });
      void setDashboardLanguage(r.language);
    } catch {
      setUser(false);
    }
  };

  useEffect(() => {
    loadMe();
  }, []);

  // Register a 401 handler for api.ts. Any authenticated API call that
  // comes back 401 flips state to logged-out here, which in turn causes
  // ProtectedRoute to render <Navigate to="/login"> via React Router —
  // no page reload, no feedback loops.
  useEffect(() => {
    setAuthInvalidHandler(() => {
      setUser(false);
    });
    return () => setAuthInvalidHandler(null);
  }, []);

  const value: AuthState = {
    user,
    authenticated: user === null ? null : user !== false,
    login: async (email, password) => {
      const result = await auth.login(email, password);
      if (result.mfa_required) return { mfaRequired: true };
      // Pull the full profile so we have `created_at` too; the login
      // response only carries id+email.
      await loadMe();
      return { mfaRequired: false };
    },
    verifyMFA: async (code) => {
      const result = await auth.verifyMFA(code);
      await loadMe();
      return {
        usedRecoveryCode: result.used_recovery_code,
        recoveryCodesRemaining: result.recovery_codes_remaining,
      };
    },
    register: (email, password, setupToken, inviteToken) =>
      auth.register(email, password, setupToken, inviteToken),
    logout: () => {
      auth.logout();
      setUser(false);
    },
    refresh: loadMe,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// Generic app contributions are also rendered in isolated previews and tests.
// They may read layout preferences when an authenticated shell is present, but
// should still render their suggested defaults without one.
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}
