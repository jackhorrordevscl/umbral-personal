import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';

type Status = 'verifying' | 'success' | 'error';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Enlace de verificación inválido: falta el token.');
      return;
    }

    // No hay dependencia real más allá de `token`: este efecto verifica una
    // sola vez por token, no en cada render.
    let cancelled = false;
    api
      .post('/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err, 'No se pudo verificar el email.'));
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
        {status === 'verifying' && (
          <p className="text-slate-500 text-sm">Verificando tu email...</p>
        )}

        {status === 'success' && (
          <>
            <h2 className="font-display text-2xl text-slate-900 mb-2">Email verificado</h2>
            <p className="text-slate-500 text-sm mb-6">Ya podés iniciar sesión.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="font-display text-2xl text-slate-900 mb-2">
              No se pudo verificar
            </h2>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          </>
        )}

        <Link to="/login" className="text-slate-900 font-medium hover:underline text-sm">
          Ir a iniciar sesión
        </Link>
      </div>
    </div>
  );
}
