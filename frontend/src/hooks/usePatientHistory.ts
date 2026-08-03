import { useQuery } from '@tanstack/react-query';
import * as patientsApi from '../api/patients';

// Reemplaza el fetch manual con useState que tenía PatientsPage (issue #31):
// se pide solo cuando la pestaña de historial está activa (`enabled`), igual
// que antes, pero con cache y el mismo patrón de isLoading/isError del resto
// de la app.
export function usePatientHistory(patientId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => patientsApi.getPatientHistory(patientId as string),
    enabled: enabled && !!patientId,
  });
}
