import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as consultationsApi from '../api/consultations';

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
