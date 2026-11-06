import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';
import PasswordInput from '../components/ui/PasswordInput';

// Issue #627: verificar el correo y elegir la contraseña son un solo paso. El
// registro no pide contraseña, así que quien registra un correo ajeno nunca
// conoce una credencial de la cuenta.
const verifySchema = z
  .object({
    password: z.string().min(8, 'Mínimo 8 caracteres').max(128, 'Máximo 128 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

type VerifyForm = z.infer<typeof verifySchema>;

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<VerifyForm>({
    resolver: zodResolver(verifySchema),
  });

  const onSubmit = async (data: VerifyForm) => {
    setLoading(true);
    setError('');
    try {
      // La confirmación es solo de UI: no forma parte del DTO del backend.
      await api.post('/auth/verify-email', { token, password: data.password });
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo verificar el email.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
        {!token && (
          <div className="text-center">
            <h2 className="font-display text-2xl text-slate-900 mb-2">
              No se pudo verificar
            </h2>
            <ErrorBanner
              message="Enlace de verificación inválido: falta el token."
              className="mb-6"
            />
          </div>
        )}

        {token && done && (
          <div className="text-center">
            <h2 className="font-display text-2xl text-slate-900 mb-2">Email verificado</h2>
            <p className="text-slate-500 text-sm mb-6">Ya puedes iniciar sesión.</p>
          </div>
        )}

        {token && !done && (
          <>
            <div className="mb-8">
              <h2 className="font-display text-3xl text-slate-900">Elige tu contraseña</h2>
              <p className="text-slate-500 text-sm mt-2">
                Al guardarla, tu email queda verificado y tu cuenta activa.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label htmlFor="verify-password" className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
                <PasswordInput
                  {...register('password')}
                  id="verify-password"
                  placeholder="••••••••"
                  className="input-field"
                />
                {errors.password && (
                  <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="verify-confirm-password" className="block text-sm font-medium text-slate-700 mb-1">Confirmar contraseña</label>
                <PasswordInput
                  {...register('confirmPassword')}
                  id="verify-confirm-password"
                  placeholder="••••••••"
                  className="input-field"
                />
                {errors.confirmPassword && (
                  <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>
                )}
              </div>

              {error && <ErrorBanner message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-base disabled:opacity-50"
              >
                {loading ? 'Verificando...' : 'Verificar y activar cuenta'}
              </button>
            </form>
          </>
        )}

        <p className="text-center mt-6">
          <Link to="/login" className="text-slate-900 font-medium hover:underline text-sm">
            Ir a iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
