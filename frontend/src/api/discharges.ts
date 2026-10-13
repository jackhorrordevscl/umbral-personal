import api from './client';
import type {
  CancellationPreview,
  ClosurePayload,
  DischargeDelivery,
  DischargeVerification,
  IssueDischargeResult,
  RecordDeliveryPayload,
  TreatmentDischarge,
  UpdateDischargePayload,
  UploadDischargePayload,
} from '../types/discharge';

export function listDischarges(patientId: string) {
  return api
    .get<TreatmentDischarge[]>(`/patients/${patientId}/discharges`)
    .then((r) => r.data);
}

export function createDischargeDraft(patientId: string, data: ClosurePayload) {
  return api
    .post<TreatmentDischarge>(`/patients/${patientId}/discharges`, data)
    .then((r) => r.data);
}

// Read-only: future consultations that issuing a closure would cancel.
export function getCancellationPreview(patientId: string) {
  return api
    .get<CancellationPreview>(`/patients/${patientId}/discharges/cancellation-preview`)
    .then((r) => r.data);
}

export function updateDischarge(id: string, data: UpdateDischargePayload) {
  return api.patch<TreatmentDischarge>(`/discharges/${id}`, data).then((r) => r.data);
}

export function issueDischarge(id: string) {
  return api.post<IssueDischargeResult>(`/discharges/${id}/issue`).then((r) => r.data);
}

export function correctDischarge(id: string) {
  return api.post<TreatmentDischarge>(`/discharges/${id}/correct`).then((r) => r.data);
}

function buildUploadForm({ file, ...fields }: UploadDischargePayload) {
  const formData = new FormData();
  formData.append('file', file);
  for (const [key, value] of Object.entries(fields)) {
    if (value) formData.append(key, value);
  }
  return formData;
}

const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

export function uploadDischarge(patientId: string, data: UploadDischargePayload) {
  return api
    .post<IssueDischargeResult>(
      `/patients/${patientId}/discharges/upload`,
      buildUploadForm(data),
      MULTIPART,
    )
    .then((r) => r.data);
}

export function correctUploadDischarge(id: string, data: UploadDischargePayload) {
  return api
    .post<IssueDischargeResult>(
      `/discharges/${id}/correct-upload`,
      buildUploadForm(data),
      MULTIPART,
    )
    .then((r) => r.data);
}

export function downloadDischargePdf(id: string) {
  return api
    .get(`/discharges/${id}/pdf`, { responseType: 'blob' })
    .then((r) => r.data as Blob);
}

export function verifyDischarge(id: string) {
  return api.get<DischargeVerification>(`/discharges/${id}/verify`).then((r) => r.data);
}

export function listDeliveries(dischargeId: string) {
  return api
    .get<DischargeDelivery[]>(`/discharges/${dischargeId}/deliveries`)
    .then((r) => r.data);
}

export function recordDelivery(dischargeId: string, data: RecordDeliveryPayload) {
  return api
    .post<DischargeDelivery>(`/discharges/${dischargeId}/deliveries`, data)
    .then((r) => r.data);
}
