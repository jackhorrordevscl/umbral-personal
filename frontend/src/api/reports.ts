import api from './client';

export function downloadPatientReport(patientId: string) {
  return api
    .get(`/reports/patient/${patientId}`, { responseType: 'blob' })
    .then((r) => r.data as Blob);
}
