import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as patientsApi from "../api/patients";
import { patientKeys } from "./usePatients";

// Ledger de asentimiento del menor (bloque Menores, M5).
export function useAssents(patientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: patientKeys.assents(patientId ?? ""),
    queryFn: () => patientsApi.listAssents(patientId as string),
    enabled: !!patientId && enabled,
  });
}

export function useRecordAssent(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: patientsApi.AssentPayload) =>
      patientsApi.recordAssent(patientId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}
