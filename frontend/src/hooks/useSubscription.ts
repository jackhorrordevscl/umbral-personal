import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../api/client';

// Issue #611: estados que calcula el backend en access-state.ts.
export type SubscriptionAccessState =
  | 'EXEMPT'
  | 'ACTIVE'
  | 'GRACE'
  | 'READ_ONLY';

export interface SubscriptionStatus {
  // false = el interruptor SUBSCRIPTIONS_ENFORCED sigue apagado en el backend.
  enforced: boolean;
  state: SubscriptionAccessState;
  periodEnd: string | null;
  graceEnd: string | null;
  priceClp: number;
}

export interface SignupConfig {
  // true = registro abierto con código promocional opcional; false = por
  // invitación.
  openSignup: boolean;
}

export const subscriptionStatusKey = ['subscription-status'] as const;

// Mismo patrón react-query que usePaymentAccount. `poll` lo usa la pantalla de
// retorno de Flow para esperar la confirmación del pago: consulta cada
// `everyMs` hasta `maxRefetches` veces y después se detiene.
export function useSubscriptionStatus(options?: {
  poll?: { everyMs: number; maxRefetches: number };
}) {
  const poll = options?.poll;
  return useQuery({
    queryKey: subscriptionStatusKey,
    queryFn: async (): Promise<SubscriptionStatus> => {
      const res = await api.get('/billing/status');
      return res.data;
    },
    refetchInterval: poll
      ? (query) =>
          query.state.dataUpdateCount < poll.maxRefetches ? poll.everyMs : false
      : false,
  });
}

// Crea el pago en Flow y devuelve la URL a la que hay que enviar al navegador.
export function useCheckout() {
  return useMutation({
    mutationFn: () =>
      api
        .post<{ paymentUrl: string }>('/billing/checkout')
        .then((r) => r.data),
  });
}

// Ruta pública: la pantalla de registro la consulta antes de que exista sesión.
export function useSignupConfig() {
  return useQuery({
    queryKey: ['signup-config'],
    queryFn: async (): Promise<SignupConfig> => {
      const res = await api.get('/auth/signup-config');
      return res.data;
    },
  });
}
