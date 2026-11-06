import { useState } from 'react';
import { Wallet } from 'lucide-react';
import {
  useCheckout,
  useSubscriptionStatus,
  type SubscriptionStatus,
} from '../hooks/useSubscription';
import { formatChileDateOnly } from '../utils/datetime';
import { getApiErrorMessage } from '../utils/api-error';
import ErrorBanner from '../components/ui/ErrorBanner';

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

// Tras pagar, Flow devuelve al navegador y confirma por webhook: puede tardar.
// La pantalla de retorno consulta el estado cada 5 s durante un minuto y, en
// cada vuelta, le pide al backend que verifique el pago directamente en Flow.
const RETURN_POLL = { everyMs: 5000, maxMs: 60_000 };

function describeStatus(status: SubscriptionStatus) {
  const periodEnd = status.periodEnd ? formatChileDateOnly(status.periodEnd) : null;
  const graceEnd = status.graceEnd ? formatChileDateOnly(status.graceEnd) : null;

  switch (status.state) {
    case 'ACTIVE': {
      const lines = [
        periodEnd
          ? `Tu suscripción está vigente hasta el ${periodEnd}.`
          : 'Tu suscripción está vigente.',
      ];
      // Issue #633: fuera de la ventana de renovación no se ofrece pagar.
      if (status.canRenew === false) {
        lines.push(
          status.renewableFrom
            ? `Podrás renovarla desde el ${formatChileDateOnly(status.renewableFrom)}, 5 días antes de su vencimiento.`
            : 'Podrás renovarla desde 5 días antes de su vencimiento.',
        );
        return { lines, payLabel: null };
      }
      return { lines, payLabel: 'Pagar un mes más' };
    }
    case 'GRACE':
      return {
        lines: [
          periodEnd ? `Tu suscripción venció el ${periodEnd}.` : 'Tu suscripción venció.',
          graceEnd
            ? `Puedes renovar hasta el ${graceEnd}; después tu cuenta pasará a solo lectura.`
            : 'Puedes renovar; después tu cuenta pasará a solo lectura.',
        ],
        payLabel: 'Pagar suscripción',
      };
    case 'READ_ONLY':
      return {
        lines: [
          'Tu cuenta está en solo lectura: puedes consultar tu información, pero no registrar cambios hasta renovar.',
        ],
        payLabel: 'Pagar suscripción',
      };
    case 'EXEMPT':
      return {
        lines: [
          periodEnd
            ? `Tu cuenta tiene acceso sin costo hasta el ${periodEnd}.`
            : 'Tu cuenta tiene acceso sin costo.',
        ],
        payLabel: null,
      };
  }
}

// Issue #611: estado de la suscripción y pago con Flow. La misma pantalla sirve
// de destino al volver de Flow (/suscripcion/retorno, `afterPayment`).
export function SubscriptionScreen({
  afterPayment = false,
}: {
  afterPayment?: boolean;
}) {
  const {
    data: status,
    isLoading,
    refetch,
  } = useSubscriptionStatus({ poll: afterPayment ? RETURN_POLL : undefined });
  const checkout = useCheckout();
  const [checkoutError, setCheckoutError] = useState('');
  // La mutación termina antes de que el navegador cambie de página: sin esto el
  // botón se rehabilita y un segundo clic crearía otro checkout.
  const [redirecting, setRedirecting] = useState(false);

  const handlePay = () => {
    setCheckoutError('');
    checkout.mutate(undefined, {
      onSuccess: ({ paymentUrl }) => {
        setRedirecting(true);
        window.location.assign(paymentUrl);
      },
      onError: (err) =>
        setCheckoutError(
          getApiErrorMessage(err, 'No se pudo iniciar el pago. Intenta nuevamente.'),
        ),
    });
  };

  // Primer estado leído en esta pantalla: si luego el vencimiento avanza, el
  // pago ya se confirmó y el aviso de espera sobra.
  const [baseline, setBaseline] = useState<SubscriptionStatus | null>(null);
  if (status && !baseline) setBaseline(status);
  const paymentConfirmed =
    !!status &&
    !!baseline &&
    status.state === 'ACTIVE' &&
    status.periodEnd !== baseline.periodEnd;

  const view = status?.enforced ? describeStatus(status) : null;

  return (
    <div className="p-4 md:p-8 short:md:p-5">
      <div className="mb-8">
        <h2 className="font-display text-2xl md:text-3xl text-slate-900">Suscripción</h2>
        <p className="text-slate-500 text-sm mt-1">
          Tu acceso a Umbral se renueva con un pago mensual
        </p>
      </div>

      <div className="card max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-sage-50 p-3 rounded-lg">
            <Wallet size={22} className="text-sage-600" />
          </div>
          <div>
            <h3 className="font-medium text-slate-800">Plan mensual</h3>
            <p className="text-xs text-slate-500">
              Cada pago suma 30 días a tu vencimiento; si pagas antes de vencer no pierdes días
            </p>
          </div>
        </div>

        {afterPayment && !paymentConfirmed && (
          status?.lastPaymentFailed ? (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Tu pago fue rechazado. Puedes intentar de nuevo.
            </p>
          ) : (
            <p className="mb-4 rounded-lg bg-sage-50 p-3 text-sm text-slate-700">
              Estamos confirmando tu pago. Puede tardar unos minutos; esta pantalla se actualiza sola.
            </p>
          )
        )}

        {isLoading ? (
          <p className="text-sm text-slate-500">Verificando estado de tu suscripción...</p>
        ) : !status ? (
          // Sin conocer el estado real no se ofrece pagar. Si ya hay datos, un
          // refetch fallido no los reemplaza (React Query los conserva).
          <ErrorBanner
            icon
            message="No se pudo verificar el estado de tu suscripción."
            onRetry={() => void refetch()}
          />
        ) : !view ? (
          <p className="text-sm text-slate-600">
            La suscripción todavía no está activa: por ahora no se cobra y tu acceso no cambia.
          </p>
        ) : (
          <div className="space-y-4">
            {view.lines.map((line) => (
              <p key={line} className="text-sm text-slate-700">
                {line}
              </p>
            ))}
            {view.payLabel && (
              <>
                <p className="text-xs text-slate-500">
                  Precio: {clp.format(status.priceClp)} al mes
                </p>
                {status.priceChangesAt && status.nextPriceClp != null && (
                  <p className="text-xs text-slate-500">
                    Desde el {formatChileDateOnly(status.priceChangesAt)} el precio pasa a{' '}
                    {clp.format(status.nextPriceClp)} al mes. No tienes que hacer nada: el cambio
                    aplica a los pagos desde esa fecha.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={checkout.isPending || redirecting}
                  className="btn-primary w-full py-3 disabled:opacity-50"
                >
                  {checkout.isPending || redirecting ? 'Redirigiendo a Flow...' : view.payLabel}
                </button>
              </>
            )}
            {checkoutError && <ErrorBanner message={checkoutError} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  return <SubscriptionScreen />;
}
