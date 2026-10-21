import api from './client';
import type { PatientDocument } from '../types/patient';

export function listPatientDocuments(patientId: string) {
  return api.get<PatientDocument[]>(`/documents/patient/${patientId}`).then((r) => r.data);
}

export function uploadPatientDocument(
  patientId: string,
  file: File,
  type: string,
  consultationGroupId?: string,
  // Bloque NNA: representante que otorga el consentimiento de un NNA.
  // El servidor fija grantedBy; el cliente solo indica quién.
  guardianId?: string,
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('patientId', patientId);
  formData.append('type', type);
  if (consultationGroupId) formData.append('consultationGroupId', consultationGroupId);
  if (guardianId) formData.append('guardianId', guardianId);
  // consentRecorded solo viaja (en false) si el documento se guardó pero el
  // evento de consentimiento no se pudo registrar.
  return api.post<{ consentRecorded?: false }>('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

// Issue #270: anulación con motivo obligatorio (5 a 500 caracteres). No borra
// nada: el documento sigue listado y descargable.
export function voidPatientDocument(id: string, reason: string) {
  return api.post<PatientDocument>(`/documents/${id}/void`, { reason }).then((r) => r.data);
}

export function downloadDocument(id: string) {
  return api.get(`/documents/${id}/download`, { responseType: 'blob' }).then((r) => r.data as Blob);
}
