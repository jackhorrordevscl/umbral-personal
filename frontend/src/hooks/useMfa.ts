import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../api/client';

export interface MfaHistoryEntry {
  action: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

// Historial informativo de cambios de MFA. Sin reintentos y siempre fresco:
// el fallo se avisa en pantalla (no puede desaparecer en silencio) y tras
// activar/desactivar MFA se vuelve a pedir con refetch().
export function useMfaHistory() {
  return useQuery({
    queryKey: ['mfa-history'],
    queryFn: async (): Promise<MfaHistoryEntry[]> => {
      const res = await api.get('/profile/mfa-history');
      return res.data;
    },
    retry: false,
    staleTime: 0,
  });
}

export function useGenerateMfa() {
  return useMutation({
    mutationFn: () =>
      api
        .post<{ qrCode: string; secret: string }>('/auth/mfa/generate')
        .then((r) => r.data),
  });
}

export function useEnableMfa() {
  return useMutation({
    mutationFn: (token: string) =>
      api
        .post<{ recoveryCodes?: string[] }>('/auth/mfa/enable', { token })
        .then((r) => r.data),
  });
}

export function useDisableMfa() {
  return useMutation({
    mutationFn: (token: string) => api.post('/auth/mfa/disable', { token }),
  });
}
