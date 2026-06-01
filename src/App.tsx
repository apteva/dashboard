import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";

// LegacyInstanceRedirect bounces /instances/:id to /agents/:id so any
// pre-rename bookmark, deep-link, or cached tab keeps resolving. The
// hook reads :id off the route params and emits a replace-style nav
// so the browser history shows the canonical URL after the redirect.
function LegacyInstanceRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/agents/${id ?? ""}`} replace />;
}
import { ProjectProvider } from "./hooks/useProjects";
import { ThemeProvider } from "./hooks/useTheme";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Connect } from "./pages/Connect";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Chat } from "./pages/Chat";
import { Agents } from "./pages/Agents";
import { Agent } from "./pages/Agent";
import { AgentNew } from "./pages/AgentNew";
import { Integrations } from "./pages/Integrations";
import { Analytics } from "./pages/Analytics";
import { Settings } from "./pages/Settings";
import { Apps } from "./pages/Apps";
import { Skills } from "./pages/Skills";
import { Environments } from "./pages/Environments";
import { AppProjectPage } from "./pages/AppProjectPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  console.log("[auth] ProtectedRoute render, authenticated=", authenticated, "path=", window.location.pathname);
  if (authenticated === null) {
    console.log("[auth] ProtectedRoute: loading (null)");
    return null;
  }
  if (!authenticated) {
    console.log("[auth] ProtectedRoute: not authenticated → redirect /login");
    return <Navigate to="/login" replace />;
  }
  console.log("[auth] ProtectedRoute: authenticated → render children");
  return <>{children}</>;
}

// OnboardingGate — wraps the main authenticated routes. Once a user
// finishes /auth/register they have onboarded=false; we bounce them to
// /onboarding until the welcome flow stamps onboarded_at server-side.
// Sits inside ProtectedRoute (so unauthenticated still goes to /login)
// but outside it for the /onboarding route itself, so the flow is
// reachable.
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && !user.onboarded) {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/connect/:token" element={<Connect />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <OnboardingGate>
                  <ProjectProvider>
                    <Layout />
                  </ProjectProvider>
                </OnboardingGate>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/new" element={<AgentNew />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat/:chatId" element={<Chat />} />
            <Route path="/agents/:id" element={<Agent />} />
            {/* Phase 3 rename: keep the old /instances URLs working for
                external bookmarks + any old tab the operator left open.
                Phase 4 (next release) drops these redirects. */}
            <Route path="/instances" element={<Navigate to="/agents" replace />} />
            <Route path="/instances/:id" element={<LegacyInstanceRedirect />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/apps" element={<Apps />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/environments" element={<Environments />} />
            {/* Generic per-app project-level page. The project.page
                slot of any installed app's manifest gets rendered here.
                One route serves every app — :name in the URL picks
                which one. */}
            <Route path="/apps/:name/page" element={<AppProjectPage />} />
          </Route>
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
