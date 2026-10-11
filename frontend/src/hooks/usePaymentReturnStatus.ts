import { useQuery } from '@tanstack/react-query';
import { getPaymentReturnStatus } from '../api/payments';

// Issue #424: sin token no hay nada que consultar (la pantalla muestra
// "procesando"). Sin reintentos agresivos: un error de red se trata igual
// que PENDING en la pantalla, y el paciente puede recargar.
export function usePaymentReturnStatus(token: string | null) {
  return useQuery({
    queryKey: ['payment-return-status', token],
    queryFn: () => getPaymentReturnStatus(token as string),
    enabled: Boolean(token),
    retry: false,
  });
}
