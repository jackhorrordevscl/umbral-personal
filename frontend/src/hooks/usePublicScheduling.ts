import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as publicSchedulingApi from '../api/publicScheduling';
import type { BookPublicSlotPayload } from '../api/publicScheduling';

// sdd/patient-self-scheduling PR 5: mismo patrón que useAvailability.ts (PR4)
// -- queryKey incluye therapistId+rango (distintos meses no deben compartir
// cache); una reserva exitosa invalida la disponibilidad de ese terapeuta
// para reflejar el slot recién ocupado si el visitante sigue en la página.

export function usePublicAvailability(therapistId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['public-availability', therapistId, from, to],
    queryFn: () => publicSchedulingApi.getPublicAvailability(therapistId, from, to),
    enabled: Boolean(therapistId),
  });
}

export function useBookPublicSlot(therapistId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BookPublicSlotPayload) =>
      publicSchedulingApi.bookPublicSlot(therapistId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-availability', therapistId] });
    },
  });
}
