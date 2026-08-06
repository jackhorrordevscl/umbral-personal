import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, QrCode } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import api from '../api/client';
import { getApiErrorMessage } from '../utils/api-error';
import RecoveryCodesReveal from '../components/RecoveryCodesReveal';
import ErrorBanner from '../components/ui/ErrorBanner';

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

export default function SettingsPage() {
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
  // siempre en 'idle' y nunca mostraba la opción de desactivar.
  const [step, setStep] = useState<'idle' | 'scan' | 'verify' | 'done'>('idle');
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [mfaHistory, setMfaHistory] = useState<MfaHistoryEntry[]>([]);
  // Issue #50: mfa/enable entrega recoveryCodes en la misma respuesta, una
  // única vez -- se muestran antes del estado "MFA activo" normal, no junto
  // a él, para no perderlos entre el resto del contenido de esa pantalla.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

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
    const init = async () => {
      try {
        const res = await api.get('/profile');
        setStep(res.data.mfaEnabled ? 'done' : 'idle');
      } catch {
        // Sin estado confirmado, se mantiene el 'idle' por default -- el
        // backend igual rechaza generar un secreto nuevo si MFA ya está
        // activo (ver generateMfaSecret en AuthService).
      } finally {
        setCheckingStatus(false);
      }
      await fetchMfaHistory();
    };
    void init();
  }, []);

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
      void fetchMfaHistory();
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
      void fetchMfaHistory();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Código inválido. Intenta de nuevo.'));
    } finally {
      setLoading(false);
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

        {checkingStatus ? (
          <p className="text-sm text-slate-500">Verificando estado de MFA...</p>
        ) : (
          <>
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
          </>
        )}
      </div>

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
                  <p className="text-slate-400 mt-0.5 break-all">{entry.userAgent}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
