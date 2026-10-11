import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import * as patientsApi from '../api/patients';
import type { ConsentGrantor, ConsentPurpose, ConsentStatus } from '../types/patient';
import { isMinorOnChileDay } from '../utils/age';

// issue #290: las claves cuelgan todas del prefijo ['patients'] para que las
// mutaciones (crear/editar/eliminar/consentimientos/documentos) refresquen con
// un solo invalidateQueries({ queryKey: ['patients'] }) las listas paginadas,
// el resumen del dashboard y el detalle.
export const patientKeys = {
  all: ['patients'] as const,
  list: (params: patientsApi.ListPatientsParams) => ['patients', 'list', params] as const,
  summary: ['patients', 'summary'] as const,
  detail: (id: string) => ['patients', 'detail', id] as const,
  // Bloque Menores: cuelgan de ['patients'] para refrescarse con patientKeys.all.
  guardians: (id: string) => ['patients', 'guardians', id] as const,
  assents: (id: string) => ['patients', 'assents', id] as const,
};

// Lista paginada con búsqueda en el servidor. keepPreviousData mantiene la
// página anterior mientras llega la nueva (buscar o paginar no parpadea).
export function usePatients(params: patientsApi.ListPatientsParams = {}) {
  return useQuery({
    queryKey: patientKeys.list(params),
    queryFn: () => patientsApi.listPatients(params),
    placeholderData: keepPreviousData,
  });
}

// Contadores del dashboard (total y con consentimiento vigente).
export function usePatientsSummary() {
  return useQuery({
    queryKey: patientKeys.summary,
    queryFn: patientsApi.getPatientsSummary,
  });
}

// Paciente puntual por id, para resolverlo cuando no está en la página cargada.
export function usePatient(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: patientKeys.detail(id ?? ''),
    queryFn: () => patientsApi.getPatient(id as string),
    enabled: !!id && enabled,
  });
}

// Valor que se actualiza `delay` ms después del último cambio: evita una
// petición por cada tecla en los buscadores con búsqueda en el servidor.
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
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
      const requested = (Object.keys(consents) as ConsentPurpose[]).filter(
        (purpose) => consents[purpose],
      );
      // Bloque Menores: el GRANT de un menor exige un representante con
      // canConsent, que todavía no existe al crear la ficha. No se envía (el
      // servidor lo rechazaría) y se informa como diferido.
      const minor = isMinorOnChileDay(data.birthDate);
      const grants = minor ? [] : requested;
      const deferredPurposes = minor ? requested : [];
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
      return { patient, failedPurposes, deferredPurposes };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
      queryClient.invalidateQueries({ queryKey: ['acquisition-stats'] });
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
      // grantedBy/guardianId solo para el GRANT de un menor.
      consentChanges: {
        purpose: ConsentPurpose;
        action: 'GRANT' | 'REVOKE';
        grantedBy?: ConsentGrantor;
        guardianId?: string;
      }[];
    }) => {
      await patientsApi.updatePatient(id, data);
      const results = await Promise.allSettled(
        consentChanges.map(({ purpose, action, grantedBy, guardianId }) =>
          patientsApi.recordPatientConsent(
            id,
            purpose,
            action,
            String(data.reason ?? ''),
            grantedBy ? { grantedBy, guardianId } : undefined,
          ),
        ),
      );
      const failed = consentChanges.filter((_, i) => results[i].status === 'rejected');
      // El PATCH devuelve la fila cruda de Patient (sin `consents`, que es un
      // campo calculado agregado solo en findOne/findAll). Se refetchea
      // siempre para reflejar el estado real.
      const patient = await patientsApi.getPatient(id);
      return { patient, failed };
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
      queryClient.invalidateQueries({ queryKey: ['patient-history', id] });
    },
  });
}

// Issue #131 (T5): declaración retroactiva en bloque.
export function useBulkDeclareConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      patientIds,
      purpose,
      evidence,
    }: {
      patientIds: string[];
      purpose: ConsentPurpose;
      evidence: string;
    }) => patientsApi.bulkDeclarePatientConsent(patientIds, purpose, evidence),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}

export function useDeletePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patientsApi.deletePatient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
      queryClient.invalidateQueries({ queryKey: ['acquisition-stats'] });
      queryClient.invalidateQueries({ queryKey: ['consultation-stats'] });
    },
  });
}
