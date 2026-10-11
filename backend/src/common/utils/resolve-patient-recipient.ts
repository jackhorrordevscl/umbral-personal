import { isMinor } from './age.util';

export interface RecipientGuardian {
  fullName: string;
  email: string | null;
  isPayer: boolean;
  receivesCommunications: boolean;
}

export interface RecipientPatient {
  fullName: string;
  email: string | null;
  birthDate: Date | string;
  // Expected in creation order (oldest first); the first match wins ties.
  guardians: RecipientGuardian[];
}

export interface PatientRecipient {
  kind: 'PATIENT' | 'GUARDIAN';
  email: string | null;
  recipientName: string;
  patientName: string;
}

function hasEmail(guardian: RecipientGuardian): boolean {
  return !!guardian.email;
}

function adult(patient: RecipientPatient): PatientRecipient {
  return {
    kind: 'PATIENT',
    email: patient.email,
    recipientName: patient.fullName,
    patientName: patient.fullName,
  };
}

// Who receives patient-facing communications (payment links, late notices).
// A minor's own email is never used: with no eligible guardian the result is
// a GUARDIAN with a null email, so callers skip instead of falling back.
export function resolvePatientRecipient(
  patient: RecipientPatient,
  now?: Date,
): PatientRecipient {
  if (!isMinor(patient.birthDate, now)) return adult(patient);

  const eligible = patient.guardians.filter(
    (g) => g.receivesCommunications && hasEmail(g),
  );
  const chosen = eligible.find((g) => g.isPayer) ?? eligible[0];
  return {
    kind: 'GUARDIAN',
    email: chosen?.email ?? null,
    recipientName: chosen?.fullName ?? '',
    patientName: patient.fullName,
  };
}

// Who is the payer at the gateway: for a minor, the payer guardian with an
// email, else the first guardian with an email; null if none (never the
// patient's own email).
export function resolvePatientPayerEmail(
  patient: RecipientPatient,
  now?: Date,
): string | null {
  if (!isMinor(patient.birthDate, now)) return patient.email;
  const withEmail = patient.guardians.filter(hasEmail);
  const chosen = withEmail.find((g) => g.isPayer) ?? withEmail[0];
  return chosen?.email ?? null;
}
