// T6.1 (issue #27): consentimiento granular por finalidad (Ley 21.719).
export type ConsentPurpose = "TREATMENT" | "TELEMEDICINE";
export type ConsentStatus = Record<ConsentPurpose, boolean>;

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  TREATMENT: "Tratamiento",
  TELEMEDICINE: "Telemedicina",
};

export const EMPTY_CONSENTS: ConsentStatus = {
  TREATMENT: false,
  TELEMEDICINE: false,
};

export interface Patient {
  id: string;
  fullName: string;
  rut: string;
  birthDate: string;
  phone: string;
  email: string;
  occupation: string;
  consents: ConsentStatus;
  emergencyContactName: string;
  emergencyContactPhone: string;
  treatingPsychiatrist: string;
  treatingDoctor: string;
  address: string;
}

export interface PatientHistoryEntry {
  id: string;
  changedAt: string;
  reason: string;
  diff: Record<string, { from: unknown; to: unknown }>;
  changedBy: { id: string; name: string; role: string };
}

export interface PatientDocument {
  id: string;
  fileName: string;
  type: string;
  uploadedAt: string;
}

export const FIELD_LABELS: Record<string, string> = {
  fullName: "Nombre completo",
  rut: "RUT",
  birthDate: "Fecha de nacimiento",
  occupation: "Ocupación",
  phone: "Teléfono",
  email: "Email",
  address: "Dirección",
  emergencyContactName: "Contacto emergencia",
  emergencyContactPhone: "Teléfono emergencia",
  treatingPsychiatrist: "Psiquiatra tratante",
  treatingDoctor: "Médico tratante",
  isActive: "Activo",
};
