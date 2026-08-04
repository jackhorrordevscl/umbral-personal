import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';

// Issue #5: único componente genuinamente nuevo del MVP -- en la versión
// institucional las cuentas las creaba un ADMIN (POST /users, eliminado tras
// el colapso de roles); sin jerarquía, cada profesional se registra solo y
// verifica su email antes de poder loguear (ver AuthService.signup/login).
const signupSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
});

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignupForm) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/signup', data);
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'No se pudo crear la cuenta.'));
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
            Te enviamos un enlace de verificación. Haz clic en él para poder iniciar sesión.
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
          <h2 className="font-display text-3xl text-slate-900">Crear cuenta</h2>
          <p className="text-slate-500 text-sm mt-2">
            Regístrate como profesional dueño de tus propias fichas.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label htmlFor="signup-name" className="block text-sm font-medium text-slate-700 mb-1">Nombre completo</label>
            <input {...register('name')} id="signup-name" type="text" className="input-field" />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="signup-email" className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              {...register('email')}
              id="signup-email"
              type="email"
              placeholder="tu@email.com"
              className="input-field"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="signup-password" className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <input
              {...register('password')}
              id="signup-password"
              type="password"
              placeholder="••••••••"
              className="input-field"
            />
            {errors.password && (
              <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>

          <p className="text-center text-sm text-slate-500">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" className="text-slate-900 font-medium hover:underline">
              Iniciar sesión
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
