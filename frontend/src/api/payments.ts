import api from './client';

// Issue #424: estado del cobro para la pantalla pública de retorno del pago.
// Contrato tomado de PaymentsController.returnStatus (GET
// /payments/return-status?token=): solo { status }, sin PII; un token
// desconocido o cualquier falla del gateway llega como PENDING.
export type PaymentReturnStatus = 'PAID' | 'PENDING' | 'REJECTED';

export async function getPaymentReturnStatus(
  token: string,
): Promise<PaymentReturnStatus> {
  const { data } = await api.get<{ status: PaymentReturnStatus }>(
    '/payments/return-status',
    { params: { token } },
  );
  return data.status;
}
