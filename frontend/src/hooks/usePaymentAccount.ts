import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';

export type PaymentAccountStatusValue =
  | 'PENDING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECT_REQUIRED';

export interface PaymentAccountStatus {
  status: PaymentAccountStatusValue;
  provider: string;
  displayName: string | null;
  keyFingerprint: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

export interface GatewayCredentialsInput {
  apiKey: string;
  secretKey: string;
}

export interface ConnectPaymentAccountInput extends GatewayCredentialsInput {
  displayName?: string;
}

export interface CredentialValidation {
  accountLabel?: string;
  keyFingerprint: string;
}

// sdd/payments-multigateway-redesign (design.md sequence "Connect account —
// after"): mismo patrón react-query que useProfile (queryKey:
// ['payment-account']) -- PaymentsPage.tsx consume esto tanto para el
// estado de la cuenta como para el asistente de conexión de 5 pasos.
export function usePaymentAccount() {
  return useQuery({
    queryKey: ['payment-account'],
    queryFn: async (): Promise<PaymentAccountStatus> => {
      const res = await api.get('/payments/account');
      return res.data;
    },
  });
}

// design.md sequence "Connect account — after", step 1 (paso de "pegar y
// validar" del asistente): POST /payments/account/validate valida en vivo
// contra Flow y NO persiste nada, ni en éxito ni en error -- spec
// "Abandoning the Wizard Persists Nothing". No invalida ['payment-account']
// porque esta llamada nunca cambia el estado persistido.
export function useValidateCredentials() {
  return useMutation({
    mutationFn: (data: GatewayCredentialsInput) =>
      api
        .post<CredentialValidation>('/payments/account/validate', data)
        .then((r) => r.data),
  });
}

// design.md sequence "Connect account — after", step 2 (paso de
// confirmación del asistente): POST /payments/account re-valida en el
// backend (la validación del paso anterior nunca se confía por sí sola) y
// solo entonces persiste el par de credenciales cifrado.
export function useConnectPaymentAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ConnectPaymentAccountInput) =>
      api
        .post<PaymentAccountStatus>('/payments/account', data)
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-account'] });
    },
  });
}

export function useDisconnectPaymentAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.delete<{ status: string }>('/payments/account').then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-account'] });
    },
  });
}
