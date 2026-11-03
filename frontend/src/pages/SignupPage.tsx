import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../api/client';
import { useSignupConfig } from '../hooks/useSubscription';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';
import PasswordInput from "../components/ui/PasswordInput";

// Issue #5: único componente genuinamente nuevo del MVP -- en la versión
// institucional las cuentas las creaba un ADMIN (POST /users, eliminado tras
// el colapso de roles); sin jerarquía, cada profesional se registra solo y
// verifica su email antes de poder loguear (ver AuthService.signup/login).
const signupSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    email: z.string().email('Email inválido'),
    password: z.string().min(8, 'Mínimo 8 caracteres'),
    confirmPassword: z.string(),
    // Issue #124: con las suscripciones apagadas el registro requiere un
    // código de invitación emitido por el profesional autorizado (ver
    // POST /auth/invitations en SecurityPage). Que sea obligatorio depende de
    // la configuración del backend, así que se valida en onSubmit.
    inviteCode: z.string().optional(),
    // Issue #611: con las suscripciones encendidas el registro es abierto y
    // admite un código promocional opcional (flyer, QR).
    promoCode: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Issue #611: el QR del flyer lleva al registro con el código precargado.
  const [searchParams] = useSearchParams();
  const config = useSignupConfig();
  const openSignup = config.data?.openSignup === true;

  const { register, handleSubmit, setError: setFieldError, formState: { errors } } =
    useForm<SignupForm>({
      resolver: zodResolver(signupSchema),
      defaultValues: { promoCode: searchParams.get('promo') ?? '' },
    });

  const onSubmit = async (data: SignupForm) => {
    const inviteCode = data.inviteCode?.trim();
    const promoCode = data.promoCode?.trim();
    if (!openSignup && !inviteCode) {
      setFieldError('inviteCode', { message: 'El código de invitación es obligatorio' });
      return;
    }

    setLoading(true);
    setError('');
    try {
      // La confirmación es solo de UI: no forma parte del DTO del backend.
      // Se manda solo el código que corresponde al modo del backend; el
      // promocional vacío se omite (el DTO rechaza una cadena vacía).
      await api.post('/auth/signup', {
        name: data.name,
        email: data.email,
        password: data.password,
        ...(openSignup
          ? promoCode
            ? { promoCode }
            : {}
          : { inviteCode }),
      });
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

  // Sin conocer el modo del backend no se sabe qué código pedir: se espera la
  // configuración en vez de mostrar un formulario que podría ser el equivocado.
  if (!config.data) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
          {config.isError ? (
            <ErrorBanner
              icon
              message="No se pudo cargar el formulario de registro."
              onRetry={() => void config.refetch()}
            />
          ) : (
            <p className="text-slate-500 text-sm text-center">Cargando...</p>
          )}
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
            <PasswordInput
              {...register('password')}
              id="signup-password"
              placeholder="••••••••"
              className="input-field"
            />
            {errors.password && (
              <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="signup-confirm-password" className="block text-sm font-medium text-slate-700 mb-1">Confirmar contraseña</label>
            <PasswordInput
              {...register('confirmPassword')}
              id="signup-confirm-password"
              placeholder="••••••••"
              className="input-field"
            />
            {errors.confirmPassword && (
              <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>

          {openSignup ? (
            <div>
              <label htmlFor="signup-promo-code" className="block text-sm font-medium text-slate-700 mb-1">Código promocional (opcional)</label>
              <input
                {...register('promoCode')}
                id="signup-promo-code"
                type="text"
                className="input-field"
              />
              <p className="text-slate-500 text-xs mt-1">
                Si tienes un código, obtienes un mes de prueba.
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="signup-invite-code" className="block text-sm font-medium text-slate-700 mb-1">Código de invitación</label>
              <input
                {...register('inviteCode')}
                id="signup-invite-code"
                type="text"
                className="input-field"
              />
              {errors.inviteCode && (
                <p className="text-red-500 text-xs mt-1">{errors.inviteCode.message}</p>
              )}
            </div>
          )}

          {error && <ErrorBanner message={error} />}

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
