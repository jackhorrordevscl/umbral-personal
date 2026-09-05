// Bug fix: destino público (sin auth) al que Flow devuelve al paciente
// después del checkout hospedado, vía el redirect 302 de
// PaymentsController.returnFromGateway (backend/payments.constants.ts,
// PAYMENT_RETURN_PATH). No hace ninguna llamada a la API ni confía en el
// token de la URL -- el estado real del cargo se confirma exclusivamente
// por el webhook servidor-a-servidor (design.md "The confirmation callback
// is a signal, never a source of truth"), así que esta pantalla es
// deliberadamente estática.
export default function PaymentReturnPage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      <div className="bg-cream-50 rounded-2xl p-8 w-full max-w-md text-center">
        <h2 className="font-display text-2xl text-slate-900 mb-2">¡Gracias!</h2>
        <p className="text-slate-500 text-sm">
          Tu pago está siendo procesado. En cuanto quede confirmado vas a recibir un
          correo de tu terapeuta.
        </p>
      </div>
    </div>
  );
}
