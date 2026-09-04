import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ShieldCheck, ShieldOff, QrCode, Calendar } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import RecoveryCodesReveal from '../components/RecoveryCodesReveal';
import ErrorBanner from '../components/ui/ErrorBanner';
import { useProfile, type Profile } from '../hooks/useProfile';

interface CalendarConnectionStatus {
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED';
  googleAccountEmail: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface MfaHistoryEntry {
  action: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

// Compliance: TOTP no permite distinguir "dispositivos" reales (cualquier
// app que escanee el mismo secreto es indistinguible para el backend) --
// esto es el rótulo de CUÁNDO y desde dónde se tocó MFA, no un listado de
// dispositivos registrados. Ver ProfileService.getMfaHistory.
const MFA_HISTORY_LABELS: Record<string, string> = {
  MFA_ENABLED: 'MFA activado',
  MFA_DISABLED: 'MFA desactivado',
  MFA_DISABLED_VIA_RECOVERY: 'MFA desactivado con código de recuperación',
  MFA_RECOVERY_CODES_GENERATED: 'Códigos de recuperación generados',
};

// PR2a (session-calendar-view, design.md "Decision: SettingsPage split"):
// extraído de SettingsPage.tsx. MfaCard solo se monta cuando `profile` ya
// llegó (ver SecurityPage abajo) -- así `step` se inicializa una sola vez
// con datos reales via lazy initializer, sin useEffect+setState sincrónico
// (evita cascading renders, regla react-hooks/set-state-in-effect).
function MfaCard({
  profile,
  onMfaChanged,
}: {
  profile: Profile | undefined;
  onMfaChanged: () => void;
}) {
  const { user } = useAuth();

  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // El enrolamiento obligatorio pasa en LoginPage (login() fuerza MFA antes
  // de entregar sesión), así que para cuando se llega acá casi siempre ya
  // está activo -- sin consultar el estado real, esta pantalla arrancaba
  // siempre en 'idle' y nunca mostraba la opción de desactivar. Si
  // `profile` llegó en error (isLoading ya en false, data undefined), se
  // arranca igual en 'idle' -- mismo comportamiento que el fetch original.
  const [step, setStep] = useState<'idle' | 'scan' | 'verify' | 'done'>(
    profile?.mfaEnabled ? 'done' : 'idle',
  );
  // Issue #50: mfa/enable entrega recoveryCodes en la misma respuesta, una
  // única vez -- se muestran antes del estado "MFA activo" normal, no junto
  // a él, para no perderlos entre el resto del contenido de esa pantalla.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const handleGenerateQR = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/mfa/generate');
      setQrCode(res.data.qrCode);
      setSecret(res.data.secret);
      setStep('scan');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Error al generar el código QR'));
    } finally {
      setLoading(false);
    }
  };

  const handleEnableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/mfa/enable', { token });
      setRecoveryCodes(res.data.recoveryCodes ?? null);
      setMessage('MFA activado correctamente. Tu cuenta ahora requiere doble factor.');
      setStep('done');
      onMfaChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Código inválido. Intenta de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/mfa/disable', { token });
      setMessage('MFA desactivado.');
      setStep('idle');
      setToken('');
      onMfaChanged();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Código inválido. Intenta de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-sage-50 p-3 rounded-lg">
          <ShieldCheck size={22} className="text-sage-600" />
        </div>
        <div>
          <h3 className="font-medium text-slate-800">Autenticación de dos factores</h3>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>
      </div>

      {message && <ErrorBanner message={message} variant="success" className="mb-4" />}

      {error && <ErrorBanner message={error} className="mb-4" />}

