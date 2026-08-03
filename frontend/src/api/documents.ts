import api from './client';
import type { PatientDocument } from '../types/patient';

export function listPatientDocuments(patientId: string) {
  return api.get<PatientDocument[]>(`/documents/patient/${patientId}`).then((r) => r.data);
}

export function uploadPatientDocument(patientId: string, file: File, type: string) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('patientId', patientId);
  formData.append('type', type);
  return api.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function downloadDocument(id: string) {
  return api.get(`/documents/${id}/download`, { responseType: 'blob' }).then((r) => r.data as Blob);
}
