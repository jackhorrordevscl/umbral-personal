import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  // Issue #653: el último pago de la cuenta terminó rechazado.
  lastPaymentFailed?: boolean;
  priceClp: number;
  // Fin del precio de lanzamiento y precio que se cobrará desde esa fecha;
  // null si no hay un cambio pendiente.
  priceChangesAt?: string | null;
  nextPriceClp?: number | null;
}

export interface SignupConfig {
  // true = registro abierto con código promocional opcional; false = por
  // invitación.
  openSignup: boolean;
}

export const subscriptionStatusKey = ['subscription-status'] as const;

// Misma consulta con otra clave para la pantalla de retorno de Flow: así no
// comparte función con el banner y no hay dos peticiones compitiendo por los
// mismos datos.
const subscriptionReturnKey = ['subscription-status', 'return'] as const;

// Mismo patrón react-query que usePaymentAccount. `poll` lo usa la pantalla de
// retorno de Flow para esperar la confirmación del pago: cada `everyMs`, hasta
// `maxMs` milisegundos desde que se monta, le pide al backend que verifique el pago directamente
// en Flow (POST /billing/refresh) en vez de esperar solo el webhook, y siembra
// el resultado en la caché del estado general (banner, menú). Si esa consulta
// falla, cae a la lectura normal del estado.
export function useSubscriptionStatus(options?: {
  poll?: { everyMs: number; maxMs: number };
}) {
  const poll = options?.poll;
  const queryClient = useQueryClient();
  // El tope es por tiempo y no por refetches exitosos: si las consultas fallan,
  // el sondeo igual termina.
  const [startedAt] = useState(() => Date.now());
  return useQuery({
    queryKey: poll ? subscriptionReturnKey : subscriptionStatusKey,
    queryFn: async (): Promise<SubscriptionStatus> => {
      if (poll) {
        try {
          const res = await api.post<SubscriptionStatus>('/billing/refresh');
          const refreshed = res.data;
          if (!refreshed || typeof refreshed.state !== 'string') {
            throw new Error('Respuesta de refresh inválida');
          }
          queryClient.setQueryData(subscriptionStatusKey, refreshed);
          return refreshed;
        } catch {
          // Cae a la lectura normal.
        }
      }
      const res = await api.get('/billing/status');
      return res.data;
    },
    gcTime: poll ? 0 : undefined,
    refetchInterval: poll
      ? () => (Date.now() - startedAt < poll.maxMs ? poll.everyMs : false)
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
