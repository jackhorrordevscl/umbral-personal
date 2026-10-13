import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as dischargesApi from '../api/discharges';
import type {
  RecordDeliveryPayload,
  UpdateDischargePayload,
  UploadDischargePayload,
} from '../types/discharge';

export const dischargeKeys = {
  all: ['discharges'] as const,
  list: (patientId: string) => ['discharges', 'patient', patientId] as const,
  verify: (id: string) => ['discharges', 'verify', id] as const,
  deliveries: (id: string) => ['discharges', 'deliveries', id] as const,
};

export function useDischarges(patientId: string | undefined) {
  return useQuery({
    queryKey: dischargeKeys.list(patientId ?? ''),
    queryFn: () => dischargesApi.listDischarges(patientId as string),
    enabled: !!patientId,
  });
}

// Fetched when the dialog opens; never cached, because the PDF integrity
// check must reflect the stored bytes at that moment.
export function useVerifyDischarge(id: string | undefined) {
  return useQuery({
    queryKey: dischargeKeys.verify(id ?? ''),
    queryFn: () => dischargesApi.verifyDischarge(id as string),
    enabled: !!id,
    gcTime: 0,
    staleTime: 0,
  });
}

function useDischargeInvalidation(closesTreatment: boolean) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: dischargeKeys.all });
    queryClient.invalidateQueries({ queryKey: ['patients'] });
    queryClient.invalidateQueries({ queryKey: ['patient-documents'] });
    if (closesTreatment) {
      // Issuing a closure cancels future consultations, frees their booked
      // slots and cancels unpaid charges.
      queryClient.invalidateQueries({ queryKey: ['consultations'] });
      queryClient.invalidateQueries({ queryKey: ['consultation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
      queryClient.invalidateQueries({ queryKey: ['public-availability'] });
      queryClient.invalidateQueries({ queryKey: ['payment-account'] });
    }
  };
}

// Saving a draft only changes discharge records, not patients or documents.
function useDraftInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: dischargeKeys.all });
  };
}

export function useCreateDischargeDraft(patientId: string) {
  const invalidate = useDraftInvalidation();
  return useMutation({
    mutationFn: (data: Parameters<typeof dischargesApi.createDischargeDraft>[1]) =>
      dischargesApi.createDischargeDraft(patientId, data),
    onSuccess: invalidate,
  });
}

export function useUpdateDischarge() {
  const invalidate = useDraftInvalidation();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDischargePayload }) =>
      dischargesApi.updateDischarge(id, data),
    onSuccess: invalidate,
  });
}

export function useIssueDischarge() {
  const invalidate = useDischargeInvalidation(true);
  return useMutation({
    mutationFn: (id: string) => dischargesApi.issueDischarge(id),
    onSuccess: invalidate,
  });
}

export function useCorrectDischarge() {
  const invalidate = useDischargeInvalidation(false);
  return useMutation({
    mutationFn: (id: string) => dischargesApi.correctDischarge(id),
    onSuccess: invalidate,
  });
}

export function useUploadDischarge(patientId: string) {
  const invalidate = useDischargeInvalidation(true);
  return useMutation({
    mutationFn: (data: UploadDischargePayload) => dischargesApi.uploadDischarge(patientId, data),
    onSuccess: invalidate,
  });
}

export function useCorrectUploadDischarge() {
  const invalidate = useDischargeInvalidation(true);
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UploadDischargePayload }) =>
      dischargesApi.correctUploadDischarge(id, data),
    onSuccess: invalidate,
  });
}

export function useDeliveries(dischargeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: dischargeKeys.deliveries(dischargeId ?? ''),
    queryFn: () => dischargesApi.listDeliveries(dischargeId as string),
    enabled: !!dischargeId && enabled,
  });
}

export function useRecordDelivery(dischargeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RecordDeliveryPayload) =>
      dischargesApi.recordDelivery(dischargeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dischargeKeys.deliveries(dischargeId) });
    },
  });
}
