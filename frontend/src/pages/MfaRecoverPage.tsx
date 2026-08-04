import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';

const mfaRecoverSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es obligatoria'),
  recoveryCode: z.string().min(1, 'El código de recuperación es obligatorio'),
});

type MfaRecoverForm = z.infer<typeof mfaRecoverSchema>;

// Issue #50: círculo cerrado de mfa/disable (exige un TOTP válido del mismo
// secreto) resuelto acá -- exige password además del código de recuperación
// a propósito, mismo nivel de defensa en profundidad que login. Sin
// JwtAuthGuard: el usuario todavía no tiene sesión (justo lo que este flujo
// existe para resolver).
export default function MfaRecoverPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<MfaRecoverForm>({
    resolver: zodResolver(mfaRecoverSchema),
  });

  const onSubmit = async (data: MfaRecoverForm) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/mfa/recover', data);
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo desactivar MFA con ese código.'));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
          <h2 className="font-display text-2xl text-slate-900 mb-2">MFA desactivado</h2>
          <p className="text-slate-500 text-sm mb-6">
            Ya puedes iniciar sesión con tu email y contraseña. Vas a tener que volver a
            configurar MFA en el próximo inicio de sesión.
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
          <h2 className="font-display text-3xl text-slate-900">Recuperar acceso</h2>
          <p className="text-slate-500 text-sm mt-2">
            Si perdiste el dispositivo con tu app autenticadora, usa uno de tus 10
            códigos de recuperación para desactivar MFA.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label htmlFor="mfa-recover-email" className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              {...register('email')}
              id="mfa-recover-email"
              type="email"
              placeholder="tu@email.com"
              className="input-field"
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="mfa-recover-password" className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <input
              {...register('password')}
              id="mfa-recover-password"
              type="password"
              placeholder="••••••••"
              className="input-field"
            />
            {errors.password && (
              <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="mfa-recover-recoveryCode" className="block text-sm font-medium text-slate-700 mb-1">
              Código de recuperación
            </label>
            <input
              {...register('recoveryCode')}
              id="mfa-recover-recoveryCode"
              type="text"
              placeholder="a1b2-c3d4-e5f6-a7b8-c9d0"
              className="input-field font-mono"
            />
            {errors.recoveryCode && (
              <p className="text-red-500 text-xs mt-1">{errors.recoveryCode.message}</p>
            )}
          </div>

          {error && <ErrorBanner message={error} />}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Desactivar MFA'}
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
