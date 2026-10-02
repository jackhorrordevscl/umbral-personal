import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

// Issue #292: activar/desactivar cambia profile.mfaEnabled; sin invalidar
// ['profile'], MfaCard se remonta en el paso equivocado y el backend responde
// 401 'MFA ya está activo'.
export function useEnableMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api
        .post<{ recoveryCodes?: string[] }>('/auth/mfa/enable', { token })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDisableMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post('/auth/mfa/disable', { token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
