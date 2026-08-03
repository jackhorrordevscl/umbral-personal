import api from './client';
import type { ConsentPurpose, Patient, PatientHistoryEntry } from '../types/patient';

export interface CreatePatientPayload {
  fullName: string;
  rut: string;
  birthDate: string;
  occupation?: string;
  phone?: string;
  email?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  treatingPsychiatrist?: string;
  treatingDoctor?: string;
}

export function listPatients() {
  return api.get<Patient[]>('/patients').then((r) => r.data);
}

export function getPatient(id: string) {
  return api.get<Patient>(`/patients/${id}`).then((r) => r.data);
}

export function createPatient(data: CreatePatientPayload) {
  return api.post<Patient>('/patients', data).then((r) => r.data);
}

export function updatePatient(id: string, data: Record<string, unknown>) {
  return api.patch(`/patients/${id}`, data).then((r) => r.data);
}

export function deletePatient(id: string) {
  return api.delete(`/patients/${id}`);
}

export function getPatientHistory(id: string) {
  return api.get<PatientHistoryEntry[]>(`/patients/${id}/history`).then((r) => r.data);
}

export function recordPatientConsent(
  id: string,
  purpose: ConsentPurpose,
  action: 'GRANT' | 'REVOKE',
  evidence: string,
) {
  return api.post(`/patients/${id}/consents`, { purpose, action, evidence });
}
