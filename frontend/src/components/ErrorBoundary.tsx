import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { reloadPage } from "../utils/reload";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Issue #297: sin boundary, un error de render (o un chunk que no carga)
// dejaba la pantalla en blanco. Sentry.captureException es no-op si el SDK no
// fue inicializado (sin VITE_SENTRY_DSN).
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center min-h-screen gap-4 px-4 text-center"
      >
        <h1 className="font-display text-2xl text-slate-900">Algo salió mal</h1>
        <p className="text-slate-500 text-sm max-w-md">
          Ocurrió un error inesperado al mostrar esta pantalla. Recarga la
          página para continuar; si el problema persiste, intenta nuevamente más
          tarde.
        </p>
        <button onClick={reloadPage} className="btn-primary">
          Recargar
        </button>
      </div>
    );
  }
}
