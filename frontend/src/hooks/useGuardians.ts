import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as patientsApi from "../api/patients";
import { patientKeys } from "./usePatients";

// Representantes legales de un paciente menor (bloque Menores, M5).
export function useGuardians(patientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: patientKeys.guardians(patientId ?? ""),
    queryFn: () => patientsApi.listGuardians(patientId as string),
    enabled: !!patientId && enabled,
  });
}

// Agregar, editar o quitar un representante cambia guardianCount y minorStatus
// del paciente, por eso se invalida todo el prefijo ['patients'].
function useGuardianMutation<TVars>(
  mutationFn: (vars: TVars) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}

export function useCreateGuardian(patientId: string) {
  return useGuardianMutation((data: patientsApi.GuardianPayload) =>
    patientsApi.createGuardian(patientId, data),
  );
}

export function useUpdateGuardian(patientId: string) {
  return useGuardianMutation(
    ({
      guardianId,
      data,
    }: {
      guardianId: string;
      data: Partial<patientsApi.GuardianPayload>;
    }) => patientsApi.updateGuardian(patientId, guardianId, data),
  );
}

export function useDeleteGuardian(patientId: string) {
  return useGuardianMutation((guardianId: string) =>
    patientsApi.deleteGuardian(patientId, guardianId),
  );
}
