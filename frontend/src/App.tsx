import { useState, useCallback } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useIdleTimeout } from "./hooks/useIdleTimeout";
import IdleWarningModal from "./components/IdleWarningModal";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import PatientsPage from "./pages/PatientsPage";
import ConsultationsPage from "./pages/ConsultationsPage";
import Layout from "./components/Layout";
import SettingsPage from "./pages/SettingsPage";
import UsersPage from "./pages/UsersPage";
import SharedFilesPage from "./pages/SharedFilesPage";

const queryClient = new QueryClient();

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function IdleManager() {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);

  const handleWarn = useCallback(() => {
    if (isAuthenticated) setShowWarning(true);
  }, [isAuthenticated]);

  const handleLogout = useCallback(() => {
    setShowWarning(false);
    logout();
    navigate("/login");
  }, [logout, navigate]);

  const { extend } = useIdleTimeout({
    onWarn: handleWarn,
  });

  const handleExtend = useCallback(() => {
    if (!isAuthenticated) return;
    setShowWarning(false);
    extend();
  }, [extend, isAuthenticated]);

  if (!isAuthenticated) return null;

  return showWarning ? (
    <IdleWarningModal onExtend={handleExtend} onLogout={handleLogout} />
  ) : null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="consultations" element={<ConsultationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="archivos" element={<SharedFilesPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <IdleManager />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
