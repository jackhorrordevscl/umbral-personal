import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';

type Status = 'confirming' | 'success' | 'error';

// Issue #76: confirma un cambio de email pendiente (PATCH /profile con
// email nuevo). Mismo patrón que VerifyEmailPage -- el token de la URL ES
// la autoridad, no requiere sesión (la casilla nueva todavía no tiene un
// accessToken asociado).
export default function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>(() => (token ? 'confirming' : 'error'));
  const [error, setError] = useState(() =>
    token ? '' : 'Enlace de confirmación inválido: falta el token.',
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    api
      .post('/profile/email-change/confirm', { token })
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err, 'No se pudo confirmar el cambio de email.'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
        {status === 'confirming' && (
          <p className="text-slate-500 text-sm">Confirmando tu nuevo email...</p>
        )}

        {status === 'success' && (
          <>
            <h2 className="font-display text-2xl text-slate-900 mb-2">Email actualizado</h2>
            <p className="text-slate-500 text-sm mb-6">
              Tu email fue actualizado. Ya puedes iniciar sesión con la nueva dirección.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="font-display text-2xl text-slate-900 mb-2">
              No se pudo confirmar
            </h2>
            <ErrorBanner message={error} className="mb-6" />
          </>
        )}

        <Link to="/login" className="text-slate-900 font-medium hover:underline text-sm">
          Ir a iniciar sesión
        </Link>
      </div>
    </div>
  );
}
