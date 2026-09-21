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

// issue #155: sección de perfil ANTES del calendario -- degradación graciosa
// a propósito (design del issue: "booking debe seguir funcionando aunque el
// perfil no cargue"), así que esta query nunca debe bloquear ni reintentar
// agresivo: si el 404 (terapeuta sin perfil público) o un error de red pasa,
// PublicBookingPage simplemente no renderiza la sección.
export function usePublicTherapistProfile(therapistId: string) {
  return useQuery({
    queryKey: ['public-therapist-profile', therapistId],
    queryFn: () => publicSchedulingApi.getPublicTherapistProfile(therapistId),
    enabled: Boolean(therapistId),
    retry: false,
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
