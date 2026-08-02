import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
});

type LoginForm = z.infer<typeof loginSchema>;

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (typeof message === 'string' && message.trim()) {
      return message;
    }

    if (!error.response) {
      return 'No se pudo conectar con el servidor. Intenta nuevamente.';
    }
  }

  return fallback;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [userId, setUserId] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [setupQrCode, setSetupQrCode] = useState('');
  const [setupMfaCode, setSetupMfaCode] = useState('');
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [passwordChangeToken, setPasswordChangeToken] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  // Compartido entre login() y password/change: ambos pueden devolver
  // requiresMfa, requiresMfaSetup o accessToken (ver AuthService.completeLogin
  // en el backend) — es la misma decisión post-credenciales en los dos casos.
  const handleLoginResult = (data: {
    requiresMfa?: boolean;
    userId?: string;
    requiresMfaSetup?: boolean;
    setupToken?: string;
    accessToken?: string;
    user?: { id: string; email: string; role: string; name: string };
  }) => {
    if (data.requiresMfa) {
      setMfaRequired(true);
      setUserId(data.userId ?? '');
    } else if (data.requiresMfaSetup) {
      // Rol administrativo sin MFA: el backend no entrega accessToken,
      // solo un setupToken de corta duración. Se arranca el enrolamiento
      // automáticamente para traer el QR y no dejar al usuario con una
      // sesión activa sin MFA.
      setMfaSetupRequired(true);
      setSetupToken(data.setupToken ?? '');
      void beginMfaSetup(data.setupToken ?? '');
    } else if (data.accessToken && data.user) {
      login(data.accessToken, data.user);
      navigate('/dashboard');
    }
  };

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/login', data);
      if (res.data.requiresPasswordChange) {
        // Contraseña semilla conocida (ej. admin@umbral.cl / Umbral2024!):
        // el backend no entrega accessToken ni deja enrolar MFA hasta que
        // se cambie. Ver T4.4 (issue #22).
        setPasswordChangeRequired(true);
        setPasswordChangeToken(res.data.passwordChangeToken);
      } else {
        handleLoginResult(res.data);
      }
    } catch (error) {
      setError(
        getApiErrorMessage(
          error,
          'Credenciales inválidas. Verifica tu email y contraseña.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const onPasswordChangeSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/password/change', {
        passwordChangeToken,
        newPassword,
      });
      handleLoginResult(res.data);
    } catch (error) {
      setError(getApiErrorMessage(error, 'No se pudo cambiar la contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  const onMfaSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/mfa/verify', { userId, token: mfaToken });
      login(res.data.accessToken, res.data.user);
      navigate('/dashboard');
    } catch (error) {
      setError(getApiErrorMessage(error, 'Código MFA inválido. Intenta de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  const beginMfaSetup = async (token: string) => {
    try {
      const res = await api.post('/auth/mfa/setup/begin', { setupToken: token });
      setSetupQrCode(res.data.qrCode);
    } catch (error) {
      setError(getApiErrorMessage(error, 'No se pudo iniciar la configuración de MFA.'));
    }
  };

  const onMfaSetupSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/mfa/setup/confirm', {
        setupToken,
        token: setupMfaCode,
      });
      login(res.data.accessToken, res.data.user);
      navigate('/dashboard');
    } catch (error) {
      setError(getApiErrorMessage(error, 'Código MFA inválido. Intenta de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  if (passwordChangeRequired) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
          <h2 className="font-display text-3xl text-slate-900 mb-2">Cambio de contraseña requerido</h2>
          <p className="text-slate-500 text-sm mb-6">
            Esta cuenta todavía usa la contraseña inicial. Elegí una nueva contraseña para continuar.
          </p>
          <input
            type="password"
            placeholder="Nueva contraseña"
            minLength={8}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="input-field mb-4"
          />
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
          <button
            onClick={onPasswordChangeSubmit}
            disabled={loading || newPassword.length < 8}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Cambiando...' : 'Cambiar contraseña y continuar'}
          </button>
        </div>
      </div>
    );
  }

  if (mfaSetupRequired) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
          <h2 className="font-display text-3xl text-slate-900 mb-2">Activación de MFA requerida</h2>
          <p className="text-slate-500 text-sm mb-6">
            Como ADMIN/SUPERVISOR, necesitás activar MFA para continuar. Escaneá este código con tu
            app autenticadora.
          </p>
          {setupQrCode && (
            <div className="flex justify-center mb-4">
              <img src={setupQrCode} alt="Código QR para configurar MFA" />
            </div>
          )}
          <input
            type="text"
            maxLength={6}
            placeholder="000000"
            value={setupMfaCode}
            onChange={e => setSetupMfaCode(e.target.value)}
            className="input-field text-center text-2xl tracking-widest mb-4"
          />
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
          <button
            onClick={onMfaSetupSubmit}
            disabled={loading || setupMfaCode.length !== 6 || !setupQrCode}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Activar y continuar'}
          </button>
        </div>
      </div>
    );
  }

  if (mfaRequired) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
        <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md">
          <h2 className="font-display text-3xl text-slate-900 mb-2">Verificación MFA</h2>
          <p className="text-slate-500 text-sm mb-6">
            Ingresa el código de 6 dígitos de tu app autenticadora
          </p>
          <input
            type="text"
            maxLength={6}
            placeholder="000000"
            value={mfaToken}
            onChange={e => setMfaToken(e.target.value)}
            className="input-field text-center text-2xl tracking-widest mb-4"
          />
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
          <button
            onClick={onMfaSubmit}
            disabled={loading || mfaToken.length !== 6}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Verificar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1a2e1a 50%, #0f2318 100%)' }}>
        <div>
          <h1 className="font-display text-4xl text-white">Umbral</h1>
          <p className="text-sage-300 text-sm mt-1">SpA — Gestión Clínica</p>
        </div>
        <div>
          <blockquote className="font-display text-2xl text-white leading-relaxed italic">
            "El cuidado del paciente comienza con el cuidado del registro."
          </blockquote>
          <p className="text-slate-400 text-sm mt-4">
            Sistema de gestión clínica conforme a Ley 20.584
          </p>
        </div>
        <div className="text-slate-500 text-xs">
          © 2026 Umbral SpA — Datos protegidos bajo Ley 19.628
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-cream-50">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <h2 className="font-display text-3xl text-slate-900">Bienvenida</h2>
            <p className="text-slate-500 text-sm mt-2">
              Ingresa tus credenciales para acceder al sistema
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                {...register('email')}
                type="email"
                placeholder="tu@email.com"
                className="input-field"
              />
              {errors.email && (
                <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
              <input
                {...register('password')}
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
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
