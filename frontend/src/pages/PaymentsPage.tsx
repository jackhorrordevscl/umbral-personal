import { useState, type FormEvent } from 'react';
import {
  CreditCard,
  ShieldCheck,
  Unlink,
  ExternalLink,
  KeyRound,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import FormField from '../components/ui/FormField';
import ErrorBanner from '../components/ui/ErrorBanner';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { getApiErrorMessage } from '../utils/api-error';
import {
  usePaymentAccount,
  useValidateCredentials,
  useConnectPaymentAccount,
  useDisconnectPaymentAccount,
  type CredentialValidation,
} from '../hooks/usePaymentAccount';

// design.md "PaymentAccountService.assertWellFormed" / DTO
// ValidateCredentialsDto: mismo formato que el backend exige (16-128
// caracteres, alfabeto documentado por Flow) -- rechazar un valor
// obviamente inválido acá evita la llamada de red que spec "Malformed
// credentials are rejected before calling Flow" prohíbe.
const CREDENTIAL_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

type WizardStep =
  | 'welcome'
  | 'goToFlow'
  | 'locateCredentials'
  | 'paste'
  | 'confirmation';

const emptyCredentials = { apiKey: '', secretKey: '' };

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return '••••••••';
  return `${apiKey.slice(0, 4)}••••••••`;
}

