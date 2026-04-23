import { useState, useEffect, createContext, useContext, type ReactNode, createElement } from "react";
import { auth, setAuthInvalidHandler } from "../api";

// Auth state lives in a single React Context at the root of the app so
// every consumer — ProtectedRoute, Login, Layout — reads the same
// authenticated flag + user profile. A single shared state cell
// avoids the earlier race where multiple useAuth() call sites each
// owned a local useState and bounced off each other after login.

export interface AuthUser {
  id: number;
  email: string;
  createdAt: string;
}

interface AuthState {
  // null = still probing on mount, false = not logged in, user object = logged in.
  user: AuthUser | null | false;
  // Legacy boolean view retained so existing ProtectedRoute checks keep working.
  authenticated: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, setupToken?: string) => Promise<any>;
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
      setUser({ id: r.user_id, email: r.email, createdAt: r.created_at });
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
      await auth.login(email, password);
      // Pull the full profile so we have `created_at` too; the login
      // response only carries id+email.
      await loadMe();
    },
    register: (email, password, setupToken) => auth.register(email, password, setupToken),
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
