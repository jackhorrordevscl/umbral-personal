import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as consultationsApi from '../api/consultations';
import api from '../api/client';

// #73 (punto 4): ConsultationsPage armaba useQuery/useMutation a mano en vez
// de un hook dedicado, a diferencia de usePatients/usePatientDocuments/
// usePatientHistory -- mismo patrón que esos.
export function useConsultations(patientId: string | undefined) {
  return useQuery({
    queryKey: ['consultations', patientId],
    queryFn: () => consultationsApi.listConsultationsByPatient(patientId as string),
    enabled: !!patientId,
  });
}

export function useCreateConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: consultationsApi.createConsultation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultations'] });
    },
  });
}

export function useCorrectConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: consultationsApi.ConsultationPayload }) =>
      consultationsApi.correctConsultation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultations'] });
    },
  });
}

// Issue #271: reintenta crear la orden de cobro de un cargo sin paymentUrl
// (POST /payments/:groupId/retry-charge). El backend responde 200 aun si la
// pasarela vuelve a rechazar (deja lastError seteado), así que se refresca
// la lista siempre, tanto en éxito como en error.
export function useRetryCharge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.post(`/payments/${groupId}/retry-charge`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['consultations'] });
    },
  });
}
