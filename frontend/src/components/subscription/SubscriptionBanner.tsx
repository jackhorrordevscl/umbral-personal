import { Link } from 'react-router';
import { useSubscriptionStatus } from '../../hooks/useSubscription';
import { formatChileDateOnly } from '../../utils/datetime';

// Issue #611: aviso fijo sobre el contenido cuando la cuenta está en gracia o en
// solo lectura. No muestra nada con la cuenta al día, exenta, con el interruptor
// apagado, ni si el estado no se pudo leer: un fallo de este aviso nunca debe
// estorbar el uso de la app.
export default function SubscriptionBanner() {
  const { data: status } = useSubscriptionStatus();

  if (!status?.enforced) return null;

  let message: string;
  if (status.state === 'GRACE' && status.graceEnd) {
    message = `Tu suscripción venció. Puedes renovar hasta el ${formatChileDateOnly(status.graceEnd)}; después tu cuenta pasará a solo lectura.`;
  } else if (status.state === 'READ_ONLY') {
    message =
      'Tu cuenta está en solo lectura: puedes consultar tu información, pero no registrar cambios.';
  } else {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:text-amber-300"
    >
      <p>{message}</p>
      <Link to="/suscripcion" className="font-medium underline hover:no-underline">
        Renovar
      </Link>
    </div>
  );
}
