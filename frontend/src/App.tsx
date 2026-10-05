import { useEffect, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/useAuth";
import { setUnauthorizedHandler } from "./api/client";
import { toFromPath } from "./utils/redirect";
import IdleManager from "./components/IdleManager";
import Layout from "./components/Layout";
import { lazyWithRetry } from "./utils/lazy-with-retry";

// Issue #43: code-splitting por ruta -- sin esto, las 9 páginas (incluidas
// login/signup/verify, que se ven una sola vez) iban todas en el bundle
// inicial.
const LoginPage = lazyWithRetry(() => import("./pages/LoginPage"));
const SignupPage = lazyWithRetry(() => import("./pages/SignupPage"));
const VerifyEmailPage = lazyWithRetry(() => import("./pages/VerifyEmailPage"));
const ConfirmEmailChangePage = lazyWithRetry(
  () => import("./pages/ConfirmEmailChangePage"),
);
const ForgotPasswordPage = lazyWithRetry(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const MfaRecoverPage = lazyWithRetry(() => import("./pages/MfaRecoverPage"));
const PaymentReturnPage = lazyWithRetry(() => import("./pages/PaymentReturnPage"));
const PublicBookingPage = lazyWithRetry(() => import("./pages/PublicBookingPage"));
const DashboardPage = lazyWithRetry(() => import("./pages/DashboardPage"));
const PatientsPage = lazyWithRetry(() => import("./pages/PatientsPage"));
const ConsultationsPage = lazyWithRetry(() => import("./pages/ConsultationsPage"));
const CalendarPage = lazyWithRetry(() => import("./pages/CalendarPage"));
const PaymentsPage = lazyWithRetry(() => import("./pages/PaymentsPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const SecurityPage = lazyWithRetry(() => import("./pages/SecurityPage"));
const SharedFilesPage = lazyWithRetry(() => import("./pages/SharedFilesPage"));

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
  const { isAuthenticated, canRestoreRoute } = useAuth();
  const location = useLocation();
  // Issue #293: se recuerda el destino para volver a él tras iniciar sesión.
  // Issue #351: no tras un logout voluntario o desde otra pestaña, o la
  // siguiente persona en ese equipo aterrizaría en la ruta del usuario anterior.
  return isAuthenticated ? (
    <>{children}</>
  ) : (
    <Navigate
      to="/login"
      state={canRestoreRoute ? { from: toFromPath(location) } : undefined}
    />
  );
}

// Issue #203: un 401 en una llamada normal cierra la sesión vía AuthContext y
// navega con el router, en vez de recargar la página con window.location.
function SessionExpiredHandler() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = toFromPath(location);

  useEffect(
    () =>
      setUnauthorizedHandler(() => {
        logout({ expired: true });
        navigate("/login", { state: { from } });
      }),
    [logout, navigate, from],
  );

  return null;
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
        {/* sdd/patient-self-scheduling PR 5 (tasks.md 5.2, design.md "File
            Changes" -- nueva página pública): agenda de auto-reserva de un
            paciente sin cuenta, nunca detrás de PrivateRoute -- el visitante
            no está autenticado como terapeuta. */}
        <Route path="/book/:therapistId" element={<PublicBookingPage />} />

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
          <SessionExpiredHandler />
          <IdleManager />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
