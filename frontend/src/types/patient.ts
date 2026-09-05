// T6.1 (issue #27): consentimiento granular por finalidad (Ley 21.719).
export type ConsentPurpose = "TREATMENT" | "TELEMEDICINE";
export type ConsentStatus = Record<ConsentPurpose, boolean>;

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  TREATMENT: "Presencial",
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
  // sdd/online-payment-integration PR 3 (T9.7): monto de sesión por defecto
  // usado por PaymentsService.ensureCharge para snapshotear el amount de
  // cada cargo -- null/undefined significa "sin monto configurado", el
  // paciente simplemente nunca genera cargo (backend: Patient.
  // defaultSessionAmount, schema.prisma).
  defaultSessionAmount?: number | null;
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

export interface ConsultationHistory {
  id: string;
  editedAt: string;
  editedBy: { name: string; email: string };
  snapshot: {
    sessionDate: string;
    consultReason: string;
    intervention: string;
    agreements?: string;
    nextSessionDate?: string;
    sessionType: string;
  };
}

// sdd/online-payment-integration PR 3 (T9.6): mismo shape que
// ConsultationsService.getPaymentMap devuelve por groupId en
// GET /consultations/patient/:id -- Payment no tiene FK a Consultation
// (design.md "Decision: Payment keyed on groupId"), así que llega resuelto
// en la propia fila en vez de un `include` de Prisma.
export type PaymentStatus = 'PENDING' | 'PAID' | 'LATE' | 'CANCELLED';
export type PaymentLinkDelivery =
  | 'PENDING'
  | 'SENT'
  | 'SKIPPED_NO_EMAIL'
  | 'FAILED';

export interface PaymentSummary {
  groupId: string;
  status: PaymentStatus;
  linkDelivery: PaymentLinkDelivery;
  paymentUrl: string | null;
  amount: number;
}

export interface Consultation {
  id: string;
  groupId: string;
  patientId: string;
  sessionDate: string;
  consultReason: string;
  intervention: string;
  agreements: string;
  nextSessionDate: string;
  sessionType: string;
  therapist: { name: string; email: string };
  history: ConsultationHistory[];
  payment: PaymentSummary | null;
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
  defaultSessionAmount: "Monto de sesión por defecto",
};
