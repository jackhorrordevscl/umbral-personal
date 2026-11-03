import { SubscriptionScreen } from './SubscriptionPage';

// Issue #611: destino al que el backend (BILLING_FRONTEND_RETURN_PATH) devuelve
// el navegador tras pagar en Flow. Es la misma pantalla de suscripción, con el
// aviso de confirmación y la consulta periódica del estado.
export default function SubscriptionReturnPage() {
  return <SubscriptionScreen afterPayment />;
}
