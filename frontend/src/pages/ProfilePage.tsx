import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/useAuth';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';
import { useProfile, type Profile } from '../hooks/useProfile';

// PR2a (session-calendar-view, design.md "Decision: SettingsPage split"):
// extraído de SettingsPage.tsx -- esta página cubre solo identidad de cuenta
// (nombre, email, contraseña). MFA, historial de seguridad y el panel de
// Google Calendar viven en SecurityPage (account-settings Req: Profile
// Section Scope).
//
// AccountDataForm solo se monta cuando `profile` ya llegó (ver
// ProfilePage abajo) -- así el estado local (nameInput/accountEmail/etc.)
// se inicializa una sola vez con datos reales via lazy initializer, sin
// useEffect+setState sincrónico (evita cascading renders, regla
// react-hooks/set-state-in-effect).
function AccountDataForm({ profile }: { profile: Profile | undefined }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Issue #76 (PR B, follow-up): nombre y email quedan "confirmados" (lo que
  // hay en la DB); pendingEmail refleja un cambio de email diferido en curso
  // (ver EmailChangeService/ConfirmEmailChangePage). Si `profile` llegó en
  // error (isLoading ya en false, data undefined), se arranca igual con
  // campos vacíos -- mismo comportamiento que el fetch original.
  const [accountName, setAccountName] = useState(profile?.name ?? '');
  const [accountEmail] = useState(profile?.email ?? '');
  const [pendingEmail, setPendingEmail] = useState<string | null>(
    profile?.pendingEmail ?? null,
  );
  const [nameInput, setNameInput] = useState(profile?.name ?? '');

  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameMessage, setNameMessage] = useState('');

  const [emailInput, setEmailInput] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Issue #76 (PR B, follow-up): update de solo `name` -- ProfileService no
  // exige currentPassword para este caso, así que nunca se manda bundleado
  // con email/password (esos van en su propio PATCH, cada uno con su propia
  // currentPassword).
  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameSaving(true);
    setNameError('');
    setNameMessage('');
    try {
      const res = await api.patch('/profile', { name: nameInput });
      setAccountName(res.data.name);
      setNameMessage('Nombre actualizado correctamente.');
    } catch (err) {
      setNameError(getApiErrorMessage(err, 'No se pudo actualizar el nombre.'));
    } finally {
      setNameSaving(false);
    }
  };

  // El cambio de email queda diferido en el backend (pendingEmail) hasta que
  // se confirme desde la casilla nueva -- la respuesta ya trae el
  // pendingEmail recién seteado, sin necesidad de un GET adicional.
  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailSaving(true);
    setEmailError('');
    try {
      const res = await api.patch('/profile', {
        email: emailInput,
        currentPassword: emailCurrentPassword,
      });
      setPendingEmail(res.data.pendingEmail ?? emailInput);
      setEmailInput('');
      setEmailCurrentPassword('');
    } catch (err) {
      setEmailError(
        getApiErrorMessage(err, 'No se pudo solicitar el cambio de email.'),
      );
    } finally {
      setEmailSaving(false);
    }
  };

  // Issue #76 (PR B): un cambio de password exitoso NO entrega un token de
  // reemplazo -- el token actual queda inválido en el próximo request
  // (JwtStrategy.validate compara contra passwordChangedAt). Hay que cerrar
  // sesión y redirigir de inmediato, antes de que cualquier otra llamada
  // caiga en el interceptor 401 genérico de api/client.ts (que redirige sin
  // mensaje).
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordError('');
    try {
      await api.patch('/profile', {
        password: newPassword,
        currentPassword: passwordCurrentPassword,
      });
      logout();
      navigate('/login', {
        state: {
          message:
            'Tu contraseña fue actualizada. Por tu seguridad, inicia sesión de nuevo.',
        },
      });
    } catch (err) {
      setPasswordError(
        getApiErrorMessage(err, 'No se pudo actualizar la contraseña.'),
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Nombre */}
      <form onSubmit={handleUpdateName} className="space-y-3">
        <input
          type="text"
          aria-label="Nombre"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          className="input-field"
        />
        {nameMessage && <ErrorBanner message={nameMessage} variant="success" />}
        {nameError && <ErrorBanner message={nameError} />}
        <button
          type="submit"
          disabled={nameSaving || !nameInput.trim() || nameInput === accountName}
          className="btn-primary disabled:opacity-50"
        >
          {nameSaving ? 'Guardando...' : 'Guardar nombre'}
        </button>
      </form>

      {/* Email */}
      <div className="border-t border-slate-100 pt-6 space-y-3">
        <p className="text-sm font-medium text-slate-700">Email</p>
        <p className="text-sm text-slate-600">{accountEmail}</p>
        {pendingEmail && (
          <ErrorBanner
            variant="success"
            message={`Tienes un cambio de email pendiente a ${pendingEmail} — revisa esa casilla para confirmarlo.`}
          />
        )}
        <form onSubmit={handleUpdateEmail} className="space-y-3">
          <input
            type="email"
            aria-label="Nuevo email"
            placeholder="nuevo@email.com"
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            className="input-field"
          />
          <input
            type="password"
            aria-label="Contraseña actual para cambiar email"
            placeholder="Contraseña actual"
            value={emailCurrentPassword}
            onChange={e => setEmailCurrentPassword(e.target.value)}
            className="input-field"
          />
          {emailError && <ErrorBanner message={emailError} />}
          <button
            type="submit"
            disabled={emailSaving || !emailInput || !emailCurrentPassword}
            className="btn-primary disabled:opacity-50"
          >
            {emailSaving ? 'Enviando...' : 'Cambiar email'}
          </button>
        </form>
      </div>

      {/* Contraseña */}
      <div className="border-t border-slate-100 pt-6 space-y-3">
        <p className="text-sm font-medium text-slate-700">Contraseña</p>
        <form onSubmit={handleUpdatePassword} className="space-y-3">
          <input
            type="password"
            aria-label="Nueva contraseña"
            placeholder="Nueva contraseña"
            minLength={8}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="input-field"
          />
          <input
            type="password"
            aria-label="Contraseña actual para cambiar contraseña"
            placeholder="Contraseña actual"
            value={passwordCurrentPassword}
            onChange={e => setPasswordCurrentPassword(e.target.value)}
            className="input-field"
          />
          {passwordError && <ErrorBanner message={passwordError} />}
          <button
            type="submit"
            disabled={
              passwordSaving || newPassword.length < 8 || !passwordCurrentPassword
            }
            className="btn-primary disabled:opacity-50"
          >
            {passwordSaving ? 'Actualizando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { data: profile, isLoading: checkingStatus } = useProfile();

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="font-display text-3xl text-slate-900">Perfil</h2>
        <p className="text-slate-500 text-sm mt-1">
          Actualiza tu nombre, tu email o tu contraseña
        </p>
      </div>

      <div className="card max-w-lg mb-6">
        <div className="mb-6">
          <h3 className="font-medium text-slate-800">Datos de la cuenta</h3>
          <p className="text-xs text-slate-500">
            Actualiza tu nombre, tu email o tu contraseña
          </p>
        </div>

        {checkingStatus ? (
          <p className="text-sm text-slate-500">Cargando datos de la cuenta...</p>
        ) : (
          <AccountDataForm profile={profile} />
        )}
      </div>
    </div>
  );
}
