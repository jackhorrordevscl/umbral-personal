import { useState, useCallback, lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/useAuth";
import { useIdleTimeout } from "./hooks/useIdleTimeout";
import IdleWarningModal from "./components/IdleWarningModal";
import Layout from "./components/Layout";

// Issue #43: code-splitting por ruta -- sin esto, las 9 páginas (incluidas
// login/signup/verify, que se ven una sola vez) iban todas en el bundle
// inicial.
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const ConfirmEmailChangePage = lazy(
  () => import("./pages/ConfirmEmailChangePage"),
);
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const MfaRecoverPage = lazy(() => import("./pages/MfaRecoverPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const PatientsPage = lazy(() => import("./pages/PatientsPage"));
const ConsultationsPage = lazy(() => import("./pages/ConsultationsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SharedFilesPage = lazy(() => import("./pages/SharedFilesPage"));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen text-slate-500 text-sm">
      Cargando...
    </div>
  );
}

// Issue #39: sin staleTime, cada montaje de página (p. ej. navegar entre
// pestañas) refetchea aunque el dato siga fresco -- 30s es suficiente para
// evitar llamadas redundantes sin arriesgar mostrar datos viejos por mucho
// tiempo en un sistema clínico.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

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
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          path="/confirm-email-change"
          element={<ConfirmEmailChangePage />}
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/mfa/recover" element={<MfaRecoverPage />} />

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
          <Route path="archivos" element={<SharedFilesPage />} />
        </Route>
      </Routes>
    </Suspense>
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
