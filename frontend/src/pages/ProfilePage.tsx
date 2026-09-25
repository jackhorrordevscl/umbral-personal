import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Copy, Check, CalendarDays } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';
import {
  useProfile,
  useUpdateProfile,
  useUploadAvatar,
  useDeleteAvatar,
  type Profile,
} from '../hooks/useProfile';
import WeeklyScheduleEditor from '../components/availability/WeeklyScheduleEditor';
import BlockoutEditor from '../components/availability/BlockoutEditor';

// El terapeuta comparte este link con sus pacientes -- antes había que armar
// la URL a mano con el propio id de usuario (un UUID), que no es trivial de
// conseguir para alguien sin acceso a herramientas de dev. Mismo patrón de
// copiar-al-portapapeles que CopyPaymentLinkButton (ConsultationsPage.tsx) e
// InviteCard (SecurityPage.tsx).
function PublicBookingLinkCard({ profile }: { profile: Profile | undefined }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  if (!profile) return null;

  const bookingUrl = `${window.location.origin}/book/${profile.id}`;

  const handleCopy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin acceso al portapapeles: se avisa al usuario; el link sigue
      // visible en pantalla para copiarlo a mano.
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  };

  return (
    <div className="card max-w-lg mb-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-sage-50 p-3 rounded-lg">
          <CalendarDays size={22} className="text-sage-600" />
        </div>
        <div>
          <h3 className="font-medium text-slate-800">Link de auto-agenda</h3>
          <p className="text-xs text-slate-500">
            Compartilo con tus pacientes para que reserven sesiones directamente
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={bookingUrl}
          className="input-field flex-1 text-sm text-slate-600 bg-slate-50"
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="btn-secondary flex items-center gap-1.5 whitespace-nowrap"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copiado' : copyFailed ? 'No se pudo copiar' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

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
  const [accountBio, setAccountBio] = useState(profile?.bio ?? '');
  const [accountSpecialty, setAccountSpecialty] = useState(profile?.specialty ?? '');
  const [accountEmail] = useState(profile?.email ?? '');
  const [pendingEmail, setPendingEmail] = useState<string | null>(
    profile?.pendingEmail ?? null,
  );
  const [nameInput, setNameInput] = useState(profile?.name ?? '');

  // Issue #202: saving/error de cada formulario salen de su propia mutación
  // (isPending/error), no de useState hecho a mano.
  const nameMutation = useUpdateProfile();
  const nameSaving = nameMutation.isPending;
  const nameError = nameMutation.isError
    ? getApiErrorMessage(nameMutation.error, 'No se pudo actualizar el nombre.')
    : '';
  const nameMessage = nameMutation.isSuccess ? 'Nombre actualizado correctamente.' : '';

  // issue #155: bio/specialty se muestran en la autoagenda pública
  // (PublicBookingPage.tsx) -- mismo patrón de estado/guardado que
  // nameInput arriba, pero en su propio form porque no comparten el mismo
  // "guardado" conceptual que el nombre de la cuenta.
  const [bioInput, setBioInput] = useState(profile?.bio ?? '');
  const [specialtyInput, setSpecialtyInput] = useState(profile?.specialty ?? '');
  const profileMutation = useUpdateProfile();
  const profileSaving = profileMutation.isPending;
  const profileError = profileMutation.isError
    ? getApiErrorMessage(profileMutation.error, 'No se pudo actualizar el perfil público.')
    : '';
  const profileMessage = profileMutation.isSuccess
    ? 'Perfil público actualizado correctamente.'
    : '';

  const [emailInput, setEmailInput] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const emailMutation = useUpdateProfile();
  const emailSaving = emailMutation.isPending;
  const emailError = emailMutation.isError
    ? getApiErrorMessage(emailMutation.error, 'No se pudo solicitar el cambio de email.')
    : '';

  const [newPassword, setNewPassword] = useState('');
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState('');
  const passwordMutation = useUpdateProfile();
  const passwordSaving = passwordMutation.isPending;
  const passwordError = passwordMutation.isError
    ? getApiErrorMessage(passwordMutation.error, 'No se pudo actualizar la contraseña.')
    : '';

  // Issue #76 (PR B, follow-up): update de solo `name` -- ProfileService no
  // exige currentPassword para este caso, así que nunca se manda bundleado
  // con email/password (esos van en su propio PATCH, cada uno con su propia
  // currentPassword).
  const handleUpdateName = (e: React.FormEvent) => {
    e.preventDefault();
    nameMutation.mutate(
      { name: nameInput },
      { onSuccess: (data) => setAccountName(data.name ?? '') },
    );
  };

  // Bio/specialty se guardan juntos (mismo endpoint, ambos opcionales) --
  // ProfileService.updateProfile acepta '' para vaciar el campo (comentario
  // en profile.service.ts), así que un textarea/input vacío es un valor
  // válido, no "no cambiar nada".
  const handleUpdatePublicProfile = (e: React.FormEvent) => {
    e.preventDefault();
    profileMutation.mutate(
      { bio: bioInput, specialty: specialtyInput },
      {
        onSuccess: (data) => {
          setAccountBio(data.bio ?? '');
          setAccountSpecialty(data.specialty ?? '');
        },
      },
    );
  };

  // El cambio de email queda diferido en el backend (pendingEmail) hasta que
  // se confirme desde la casilla nueva -- la respuesta ya trae el
  // pendingEmail recién seteado, sin necesidad de un GET adicional.
  const handleUpdateEmail = (e: React.FormEvent) => {
    e.preventDefault();
    emailMutation.mutate(
      { email: emailInput, currentPassword: emailCurrentPassword },
      {
        onSuccess: (data) => {
          setPendingEmail(data.pendingEmail ?? emailInput);
          setEmailInput('');
          setEmailCurrentPassword('');
        },
      },
    );
  };

  // Issue #76 (PR B): un cambio de password exitoso NO entrega un token de
  // reemplazo -- el token actual queda inválido en el próximo request
  // (JwtStrategy.validate compara contra passwordChangedAt). Hay que cerrar
  // sesión y redirigir de inmediato, antes de que cualquier otra llamada
  // caiga en el interceptor 401 genérico de api/client.ts (que redirige sin
  // mensaje).
  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    passwordMutation.mutate(
      { password: newPassword, currentPassword: passwordCurrentPassword },
      {
        onSuccess: () => {
          logout();
          navigate('/login', {
            state: {
              message:
                'Tu contraseña fue actualizada. Por tu seguridad, inicia sesión de nuevo.',
            },
          });
        },
      },
    );
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

      {/* Perfil público (issue #155): visible en la autoagenda pública */}
      <div className="border-t border-slate-100 pt-6">
        <p className="text-sm font-medium text-slate-700 mb-3">Perfil público</p>
        <form onSubmit={handleUpdatePublicProfile} className="space-y-3">
          <div>
            <input
              type="text"
              aria-label="Especialidad"
              placeholder="Especialidad (ej. Psicología clínica)"
              maxLength={120}
              value={specialtyInput}
              onChange={(e) => setSpecialtyInput(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <textarea
              aria-label="Bio"
              placeholder="Cuéntales a tus pacientes un poco sobre vos"
              maxLength={500}
              rows={3}
              value={bioInput}
              onChange={(e) => setBioInput(e.target.value)}
              className="input-field resize-none"
            />
            <p className="text-xs text-slate-400 mt-1 text-right">
              {bioInput.length}/500
            </p>
          </div>
          {profileMessage && <ErrorBanner message={profileMessage} variant="success" />}
          {profileError && <ErrorBanner message={profileError} />}
          <button
            type="submit"
            disabled={
              profileSaving ||
              (bioInput === accountBio && specialtyInput === accountSpecialty)
            }
            className="btn-primary disabled:opacity-50"
          >
            {profileSaving ? 'Guardando...' : 'Guardar perfil público'}
          </button>
        </form>
      </div>

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

// El endpoint GET /profile/avatar está autenticado (no es una URL pública
// servible directo en un <img src>) -- mismo patrón que
// SharedFilesPage.handlePreview: pedirlo con axios (responseType: 'blob',
// así el interceptor de api/client.ts le agrega el Bearer token) y armar un
// object URL local. `v` en la query string es solo cache-busting del lado
// del browser (no lo valida el backend, siempre sirve el avatar actual del
// propio usuario) para que una foto nueva no muestre la vieja recién
// re-subida.
function AvatarPreview({ avatarUpdatedAt }: { avatarUpdatedAt: string | null }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!avatarUpdatedAt) return;

    let cancelled = false;
    let urlToRevoke: string | null = null;

    api
      .get(`/profile/avatar?v=${encodeURIComponent(avatarUpdatedAt)}`, {
        responseType: 'blob',
      })
      .then((res) => {
        if (cancelled) return;
        const url = window.URL.createObjectURL(res.data as Blob);
        urlToRevoke = url;
        setObjectUrl(url);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(getApiErrorMessage(e, 'No se pudo cargar la foto de perfil.'));
        }
      });

    return () => {
      cancelled = true;
      if (urlToRevoke) window.URL.revokeObjectURL(urlToRevoke);
    };
  }, [avatarUpdatedAt]);

  if (error) {
    return (
      <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center text-xs text-red-500 text-center px-1">
        Error
      </div>
    );
  }

  // `avatarUpdatedAt` manda sobre `objectUrl`: tras borrar la foto,
  // avatarUpdatedAt pasa a null pero el objectUrl del blob anterior puede
  // seguir en el state (no lo limpiamos synchronously en el efecto, ver
  // react-hooks/set-state-in-effect) -- sin este chequeo se seguiría
  // mostrando la foto borrada.
  if (!avatarUpdatedAt || !objectUrl) {
    return (
      <div className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-medium">
        {/* Sin foto todavía: placeholder simple, sin iniciales (no tenemos
            el nombre acá y no vale la pena otro prop solo para esto). */}
        Sin foto
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt="Foto de perfil"
      width={80}
      height={80}
      className="w-20 h-20 rounded-full object-cover"
    />
  );
}

