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

// Bloque Menores (M5): quién otorga el consentimiento, tramo etario y estado
// de regularización del representante legal. Los calcula el backend.
export type ConsentGrantor = "PATIENT" | "GUARDIAN";
export type AgeBand = "ADULT" | "UNDER_14" | "AGE_14_17";
export type MinorStatus = "NOT_MINOR" | "OK" | "MISSING_GUARDIAN" | "LEGACY_CONSENT";

export type GuardianRelationship =
  | "MOTHER"
  | "FATHER"
  | "LEGAL_GUARDIAN"
  | "CURATOR"
  | "CAREGIVER"
  | "OTHER";
export type CustodyType = "SOLE" | "SHARED" | "UNKNOWN";

export const GUARDIAN_RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  MOTHER: "Madre",
  FATHER: "Padre",
  LEGAL_GUARDIAN: "Tutor legal",
  CURATOR: "Curador",
  CAREGIVER: "Cuidador",
  OTHER: "Otro",
};

export const CUSTODY_LABELS: Record<CustodyType, string> = {
  SOLE: "Cuidado personal exclusivo",
  SHARED: "Cuidado personal compartido",
  UNKNOWN: "No informado",
};

export interface LegalGuardian {
  id: string;
  patientId: string;
  fullName: string;
  rut: string;
  relationship: GuardianRelationship;
  email: string | null;
  phone: string | null;
  isPayer: boolean;
  receivesCommunications: boolean;
  canAccessReports: boolean;
  canConsent: boolean;
  custody: CustodyType;
  hasConflict: boolean;
}

export type AssentAction = "GRANTED" | "REFUSED" | "WITHDRAWN" | "INFORMED_AND_HEARD";

export const ASSENT_ACTION_LABELS: Record<AssentAction, string> = {
  GRANTED: "Asentimiento otorgado",
  REFUSED: "Asentimiento rechazado",
  WITHDRAWN: "Asentimiento retirado",
  INFORMED_AND_HEARD: "Informado y oído",
};

export interface PatientAssent {
  id: string;
  patientId: string;
  ageBand: Exclude<AgeBand, "ADULT">;
  action: AssentAction;
  note: string | null;
  documentId: string | null;
  recordedAt: string;
  recordedBy?: { id: string; name: string; role: string };
}

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
  isMinor: boolean;
  ageBand: AgeBand;
  guardianCount: number;
  minorStatus: MinorStatus;
  // Fecha (YYYY-MM-DD) desde la que el consentimiento de un menor debe venir
  // de un representante; el backend la expone para mostrar el plazo.
  guardianEnforcementDate?: string;
  guardians?: LegalGuardian[];
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
  // Sugerencia de usuarios: resumen de sesión subido desde el modal de nueva
  // consulta, atado a Consultation.groupId (ver migración
  // add_consultation_summary_document).
  consultationGroupId?: string | null;
  // Issue #270: anulación con motivo (sin borrado físico). Un documento
  // anulado sigue listado y descargable por custodia.
  voidedAt?: string | null;
  voidedById?: string | null;
  voidReason?: string | null;
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
  // Motivo del último rechazo de la pasarela (ej. monto bajo el mínimo);
  // null si el cobro no ha fallado.
  lastError: string | null;
  amount: number;
}

// issue #163: mismo shape que ConsultationsService.ReminderEmailStatus
// devuelve por groupId en GET /consultations/patient/:id y
// GET /consultations/range -- null si nunca se despachó un recordatorio por
// email para esta consulta. deliveredAt/openedAt los setea el webhook de
// Resend, nunca se infieren en el frontend.
export type ReminderEmailDispatchStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface ReminderEmailStatus {
  status: ReminderEmailDispatchStatus;
  deliveredAt: string | null;
  openedAt: string | null;
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
  reminderEmailStatus: ReminderEmailStatus | null;
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
