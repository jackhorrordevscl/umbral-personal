import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as documentsApi from '../api/documents';

// Reemplaza el fetch manual con useState que tenía PatientsPage (issue #31):
// ahora los documentos de un paciente tienen cache, invalidación automática
// tras subir uno nuevo, y el mismo manejo de loading/error que el resto de
// la app vía React Query.
export function usePatientDocuments(patientId: string | undefined) {
  return useQuery({
    queryKey: ['patient-documents', patientId],
    queryFn: () => documentsApi.listPatientDocuments(patientId as string),
    enabled: !!patientId,
  });
}

export function useUploadPatientDocument(patientId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, type, consultationGroupId }: { file: File; type: string; consultationGroupId?: string }) =>
      documentsApi.uploadPatientDocument(patientId as string, file, type, consultationGroupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] });
    },
  });
}

// Issue #270: anular puede agregar un REVOKE al ledger de consentimiento, así
// que además de los documentos se refresca la lista de pacientes (que trae el
// estado de consentimiento vigente).
export function useVoidPatientDocument(patientId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      documentsApi.voidPatientDocument(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}
