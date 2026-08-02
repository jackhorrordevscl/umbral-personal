export function getResourceFromUrl(url: string): string {
  if (url.includes('/consents')) return 'PatientConsent';
  if (url.includes('/patients')) return 'Patient';
  if (url.includes('/consultations')) return 'Consultation';
  if (url.includes('/reports')) return 'Report';
  if (url.includes('/documents')) return 'Document';
  if (url.includes('/shared-files')) return 'SharedFile';
  if (url.includes('/auth/mfa')) return 'MFA';
  if (url.includes('/auth')) return 'Auth';
  return 'Unknown';
}
