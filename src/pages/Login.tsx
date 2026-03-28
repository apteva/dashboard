import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (isRegister) {
        await register(email, password);
      }
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-text text-3xl font-bold">Apteva</h1>
          <p className="text-text-muted text-base mt-2">Autonomous AI agents</p>
        </div>

        <form onSubmit={handleSubmit} className="border border-border rounded-lg p-8 bg-bg-card">
          <div className="mb-5">
            <label className="block text-text-muted text-sm mb-2">Username or email</label>
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
            <label className="block text-text-muted text-sm mb-2">Password</label>
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

          {error && (
            <div className="text-red text-sm mb-4">{error}</div>
          )}

          <button
            type="submit"
            className="w-full bg-accent text-bg font-bold py-3 rounded-lg text-base hover:bg-accent-hover transition-colors"
          >
            {isRegister ? "Register" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            className="w-full text-text-muted text-sm mt-4 hover:text-text transition-colors"
          >
            {isRegister ? "Back to sign in" : "Create an account"}
          </button>
        </form>
      </div>
    </div>
  );
}
