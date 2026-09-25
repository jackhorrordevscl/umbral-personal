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
) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('patientId', patientId);
  formData.append('type', type);
  if (consultationGroupId) formData.append('consultationGroupId', consultationGroupId);
  return api.post('/documents/upload', formData, {
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