function AvatarCard({ profile }: { profile: Profile | undefined }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadAvatar();
  const deleteMutation = useDeleteAvatar();
  const uploading = uploadMutation.isPending;
  const deleting = deleteMutation.isPending;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Subir y quitar comparten el mismo banner: se muestra el error de la
  // última acción, y cada acción limpia el de la otra antes de empezar.
  const error = uploadMutation.isError
    ? getApiErrorMessage(uploadMutation.error, 'No se pudo subir la foto de perfil.')
    : deleteMutation.isError
      ? getApiErrorMessage(deleteMutation.error, 'No se pudo quitar la foto de perfil.')
      : '';

  const handleUpload = () => {
    if (!selectedFile) return;
    deleteMutation.reset();
    uploadMutation.mutate(selectedFile, {
      onSuccess: () => {
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  };

  const handleDelete = () => {
    uploadMutation.reset();
    deleteMutation.mutate();
  };

  return (
    <div className="card max-w-lg mb-6">
      <div className="mb-6">
        <h3 className="font-medium text-slate-800">Foto de perfil</h3>
        <p className="text-xs text-slate-500">
          Se muestra en tu cuenta. Formatos aceptados: JPG, PNG, WEBP o GIF (máx. 5MB).
        </p>
      </div>

      <div className="flex items-center gap-4">
        <AvatarPreview avatarUpdatedAt={profile?.avatarUpdatedAt ?? null} />
        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label="Seleccionar foto de perfil"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="text-sm text-slate-600"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !selectedFile}
              className="btn-primary disabled:opacity-50 self-start"
            >
              {uploading ? 'Subiendo...' : 'Subir foto'}
            </button>
            {profile?.avatarUpdatedAt && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="btn-secondary disabled:opacity-50 self-start"
              >
                {deleting ? 'Quitando...' : 'Quitar foto'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} className="mt-4" />}
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

      <AvatarCard profile={profile} />

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

      <PublicBookingLinkCard profile={profile} />

      {/* sdd/patient-self-scheduling PR 4 (tasks.md 4.3, therapist-availability
          spec): editor de horario semanal + bloqueos, autocontenidos (cada
          uno fetchea/muta su propio recurso vía useAvailability.ts) --
          mismo criterio que AvatarCard/AccountDataForm arriba, sin props. */}
      <WeeklyScheduleEditor />
      <BlockoutEditor />
    </div>
  );
}