// sdd/payments-multigateway-redesign (design.md sequence "Connect account —
// after", spec "Guided Connection Wizard With Pre-Persistence Validation"):
// asistente de 5 pasos (bienvenida/checklist → ir a Flow → ubicar
// credenciales → pegar y validar → confirmación). Nada se persiste hasta
// que el paso de confirmación llama a useConnectPaymentAccount -- el paso
// de "pegar y validar" solo llama a validate(), que nunca escribe (spec
// "Abandoning the Wizard Persists Nothing").
function ConnectionWizard({ reconnect }: { reconnect: boolean }) {
  const validateMutation = useValidateCredentials();
  const connectMutation = useConnectPaymentAccount();

  const [step, setStep] = useState<WizardStep>('welcome');
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [fieldErrors, setFieldErrors] = useState<{
    apiKey?: string;
    secretKey?: string;
  }>({});
  const [validateError, setValidateError] = useState('');
  const [validation, setValidation] = useState<CredentialValidation | null>(
    null,
  );
  const [displayName, setDisplayName] = useState('');
  const [connectError, setConnectError] = useState('');

  const handlePasteSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errors: { apiKey?: string; secretKey?: string } = {};
    if (!CREDENTIAL_FORMAT.test(credentials.apiKey)) {
      errors.apiKey = 'La API Key no tiene el formato esperado por Flow.';
    }
    if (!CREDENTIAL_FORMAT.test(credentials.secretKey)) {
      errors.secretKey = 'La Secret Key no tiene el formato esperado por Flow.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      // spec "Malformed credentials are rejected before calling Flow": un
      // valor obviamente inválido nunca llega a useValidateCredentials.
      return;
    }

    setValidateError('');
    validateMutation.mutate(credentials, {
      onSuccess: (result) => {
        setValidation(result);
        setStep('confirmation');
      },
      onError: (err) => {
        // spec "Flow rejects well-formed but invalid credentials": el
        // terapeuta se queda en el paso de pegar con el motivo de Flow.
        setValidateError(
          getApiErrorMessage(err, 'Flow no reconoció estas credenciales.'),
        );
      },
    });
  };

  const handleConfirm = () => {
    setConnectError('');
    connectMutation.mutate(
      { ...credentials, displayName: displayName.trim() || undefined },
      {
        onError: (err) => {
          setConnectError(
            getApiErrorMessage(err, 'No se pudo conectar la cuenta de pagos.'),
          );
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      {reconnect && (
        <ErrorBanner
          icon
          message="Tu cuenta necesita reconectarse: el modelo anterior de pagos ya no está disponible. Vuelve a ingresar tus credenciales de Flow para retomar el cobro automático."
        />
      )}

      {step === 'welcome' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Para cobrar tus sesiones en línea necesitas conectar tu propia
            cuenta de Flow. Antes de empezar, ten a mano:
          </p>
          <ul className="text-sm text-slate-600 list-disc list-inside space-y-1">
            <li>Una cuenta activa en Flow (flow.cl)</li>
            <li>Tu API Key y Secret Key desde el panel de Flow</li>
          </ul>
          <button
            type="button"
            onClick={() => setStep('goToFlow')}
            className="btn-primary flex items-center gap-2"
          >
            Comenzar <ArrowRight size={16} />
          </button>
        </div>
      )}

      {step === 'goToFlow' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Abre tu cuenta de Flow en una pestaña nueva. Si aún no tienes una,
            puedes crearla desde el mismo sitio.
          </p>
          <a
            href="https://www.flow.cl"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary inline-flex items-center gap-2"
          >
            Ir a Flow <ExternalLink size={16} />
          </a>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep('welcome')}
              className="btn-secondary"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={() => setStep('locateCredentials')}
              className="btn-primary flex items-center gap-2"
            >
              Ya tengo una cuenta en Flow <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 'locateCredentials' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Dentro de Flow, ve a <strong>Configuración de la API</strong> y
            copia tu <strong>API Key</strong> y tu <strong>Secret Key</strong>
            . Nunca compartas tu Secret Key fuera de este formulario.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep('goToFlow')}
              className="btn-secondary"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={() => setStep('paste')}
              className="btn-primary flex items-center gap-2"
            >
              Ya tengo mis credenciales <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {step === 'paste' && (
        <form className="space-y-4" onSubmit={handlePasteSubmit}>
          {validateError && <ErrorBanner icon message={validateError} />}
          <FormField
            id="payment-api-key"
            label="API Key"
            required
            error={fieldErrors.apiKey}
          >
            <input
              id="payment-api-key"
              className="input-field"
              autoComplete="off"
              value={credentials.apiKey}
              onChange={(e) =>
                setCredentials({ ...credentials, apiKey: e.target.value })
              }
            />
          </FormField>
          <FormField
            id="payment-secret-key"
            label="Secret Key"
            required
            error={fieldErrors.secretKey}
          >
            <input
              id="payment-secret-key"
              type="password"
              className="input-field"
              autoComplete="off"
              value={credentials.secretKey}
              onChange={(e) =>
                setCredentials({ ...credentials, secretKey: e.target.value })
              }
            />
          </FormField>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep('locateCredentials')}
              className="btn-secondary"
            >
              Atrás
            </button>
            <button
              type="submit"
              disabled={validateMutation.isPending}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <KeyRound size={16} />
              {validateMutation.isPending
                ? 'Validando...'
                : 'Validar credenciales'}
            </button>
          </div>
        </form>
      )}

      {step === 'confirmation' && validation && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={18} />
            <p className="text-sm font-medium">Flow validó tus credenciales</p>
          </div>
          {connectError && <ErrorBanner icon message={connectError} />}
          <div className="text-sm text-slate-600 space-y-1">
            <p>Proveedor: Flow</p>
            <p>API Key: {maskApiKey(credentials.apiKey)}</p>
            <p>Huella de la clave: {validation.keyFingerprint}</p>
            {validation.accountLabel && <p>Comercio: {validation.accountLabel}</p>}
          </div>
          {!validation.accountLabel && (
            <FormField
              id="payment-display-name"
              label="Nombre para identificar esta cuenta (opcional)"
            >
              <input
                id="payment-display-name"
                className="input-field"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </FormField>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep('paste')}
              className="btn-secondary"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={connectMutation.isPending}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {connectMutation.isPending ? 'Conectando...' : 'Confirmar y conectar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// sdd/payments-multigateway-redesign (design.md "File Changes" +
// component-responsibilities table): reemplaza el aviso deshabilitado del
// módulo en integración por el asistente de conexión completo. Cuenta ya
// conectada sigue mostrando el mismo resumen + botón de desconectar de
// antes; una cuenta en RECONNECT_REQUIRED (spec "Reconnection of
// Legacy-Invalidated Accounts") muestra el mismo asistente con un banner
// explicando por qué debe reconectarse.
export default function PaymentsPage() {
  const { data: account, isLoading } = usePaymentAccount();
  const disconnectMutation = useDisconnectPaymentAccount();

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  const isConnected = account?.status === 'CONNECTED';
  const needsReconnect = account?.status === 'RECONNECT_REQUIRED';

  const handleConfirmDisconnect = () => {
    setShowDisconnectConfirm(false);
    disconnectMutation.mutate(undefined, {
      onError: (err) => {
        setDisconnectError(
          getApiErrorMessage(err, 'No se pudo desconectar la cuenta de pagos'),
        );
      },
    });
  };

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h2 className="font-display text-2xl md:text-3xl text-slate-900">Pagos</h2>
        <p className="text-slate-500 text-sm mt-1">
          Conecta tu cuenta de Flow para cobrar tus sesiones en línea
        </p>
      </div>

      <div className="card max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-sage-50 p-3 rounded-lg">
            <CreditCard size={22} className="text-sage-600" />
          </div>
          <div>
            <h3 className="font-medium text-slate-800">Cuenta de pagos (Flow)</h3>
            <p className="text-xs text-slate-500">
              Cada sesión se cobra directamente a tu cuenta, Umbral nunca custodia el dinero
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">Verificando estado de la cuenta...</p>
        ) : isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <ShieldCheck size={18} />
              <p className="text-sm font-medium">
                Cuenta conectada
                {account?.displayName ? ` — ${account.displayName}` : ''}
              </p>
            </div>
            {account?.connectedAt && (
              <p className="text-xs text-slate-500">
                Conectada el {new Date(account.connectedAt).toLocaleString('es-CL')}
              </p>
            )}
            {account?.keyFingerprint && (
              <p className="text-xs text-slate-500">
                Huella de la clave: {account.keyFingerprint}
              </p>
            )}
            {disconnectError && <ErrorBanner message={disconnectError} />}
            <button
              type="button"
              onClick={() => setShowDisconnectConfirm(true)}
              disabled={disconnectMutation.isPending}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <Unlink size={16} />
              {disconnectMutation.isPending ? 'Desconectando...' : 'Desconectar cuenta'}
            </button>
          </div>
        ) : (
          <>
            {account?.lastError && !needsReconnect && (
              <ErrorBanner
                className="mb-4"
                message={`Último intento fallido: ${account.lastError}`}
              />
            )}
            <ConnectionWizard reconnect={needsReconnect} />
          </>
        )}
      </div>

      {showDisconnectConfirm && (
        <ConfirmDialog
          title="Desconectar cuenta de pagos"
          message="Los cargos ya generados no se ven afectados, pero no se crearán nuevos cargos hasta que vuelvas a conectar tu cuenta. ¿Desconectar?"
          confirmLabel="Desconectar"
          onConfirm={handleConfirmDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
        />
      )}
    </div>
  );
}
