import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Mínimo 8 caracteres'),
});

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

// Issue #50: paso 2 del flujo self-service. El token llega por query param
// `token` (mismo nombre que verify-email, ver AuthService.forgotPassword),
// no `resetToken` -- ese es el nombre del campo que espera el body de
// POST /auth/password/reset, distinto del nombre en la URL.
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get('token');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = async (data: ResetPasswordForm) => {
    if (!resetToken) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/password/reset', {
        resetToken,
        newPassword: data.newPassword,
      });
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo restablecer la contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  if (!resetToken) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
          <h2 className="font-display text-2xl text-slate-900 mb-2">Enlace inválido</h2>
          <ErrorBanner
            message="Este enlace de restablecimiento no es válido. Solicita uno nuevo."
            className="mb-6"
          />
          <Link to="/forgot-password" className="text-slate-900 font-medium hover:underline text-sm">
            Solicitar enlace nuevo
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
          <h2 className="font-display text-2xl text-slate-900 mb-2">Contraseña actualizada</h2>
          <p className="text-slate-500 text-sm mb-6">
            Ya puedes iniciar sesión con tu nueva contraseña.
          </p>
          <Link to="/login" className="text-slate-900 font-medium hover:underline text-sm">
            Ir a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-slate-900">Restablecer contraseña</h2>
          <p className="text-slate-500 text-sm mt-2">
            Elige una nueva contraseña para tu cuenta.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label htmlFor="reset-password-newPassword" className="block text-sm font-medium text-slate-700 mb-1">
              Nueva contraseña
            </label>
            <input
              {...register('newPassword')}
              id="reset-password-newPassword"
              type="password"
              placeholder="••••••••"
              className="input-field"
            />
            {errors.newPassword && (
              <p className="text-red-500 text-xs mt-1">{errors.newPassword.message}</p>
            )}
          </div>

          {error && <ErrorBanner message={error} />}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Actualizando...' : 'Actualizar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}
