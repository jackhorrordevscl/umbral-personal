import { useState } from 'react';
import { CreditCard, ShieldCheck, Unlink } from 'lucide-react';
import FormField from '../components/ui/FormField';
import ErrorBanner from '../components/ui/ErrorBanner';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { getApiErrorMessage } from '../utils/api-error';
import {
  usePaymentAccount,
  useOnboardPaymentAccount,
  useDisconnectPaymentAccount,
} from '../hooks/usePaymentAccount';

const emptyForm = { name: '', email: '', rutOrTaxId: '' };

// sdd/online-payment-integration PR 3 (T9.2, design.md "Therapist payment
// account is its own page"): onboarding es un FORMULARIO, no un redirect
// OAuth -- POST /payments/account llama a gateway.createMerchant y persiste
// el estado CONNECTED. Sin cuenta conectada, ConsultationsPage nunca genera
// cargos (spec.md "Automatic Charge Creation Gated by Gateway Connection"),
// así que esta página es el único requisito previo para que el cobro en
// línea empiece a funcionar para un terapeuta.
export default function PaymentsPage() {
  const { data: account, isLoading } = usePaymentAccount();
  const onboardMutation = useOnboardPaymentAccount();
  const disconnectMutation = useDisconnectPaymentAccount();

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnectError, setDisconnectError] = useState('');

  const isConnected = account?.status === 'CONNECTED';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.rutOrTaxId.trim()) {
      setFormError('Todos los campos son obligatorios');
      return;
    }
    setFormError('');
    onboardMutation.mutate(form, {
      onSuccess: () => setForm(emptyForm),
      onError: (err) => {
        setFormError(
          getApiErrorMessage(err, 'No se pudo conectar la cuenta de pagos'),
        );
      },
    });
  };

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
              <p className="text-sm font-medium">Cuenta conectada</p>
            </div>
            {account?.connectedAt && (
              <p className="text-xs text-slate-500">
                Conectada el {new Date(account.connectedAt).toLocaleString('es-CL')}
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
          <form className="space-y-4" onSubmit={handleSubmit}>
            {account?.lastError && (
              <ErrorBanner message={`Último intento fallido: ${account.lastError}`} />
            )}
            <p className="text-sm text-slate-600">
              Ingresa los datos de tu cuenta para conectarla con Flow y empezar a cobrar tus sesiones en línea.
            </p>
            <FormField id="payment-account-name" label="Nombre o razón social" required>
              <input
                id="payment-account-name"
                className="input-field"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <FormField id="payment-account-email" label="Email" required>
              <input
                id="payment-account-email"
                type="email"
                className="input-field"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FormField>
            <FormField id="payment-account-rutOrTaxId" label="RUT o identificador tributario" required>
              <input
                id="payment-account-rutOrTaxId"
                className="input-field"
                value={form.rutOrTaxId}
                onChange={(e) => setForm({ ...form, rutOrTaxId: e.target.value })}
              />
            </FormField>
            {formError && <ErrorBanner icon message={formError} />}
            <button
              type="submit"
              className="btn-primary disabled:opacity-50"
              disabled={onboardMutation.isPending}
            >
              {onboardMutation.isPending ? 'Conectando...' : 'Conectar cuenta de pagos'}
            </button>
          </form>
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
