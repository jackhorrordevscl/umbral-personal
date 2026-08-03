import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as patientsApi from '../api/patients';
import type { ConsentPurpose, ConsentStatus } from '../types/patient';

export function usePatients() {
  return useQuery({
    queryKey: ['patients'],
    queryFn: patientsApi.listPatients,
  });
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    // T6.1: crear la ficha no acepta consentimientos en el mismo body (el
    // backend eliminó consentSigned/telemedConsentSigned como columnas), así
    // que se otorgan aparte, un POST /patients/:id/consents por finalidad
    // marcada, después de crear el paciente.
    mutationFn: async ({
      data,
      consents,
    }: {
      data: patientsApi.CreatePatientPayload;
      consents: ConsentStatus;
    }) => {
      const patient = await patientsApi.createPatient(data);
      const grants = (Object.keys(consents) as ConsentPurpose[]).filter(
        (purpose) => consents[purpose],
      );
      // allSettled (no all): el paciente ya quedó creado arriba, así que si
      // un POST de consentimiento individual falla no debe hacer que el
      // flujo entero parezca haber fallado.
      const results = await Promise.allSettled(
        grants.map((purpose) =>
          patientsApi.recordPatientConsent(
            patient.id,
            purpose,
            'GRANT',
            'Otorgado durante la creación de la ficha',
          ),
        ),
      );
      const failedPurposes = grants.filter((_, i) => results[i].status === 'rejected');
      return { patient, failedPurposes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useUpdatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    // T6.1: además de actualizar campos (con su `reason` obligatorio),
    // emite un POST /patients/:id/consents por cada finalidad cuyo estado
    // cambió, reutilizando el mismo `reason` como evidencia.
    mutationFn: async ({
      id,
      data,
      consentChanges,
    }: {
      id: string;
      data: Record<string, unknown>;
      consentChanges: { purpose: ConsentPurpose; action: 'GRANT' | 'REVOKE' }[];
    }) => {
      await patientsApi.updatePatient(id, data);
      const results = await Promise.allSettled(
        consentChanges.map(({ purpose, action }) =>
          patientsApi.recordPatientConsent(id, purpose, action, String(data.reason ?? '')),
        ),
      );
      const failed = consentChanges.filter((_, i) => results[i].status === 'rejected');
      // El PATCH devuelve la fila cruda de Patient (sin `consents`, que es un
      // campo calculado agregado solo en findOne/findAll). Se refetchea
      // siempre para reflejar el estado real.
      const patient = await patientsApi.getPatient(id);
      return { patient, failed };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useDeletePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patientsApi.deletePatient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}