      {/* Paso 1: Generar QR */}
      {step === 'idle' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Activa el MFA para proteger tu cuenta con Google Authenticator o Authy.
          </p>
          <button onClick={handleGenerateQR} disabled={loading}
            className="btn-primary flex items-center gap-2">
            <QrCode size={16} />
            {loading ? 'Generando...' : 'Generar código QR'}
          </button>
        </div>
      )}

      {/* Paso 2: Escanear QR */}
      {step === 'scan' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Escanea este código QR con tu app autenticadora:
          </p>
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="QR MFA" className="w-48 h-48 rounded-lg border border-slate-200" />
            </div>
          )}
          <p className="text-xs text-slate-500 text-center">
            Clave manual: <span className="font-mono text-slate-600">{secret}</span>
          </p>
          <button onClick={() => setStep('verify')} className="btn-primary w-full">
            Ya escaneé el QR →
          </button>
        </div>
      )}

      {/* Paso 3: Verificar */}
      {step === 'verify' && (
        <form className="space-y-4" onSubmit={handleEnableMfa}>
          <p className="text-sm text-slate-600">
            Ingresa el código de 6 dígitos de tu app para confirmar:
          </p>
          <input
            type="text"
            aria-label="Código de verificación MFA de 6 dígitos"
            maxLength={6}
            placeholder="000000"
            value={token}
            onChange={e => setToken(e.target.value)}
            className="input-field text-center text-2xl tracking-widest"
          />
          <button
            type="submit"
            disabled={loading || token.length !== 6}
            className="btn-primary w-full disabled:opacity-50"
          >
            {loading ? 'Verificando...' : 'Activar MFA'}
          </button>
        </form>
      )}

      {/* Paso 4: MFA activo — desactivar */}
      {step === 'done' && recoveryCodes && (
        <RecoveryCodesReveal
          codes={recoveryCodes}
          continueLabel="Ya guardé mis códigos"
          onContinue={() => setRecoveryCodes(null)}
        />
      )}

      {step === 'done' && !recoveryCodes && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-600">
            <ShieldCheck size={18} />
            <p className="text-sm font-medium">MFA activo</p>
          </div>
          <p className="text-sm text-slate-600">
            Para desactivar el MFA ingresa un código válido de tu app:
          </p>
          <form className="space-y-4" onSubmit={handleDisableMfa}>
            <input
              type="text"
              aria-label="Código de verificación MFA de 6 dígitos para desactivar"
              maxLength={6}
              placeholder="000000"
              value={token}
              onChange={e => setToken(e.target.value)}
              className="input-field text-center text-2xl tracking-widest"
            />
            <button
              type="submit"
              disabled={loading || token.length !== 6}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <ShieldOff size={16} />
              {loading ? 'Desactivando...' : 'Desactivar MFA'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// PR2a (session-calendar-view, design.md "Decision: SettingsPage split"):
// extraído de SettingsPage.tsx -- esta página cubre MFA, historial de
// seguridad y el panel de Google Calendar (account-settings Req: Security
// Section Scope). El nombre/email/password quedaron en ProfilePage.
export default function SecurityPage() {
  const [searchParams] = useSearchParams();

  // Issue #78 (PR 3): estado de la conexión con Google Calendar. Se lee de
  // GET /calendar-integration/status por separado del GET /profile de
  // abajo -- vive en su propio módulo (CalendarIntegrationController), no
  // en ProfileService.
  const [calendarStatus, setCalendarStatus] =
    useState<CalendarConnectionStatus | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  // ?calendar=connected|error llega desde el 302 de
  // CalendarIntegrationController.callback (design.md "The OAuth callback
  // is unauthenticated") -- el banner es puramente de la URL de retorno, no
  // repite lo que ya cuenta calendarStatus. El backend todavía redirige a
  // `/settings` hasta que PR2b actualice CALENDAR_RETURN_PATH; App.tsx
  // mantiene `/settings` -> `/security` (Navigate replace) para ese período
  // de transición.
  const calendarReturn = searchParams.get('calendar');

  // Issue #76 (PR B, follow-up), ahora vía useProfile compartido con
  // ProfilePage: solo se usa mfaEnabled del payload de /profile (a través
  // de MfaCard) para decidir el paso inicial del asistente de MFA.
  const { data: profile, isLoading: checkingStatus } = useProfile();

  const [mfaHistory, setMfaHistory] = useState<MfaHistoryEntry[]>([]);

  const fetchMfaHistory = async () => {
    try {
      const res = await api.get('/profile/mfa-history');
      setMfaHistory(res.data);
    } catch {
      // No bloquea el resto de la pantalla: el historial es informativo,
      // no una condición para poder enrolar/desenrolar MFA.
    }
  };

  useEffect(() => {
    // Closure local al efecto (mismo idioma que el `init`/`fetchCalendarStatus`
    // originales de SettingsPage.tsx): la primera sentencia es un `await`,
    // por lo que ningún setState corre sincrónicamente dentro del efecto.
    const load = async () => {
      await fetchMfaHistory();
    };
    void load();
  }, []);

  useEffect(() => {
    const fetchCalendarStatus = async () => {
      try {
        const res = await api.get('/calendar-integration/status');
        setCalendarStatus(res.data);
      } catch {
        // Informativo: si falla, la tarjeta se queda sin estado y muestra el
        // botón de conectar por default (mismo criterio que fetchMfaHistory).
      }
    };
    void fetchCalendarStatus();
  }, []);

  // POST /authorize (guardado) devuelve { url } como JSON, no un 302 --
  // design.md: "the axios bearer client cannot follow a cross-origin
  // redirect". La navegación real la hace el navegador via window.location,
  // no react-router (Google no es una ruta de la SPA).
  const handleConnectGoogle = async () => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      const res = await api.post('/calendar-integration/authorize');
      window.location.href = res.data.url;
    } catch (err) {
      setCalendarError(
        getApiErrorMessage(err, 'No se pudo iniciar la conexión con Google Calendar.'),
      );
      setCalendarLoading(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      await api.post('/calendar-integration/disconnect');
      setCalendarStatus(prev => ({
        status: 'DISCONNECTED',
        googleAccountEmail: null,
        connectedAt: null,
        lastSyncAt: prev?.lastSyncAt ?? null,
        lastError: null,
      }));
    } catch (err) {
      setCalendarError(
        getApiErrorMessage(err, 'No se pudo desconectar Google Calendar.'),
      );
    } finally {
      setCalendarLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="font-display text-3xl text-slate-900">Seguridad</h2>
        <p className="text-slate-500 text-sm mt-1">
          Configura el doble factor de autenticación (MFA)
        </p>
      </div>

      {checkingStatus ? (
        <div className="card max-w-lg">
          <p className="text-sm text-slate-500">Verificando estado de MFA...</p>
        </div>
      ) : (
        <MfaCard profile={profile} onMfaChanged={() => void fetchMfaHistory()} />
      )}

      {mfaHistory.length > 0 && (
        <div className="card max-w-lg mt-6">
          <h3 className="font-medium text-slate-800 mb-1">Historial de seguridad</h3>
          <p className="text-xs text-slate-500 mb-4">
            Cuándo y desde qué dispositivo se activó o desactivó el MFA de esta cuenta.
          </p>
          <ul className="space-y-3">
            {mfaHistory.map((entry, index) => (
              <li key={index} className="text-xs border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <p className="text-slate-700 font-medium">
                  {MFA_HISTORY_LABELS[entry.action] ?? entry.action}
                </p>
                <p className="text-slate-500 mt-0.5">
                  {new Date(entry.createdAt).toLocaleString('es-CL')}
                  {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                </p>
                {entry.userAgent && (
                  <p className="text-slate-500 mt-0.5 break-all">{entry.userAgent}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card max-w-lg mt-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-sage-50 p-3 rounded-lg">
            <Calendar size={22} className="text-sage-600" />
          </div>
          <div>
            <h3 className="font-medium text-slate-800">Google Calendar</h3>
            <p className="text-xs text-slate-500">
              Refleja tus sesiones agendadas en tu Google Calendar personal
            </p>
          </div>
        </div>

        {calendarReturn === 'connected' && (
          <ErrorBanner
            variant="success"
            className="mb-4"
            message="Tu cuenta de Google Calendar quedó conectada."
          />
        )}
        {calendarReturn === 'error' && (
          <ErrorBanner
            className="mb-4"
            message="No se pudo conectar tu cuenta de Google Calendar. Intenta nuevamente."
          />
        )}
        {calendarError && <ErrorBanner message={calendarError} className="mb-4" />}

        {calendarStatus?.status === 'CONNECTED' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <ShieldCheck size={18} />
              <p className="text-sm font-medium">Conectado</p>
            </div>
            <button
              type="button"
              onClick={handleDisconnectGoogle}
              disabled={calendarLoading}
              className="btn-secondary disabled:opacity-50"
            >
              {calendarLoading ? 'Desconectando...' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Conecta tu cuenta de Google para ver tus sesiones de Umbral
              directamente en tu Google Calendar.
            </p>
            <button
              type="button"
              onClick={handleConnectGoogle}
              disabled={calendarLoading}
              className="btn-primary disabled:opacity-50"
            >
              {calendarLoading ? 'Conectando...' : 'Conectar con Google Calendar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
