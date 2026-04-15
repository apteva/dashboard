import { useState, useEffect, createContext, useContext, type ReactNode, createElement } from "react";
import { auth, setAuthInvalidHandler } from "../api";

// Auth state lives in a single React Context at the root of the app so
// every consumer — ProtectedRoute, Login, Layout — reads the same
// authenticated flag. Before this was lifted, each useAuth() call owned
// a local useState with its own auth.me() useEffect, which meant:
//   1. ProtectedRoute mounts, auth.me() fails, state=false → redirect /login
//   2. Login's separate useAuth() state flips to true after successful login
//   3. navigate("/") re-enters ProtectedRoute, but its deps=[] useEffect
//      never re-runs so its stale state=false kicks back to /login
// Result: login succeeds on the server but the UI bounces back. Context
// eliminates the divergence because there's only one state cell.

interface AuthState {
  authenticated: boolean | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, setupToken?: string) => Promise<any>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    console.log("[auth] AuthProvider mount → calling auth.me()");
    auth.me()
      .then((r) => {
        console.log("[auth] auth.me() ok:", r);
        setAuthenticated(true);
      })
      .catch((err) => {
        console.log("[auth] auth.me() failed:", err?.message || err);
        setAuthenticated(false);
      });
  }, []);

  // Register a 401 handler for api.ts. Any authenticated API call that
  // comes back 401 flips state to false here, which in turn causes
  // ProtectedRoute to render <Navigate to="/login"> via React Router —
  // no page reload, no feedback loops.
  useEffect(() => {
    setAuthInvalidHandler(() => {
      console.log("[auth] onAuthInvalid fired → setting authenticated=false");
      setAuthenticated(false);
    });
    return () => setAuthInvalidHandler(null);
  }, []);

  const value: AuthState = {
    authenticated,
    login: async (email, password) => {
      console.log("[auth] login() start email=", email);
      try {
        const r = await auth.login(email, password);
        console.log("[auth] login() ok:", r);
      } catch (e: any) {
        console.log("[auth] login() threw:", e?.message || e);
        throw e;
      }
      console.log("[auth] login() setting authenticated=true");
      setAuthenticated(true);
    },
    register: (email, password, setupToken) => auth.register(email, password, setupToken),
    logout: () => {
      console.log("[auth] logout()");
      auth.logout();
      setAuthenticated(false);
    },
  };

  console.log("[auth] AuthProvider render, authenticated=", authenticated);
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
