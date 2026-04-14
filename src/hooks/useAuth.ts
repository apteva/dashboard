import { useState, useEffect } from "react";
import { auth } from "../api";

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    auth.me()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
  }, []);

  return {
    authenticated,
    login: async (email: string, password: string) => {
      await auth.login(email, password);
      setAuthenticated(true);
    },
    register: (email: string, password: string, setupToken?: string) =>
      auth.register(email, password, setupToken),
    logout: () => {
      auth.logout();
      setAuthenticated(false);
    },
  };
}
