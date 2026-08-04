import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';

const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

// Issue #50: paso 1 del flujo self-service de recuperación de cuenta. El
// backend responde el mismo mensaje genérico exista o no el email (no filtra
// qué cuentas están registradas), así que acá no hay nada que distinguir
// entre "email encontrado" y "email no encontrado" -- un submit exitoso
// siempre lleva a la misma pantalla de "revisa tu email".
export default function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/password/forgot', data);
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo procesar la solicitud.'));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
          <h2 className="font-display text-2xl text-slate-900 mb-2">Revisa tu email</h2>
          <p className="text-slate-500 text-sm mb-6">
            Si el email está registrado, vas a recibir un enlace para restablecer tu
            contraseña. El enlace vence en 30 minutos.
          </p>
          <Link to="/login" className="text-slate-900 font-medium hover:underline text-sm">
            Volver a iniciar sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
        <div className="mb-8">
          <h2 className="font-display text-3xl text-slate-900">¿Olvidaste tu contraseña?</h2>
          <p className="text-slate-500 text-sm mt-2">
            Ingresa tu email y te enviamos un enlace para restablecerla.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label htmlFor="forgot-password-email" className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              {...register('email')}
              id="forgot-password-email"
              type="email"
              placeholder="tu@email.com"
              className="input-field"
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          {error && <ErrorBanner message={error} />}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Enviar enlace de restablecimiento'}
          </button>

          <p className="text-center text-sm text-slate-500">
            <Link to="/login" className="text-slate-900 font-medium hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
