import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';

export interface CalendarConnectionStatus {
  status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED';
  googleAccountEmail: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

// issue #122: mismo patrón react-query que usePaymentAccount.ts --
// SecurityPage llamaba a /calendar-integration/* directo con api.get/post,
// inconsistente con el resto de las páginas (ver también issue #73).
export function useCalendarStatus() {
  return useQuery({
    queryKey: ['calendar-integration-status'],
    queryFn: async (): Promise<CalendarConnectionStatus> => {
      const res = await api.get('/calendar-integration/status');
      return res.data;
    },
  });
}

// POST /authorize devuelve { url } como JSON, no un 302 -- design.md de
// google-calendar-integration: "the axios bearer client cannot follow a
// cross-origin redirect". La navegación real la hace el navegador via
// window.location, no react-router (Google no es una ruta de la SPA), por
// eso no hay invalidación de query acá: la página nunca sigue montada del
// otro lado de ese redirect.
export function useConnectCalendar() {
  return useMutation({
    mutationFn: () =>
      api
        .post<{ url: string }>('/calendar-integration/authorize')
        .then((r) => r.data),
  });
}

export function useDisconnectCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/calendar-integration/disconnect'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-integration-status'] });
    },
  });
}
