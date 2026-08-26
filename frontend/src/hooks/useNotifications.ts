import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as notificationsApi from '../api/notifications';

// sdd/session-reminders PR 3: design.md solo especifica el contrato REST
// ("Frontend --poll--> GET /notifications/unread-count"), no el intervalo.
// 30s reutiliza el mismo valor que App.tsx ya usa como staleTime de
// react-query (issue #39) -- suficientemente fresco para un badge de
// notificaciones sin generar tráfico de polling desproporcionado.
const UNREAD_COUNT_POLL_MS = 30_000;

export function useUnreadNotificationsCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.getUnreadCount,
    refetchInterval: UNREAD_COUNT_POLL_MS,
  });
}

// `enabled`: la lista completa solo se pide cuando el panel está abierto,
// no en cada poll del badge.
export function useNotificationsList(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: notificationsApi.listNotifications,
    enabled,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
