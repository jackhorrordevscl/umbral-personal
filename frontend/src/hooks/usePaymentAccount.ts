import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';

export interface PaymentAccountStatus {
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED';
  merchantId: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

export interface OnboardPaymentAccountInput {
  name: string;
  email: string;
  rutOrTaxId: string;
}

// sdd/online-payment-integration PR 3 (T9.1, design.md "Therapist payment
// account is its own page"): mismo patrón react-query que useProfile
// (queryKey: ['payment-account']) en vez de un GET manual en useEffect --
// PaymentsPage.tsx consume esto para el estado de onboarding.
export function usePaymentAccount() {
  return useQuery({
    queryKey: ['payment-account'],
    queryFn: async (): Promise<PaymentAccountStatus> => {
      const res = await api.get('/payments/account');
      return res.data;
    },
  });
}

export function useOnboardPaymentAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OnboardPaymentAccountInput) =>
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
