import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ProjectProvider } from "./hooks/useProjects";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Connect } from "./pages/Connect";
import { Instances } from "./pages/Instances";
import { Instance } from "./pages/Instance";
import { Integrations } from "./pages/Integrations";
import { Analytics } from "./pages/Analytics";
import { Settings } from "./pages/Settings";

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/connect/:token" element={<Connect />} />
          <Route
            element={
              <ProtectedRoute>
                <ProjectProvider>
                  <Layout />
                </ProjectProvider>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Instances />} />
            <Route path="/instances/:id" element={<Instance />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
