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
const PaymentReturnPage = lazy(() => import("./pages/PaymentReturnPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const PatientsPage = lazy(() => import("./pages/PatientsPage"));
const ConsultationsPage = lazy(() => import("./pages/ConsultationsPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
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
        {/* Bug fix: destino público al que Flow redirige al PACIENTE tras el
            checkout (PaymentsController.returnFromGateway 302, backend
            PAYMENT_RETURN_PATH) -- nunca debe vivir detrás de PrivateRoute,
            el paciente no está autenticado como terapeuta. */}
        <Route path="/pago-recibido" element={<PaymentReturnPage />} />

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
          {/* PR4 (session-calendar-view, design.md "nav order"): adyacente a
              Consultas -- lee las mismas filas de sesiones. */}
          <Route path="calendar" element={<CalendarPage />} />
          {/* sdd/online-payment-integration PR 3 (design.md "nav order"):
              adyacente a Repositorio, antes de la config de cuenta. */}
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="security" element={<SecurityPage />} />
          {/* PR2a (session-calendar-view): /settings queda como alias --
              cualquier deploy de backend viejo o bookmark que redirija acá
              (p. ej. el 302 de CalendarIntegrationController.callback,
              actualizado recién en PR2b) sigue aterrizando en la pantalla
              correcta. */}
          <Route path="settings" element={<Navigate to="/security" replace />} />
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
