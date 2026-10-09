import { useSearchParams } from 'react-router';
import { usePaymentReturnStatus } from '../hooks/usePaymentReturnStatus';

// Destino público (sin auth) al que Flow devuelve al paciente después del
// checkout hospedado, vía el redirect 302 de PaymentsController.returnFromGateway
// (backend/payments.constants.ts, PAYMENT_RETURN_PATH).
// Issue #424: la pantalla consulta el estado real del cobro (GET
// /payments/return-status, solo lectura) para no mentirle al paciente tras un
// rechazo. Es informativa: la confirmación del cobro sigue ocurriendo
// exclusivamente por el webhook servidor-a-servidor (design.md "The
// confirmation callback is a signal, never a source of truth"). Sin token,
// mientras carga o ante cualquier error se muestra "procesando". En el
// rechazo NO se invita a reintentar el mismo link porque Flow no permite
// reutilizarlo: se pide uno nuevo al terapeuta.
export default function PaymentReturnPage() {
  const [searchParams] = useSearchParams();
  const { data: status } = usePaymentReturnStatus(searchParams.get('token'));

  let title = '¡Gracias!';
  let message =
    'Tu pago está siendo procesado. En cuanto quede confirmado vas a recibir un correo de tu terapeuta.';
  if (status === 'PAID') {
    title = 'Pago recibido';
    message = 'Recibimos tu pago. Tu terapeuta ya fue notificado. ¡Gracias!';
  } else if (status === 'REJECTED') {
    title = 'Pago no completado';
    message =
      'No pudimos completar tu pago. Pide a tu terapeuta que te envíe un nuevo link de pago.';
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
        <h2 className="font-display text-2xl text-slate-900 mb-2">{title}</h2>
        <p className="text-slate-500 text-sm">{message}</p>
      </div>
    </div>
  );
}
