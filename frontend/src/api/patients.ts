import api from './client';
import type {
  AssentAction,
  ConsentGrantor,
  ConsentPurpose,
  ConsentStatus,
  CustodyType,
  GuardianRelationship,
  LegalGuardian,
  Patient,
  PatientAssent,
  PatientHistoryEntry,
} from '../types/patient';

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

// issue #290: GET /patients siempre responde paginado ({ data, total, page,
// pageSize }) y filtra por nombre/RUT en el servidor con `search`. Sin
// page/pageSize el backend usa página 1 de 50.
export interface ListPatientsParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PatientsPage {
  data: Patient[];
  total: number;
  page: number;
  pageSize: number;
}

export function listPatients(params: ListPatientsParams = {}) {
  const search = params.search?.trim();
  return api
    .get<PatientsPage>('/patients', {
      params: { page: params.page, pageSize: params.pageSize, search: search || undefined },
    })
    .then((r) => r.data);
}

// issue #290: contadores del dashboard sin traer la lista.
export interface PatientsSummary {
  total: number;
  withConsent: number;
}

export function getPatientsSummary() {
  return api.get<PatientsSummary>('/patients/summary').then((r) => r.data);
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
  // Bloque Menores: solo para el GRANT de un menor (GUARDIAN + guardianId).
  // Un adulto nunca debe enviarlos.
  grantor?: { grantedBy: ConsentGrantor; guardianId?: string },
) {
  return api.post(`/patients/${id}/consents`, {
    purpose,
    action,
    evidence,
    ...(grantor ? { grantedBy: grantor.grantedBy, guardianId: grantor.guardianId } : {}),
  });
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

// Bloque Menores (M5): representantes legales (máximo 2 por paciente).
export interface GuardianPayload {
  fullName: string;
  rut: string;
  relationship: GuardianRelationship;
  email?: string;
  phone?: string;
  isPayer?: boolean;
  receivesCommunications?: boolean;
  canAccessReports?: boolean;
  canConsent?: boolean;
  custody?: CustodyType;
  hasConflict?: boolean;
}

export function listGuardians(patientId: string) {
  return api.get<LegalGuardian[]>(`/patients/${patientId}/guardians`).then((r) => r.data);
}

export function createGuardian(patientId: string, data: GuardianPayload) {
  return api.post<LegalGuardian>(`/patients/${patientId}/guardians`, data).then((r) => r.data);
}

export function updateGuardian(
  patientId: string,
  guardianId: string,
  data: Partial<GuardianPayload>,
) {
  return api
    .patch<LegalGuardian>(`/patients/${patientId}/guardians/${guardianId}`, data)
    .then((r) => r.data);
}

// 409 si algún consentimiento referencia al representante.
export function deleteGuardian(patientId: string, guardianId: string) {
  return api.delete(`/patients/${patientId}/guardians/${guardianId}`);
}

// Ledger append-only de asentimiento del menor (sin PATCH ni DELETE).
export interface AssentPayload {
  action: AssentAction;
  note?: string;
}

export function listAssents(patientId: string) {
  return api.get<PatientAssent[]>(`/patients/${patientId}/assents`).then((r) => r.data);
}

export function recordAssent(patientId: string, data: AssentPayload) {
  return api.post<PatientAssent>(`/patients/${patientId}/assents`, data).then((r) => r.data);
}
