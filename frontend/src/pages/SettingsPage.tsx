import { useState } from 'react';
import { ShieldCheck, ShieldOff, QrCode } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function SettingsPage() {
  const { user } = useAuth();
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'idle' | 'scan' | 'verify' | 'done'>('idle');

  const handleGenerateQR = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/mfa/generate');
      setQrCode(res.data.qrCode);
      setSecret(res.data.secret);
      setStep('scan');
    } catch {
      setError('Error al generar el código QR');
    } finally {
      setLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/mfa/enable', { token });
      setMessage('MFA activado correctamente. Tu cuenta ahora requiere doble factor.');
      setStep('done');
    } catch {
      setError('Código inválido. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/mfa/disable', { token });
      setMessage('MFA desactivado.');
      setStep('idle');
      setToken('');
    } catch {
      setError('Código inválido. Intenta de nuevo.');
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
            <p className="text-xs text-slate-400">{user?.email}</p>
          </div>
        </div>

        {message && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
            <p className="text-emerald-700 text-sm">{message}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

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
            <p className="text-xs text-slate-400 text-center">
              Clave manual: <span className="font-mono text-slate-600">{secret}</span>
            </p>
            <button onClick={() => setStep('verify')} className="btn-primary w-full">
              Ya escaneé el QR →
            </button>
          </div>
        )}

        {/* Paso 3: Verificar */}
        {step === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Ingresa el código de 6 dígitos de tu app para confirmar:
            </p>
            <input
              type="text"
              maxLength={6}
              placeholder="000000"
              value={token}
              onChange={e => setToken(e.target.value)}
              className="input-field text-center text-2xl tracking-widest"
            />
            <button
              onClick={handleEnableMfa}
              disabled={loading || token.length !== 6}
              className="btn-primary w-full disabled:opacity-50"
            >
              {loading ? 'Verificando...' : 'Activar MFA'}
            </button>
          </div>
        )}

        {/* Paso 4: MFA activo — desactivar */}
        {step === 'done' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <ShieldCheck size={18} />
              <p className="text-sm font-medium">MFA activo</p>
            </div>
            <p className="text-sm text-slate-600">
              Para desactivar el MFA ingresa un código válido de tu app:
            </p>
            <input
              type="text"
              maxLength={6}
              placeholder="000000"
              value={token}
              onChange={e => setToken(e.target.value)}
              className="input-field text-center text-2xl tracking-widest"
            />
            <button
              onClick={handleDisableMfa}
              disabled={loading || token.length !== 6}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <ShieldOff size={16} />
              {loading ? 'Desactivando...' : 'Desactivar MFA'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}