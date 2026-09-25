import api from './client';
import type { ConsentPurpose, ConsentStatus, Patient, PatientHistoryEntry } from '../types/patient';

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
  // sdd/online-payment-integration PR 3 (T9.7): backend DTO
  // (create-patient.dto.ts, PR 1) -- ausente/undefined = sin cobro
  // automático para este paciente.
  defaultSessionAmount?: number;
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

// issue #157: agregación en backend (PatientsService.getAcquisitionStats,
// mismo criterio que getConsultationStats -- issue #40) -- ordenado por
// count descendente, 'directo' como label para pacientes sin origen
// registrado.
export interface AcquisitionStat {
  source: string;
  count: number;
}

export function getAcquisitionStats() {
  return api.get<AcquisitionStat[]>('/patients/stats/acquisition').then((r) => r.data);
}

export function recordPatientConsent(
  id: string,
  purpose: ConsentPurpose,
  action: 'GRANT' | 'REVOKE',
  evidence: string,
) {
  return api.post(`/patients/${id}/consents`, { purpose, action, evidence });
}

export function getPatientConsentStatus(id: string) {
  return api.get<ConsentStatus>(`/patients/${id}/consents/status`).then((r) => r.data);
}

// Issue #131 (T5): declaración retroactiva en bloque para pacientes que ya
// estaban en tratamiento antes de que el consentimiento fuera obligatorio.
export interface BulkConsentResult {
  patientId: string;
  ok: boolean;
  error?: string;
}

export function bulkDeclarePatientConsent(
  patientIds: string[],
  purpose: ConsentPurpose,
  evidence: string,
) {
  return api
    .post<BulkConsentResult[]>('/patients/consents/bulk-declare', {
      patientIds,
      purpose,
      evidence,
    })
    .then((r) => r.data);
}
