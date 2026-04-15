import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { auth } from "../api";

// Login renders one of three flows depending on the server's registration mode:
//
//  1. `setup`   — fresh deployment, no users in the DB yet. Server printed a
//                 one-time setup token to its logs. We show a setup-only
//                 screen: the user pastes the token + their first admin
//                 email/password, we register, then auto-login. No way to
//                 reach the regular login form until setup is done.
//
//  2. `open`    — anyone can register. Standard sign-in / sign-up toggle.
//
//  3. `locked`  — only existing users can sign in (default after setup
//                 completes). Hide the "Create an account" toggle entirely.
export function Login() {
  const [mode, setMode] = useState<"loading" | "setup" | "login" | "register">(
    "loading",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { login, register, authenticated } = useAuth();
  const navigate = useNavigate();

  // If the user arrives at /login with a valid session already, bounce
  // them straight to the dashboard. Without this, a user who logs in,
  // closes the tab, then reopens it on /login (bookmarks, back button)
  // sits on the login form forever even though their cookie is still
  // valid — auth.me() succeeds in AuthProvider but the Login page
  // itself never re-checks and stays mounted.
  useEffect(() => {
    if (authenticated === true) {
      console.log("[login] already authenticated on mount → navigate /");
      navigate("/", { replace: true });
    }
  }, [authenticated, navigate]);

  // Detect server state on mount. We only care about distinguishing
  // setup from non-setup — open vs locked just toggles the register button
  // visibility on the normal login screen.
  const [regMode, setRegMode] = useState<string>("locked");
  useEffect(() => {
    auth
      .status()
      .then((s) => {
        setRegMode(s.reg_mode);
        setMode(s.needs_setup ? "setup" : "login");
      })
      .catch(() => {
        // If status fails for any reason, fall back to the regular login
        // screen — better than blocking the whole UI behind a setup wall
        // when the server is reachable but /auth/status hiccups.
        setMode("login");
      });
  }, []);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(email, password, setupToken.trim());
      // Server has now flipped regMode → locked. Auto-login with the
      // credentials the user just typed so they land in the dashboard
      // without a second form submit.
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Setup failed — check the token and try again");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    console.log("[login] handleSubmit mode=", mode);
    try {
      if (mode === "register") {
        await register(email, password);
      }
      await login(email, password);
      console.log("[login] login() resolved, calling navigate('/')");
      navigate("/");
      console.log("[login] navigate('/') called, new url=", window.location.pathname);
    } catch (err: any) {
      console.log("[login] handleSubmit error:", err?.message || err);
      setError(err.message || "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-muted text-sm">Loading…</p>
      </div>
    );
  }

  if (mode === "setup") {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-full max-w-md px-6">
          <div className="text-center mb-10">
            <h1 className="text-text text-3xl font-bold">Apteva</h1>
            <p className="text-text-muted text-base mt-2">First-time setup</p>
          </div>

          <form
            onSubmit={handleSetup}
            className="border border-border rounded-lg p-8 bg-bg-card"
          >
            <p className="text-text-muted text-xs mb-5 leading-relaxed">
              This server has no users yet. Paste the setup token from the
              server logs and create your admin account. The token is
              single-use — once setup completes, this screen disappears
              forever.
            </p>

            <div className="mb-5">
              <label className="block text-text-muted text-sm mb-2">
                Setup token
              </label>
              <input
                type="text"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-sm text-text font-mono focus:outline-none focus:border-accent"
                placeholder="apt_…"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>

            <div className="mb-5">
              <label className="block text-text-muted text-sm mb-2">
                Admin email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="mb-5">
              <label className="block text-text-muted text-sm mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
                placeholder="at least 8 characters"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>

            {error && <div className="text-red text-sm mb-4">{error}</div>}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-accent text-bg font-bold py-3 rounded-lg text-base hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {busy ? "Creating admin…" : "Create admin & sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Normal login / register flow.
  const isRegister = mode === "register";
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-text text-3xl font-bold">Apteva</h1>
          <p className="text-text-muted text-base mt-2">
            Autonomous AI agents
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border border-border rounded-lg p-8 bg-bg-card"
        >
          <div className="mb-5">
            <label className="block text-text-muted text-sm mb-2">
              Username or email
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="username"
              autoComplete="username"
              required
            />
          </div>

          <div className="mb-5">
            <label className="block text-text-muted text-sm mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-bg-input border border-border rounded-lg px-4 py-3 text-base text-text focus:outline-none focus:border-accent"
              placeholder="••••••••"
              required
              minLength={8}
            />
          </div>

          {error && <div className="text-red text-sm mb-4">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-accent text-bg font-bold py-3 rounded-lg text-base hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {busy ? "…" : isRegister ? "Register" : "Sign in"}
          </button>

          {/* Only show the register toggle when the server actually accepts
              public registrations. In `locked` mode the button would lead to
              a guaranteed 403, so we hide it. */}
          {regMode === "open" && (
            <button
              type="button"
              onClick={() => setMode(isRegister ? "login" : "register")}
              className="w-full text-text-muted text-sm mt-4 hover:text-text transition-colors"
            >
              {isRegister ? "Back to sign in" : "Create an account"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
