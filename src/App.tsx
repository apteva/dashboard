import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { ProjectProvider } from "./hooks/useProjects";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Instances } from "./pages/Instances";
import { Instance } from "./pages/Instance";
import { Integrations } from "./pages/Integrations";
import { Analytics } from "./pages/Analytics";
import { Settings } from "./pages/Settings";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  if (authenticated === null) return null; // loading
  if (!authenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
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
    </BrowserRouter>
  );
}
