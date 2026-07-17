import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
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
import { RealtimeVoiceProvider } from "./state/RealtimeVoiceContext";
import { Login } from "./pages/Login";

// Route modules are intentionally lazy. Settings, analytics,
// and app management contain large graphs/forms that should not delay login
// or the project dashboard for users who never visit those screens.
const Connect = lazy(() => import("./pages/Connect").then((m) => ({ default: m.Connect })));
const Onboarding = lazy(() => import("./pages/Onboarding").then((m) => ({ default: m.Onboarding })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Chat = lazy(() => import("./pages/Chat").then((m) => ({ default: m.Chat })));
const Monitor = lazy(() => import("./pages/Monitor").then((m) => ({ default: m.Monitor })));
const Agents = lazy(() => import("./pages/Agents").then((m) => ({ default: m.Agents })));
const Agent = lazy(() => import("./pages/Agent").then((m) => ({ default: m.Agent })));
const AgentNew = lazy(() => import("./pages/AgentNew").then((m) => ({ default: m.AgentNew })));
const Integrations = lazy(() => import("./pages/Integrations").then((m) => ({ default: m.Integrations })));
const Analytics = lazy(() => import("./pages/Analytics").then((m) => ({ default: m.Analytics })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Apps = lazy(() => import("./pages/Apps").then((m) => ({ default: m.Apps })));
const Skills = lazy(() => import("./pages/Skills").then((m) => ({ default: m.Skills })));
const AppProjectPage = lazy(() => import("./pages/AppProjectPage").then((m) => ({ default: m.AppProjectPage })));

function ProtectedRoute({ children }: { children: ReactNode }) {
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
          <Suspense fallback={<RouteFallback />}>
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
                    <RealtimeVoiceProvider>
                      <Layout />
                    </RealtimeVoiceProvider>
                  </ProjectProvider>
                </OnboardingGate>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            {/* Build used to duplicate the shared ChatPanel in a dedicated
                page. Keep old links working, but open the platform helper
                over the Agents page where its proposals can be acted on. */}
            <Route path="/build" element={<Navigate to="/agents?helper=build" replace />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/activity" element={<Navigate to="/monitor?view=activity" replace />} />
            <Route path="/monitor" element={<Monitor />} />
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
            {/* Generic per-app project-level page. The project.page
                slot of any installed app's manifest gets rendered here.
                One route serves every app — :name in the URL picks
                which one. */}
            <Route path="/apps/:name/page" element={<AppProjectPage />} />
          </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

function RouteFallback() {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-bg text-xs text-text-muted">
      Loading…
    </div>
  );
}
