import type { TreatmentStatus } from "./patient";

// Informe de alta (T5b). Mirrors backend/prisma/schema.prisma model
// TreatmentDischarge; dates arrive as ISO strings.
export type ClosureReason = Exclude<TreatmentStatus, "ACTIVE">;
export type DischargeSource = "GENERATED" | "UPLOADED";
export type DischargeStatus = "DRAFT" | "ISSUED";

export type DropoutReason =
  | "IMPROVEMENT_WITHOUT_AGREED_DISCHARGE"
  | "NO_PERCEIVED_IMPROVEMENT"
  | "DISSATISFACTION_WITH_BOND_OR_APPROACH"
  | "COST"
  | "SCHEDULE_CONFLICT"
  | "LOW_MOTIVATION_OR_STIGMA"
  | "PREFERS_ALTERNATIVE"
  | "THERAPIST_REFERRAL"
  | "RELOCATION_OR_ACCESS"
  | "HEALTH_ISSUE"
  | "OTHER_LIFE_EVENT"
  | "OTHER"
  | "NO_CONTACT";

export const TREATMENT_STATUS_LABELS: Record<TreatmentStatus, string> = {
  ACTIVE: "En tratamiento",
  DISCHARGED: "Alta",
  REFERRED: "Derivado",
  DROPPED_OUT: "Deserción",
};

export const CLOSURE_REASONS: ClosureReason[] = ["DISCHARGED", "REFERRED", "DROPPED_OUT"];

export const DROPOUT_REASON_LABELS: Record<DropoutReason, string> = {
  IMPROVEMENT_WITHOUT_AGREED_DISCHARGE: "Mejoría sin alta acordada",
  NO_PERCEIVED_IMPROVEMENT: "Sin mejoría percibida",
  DISSATISFACTION_WITH_BOND_OR_APPROACH: "Insatisfacción con el vínculo o el enfoque",
  COST: "Costo",
  SCHEDULE_CONFLICT: "Horario o compromisos",
  LOW_MOTIVATION_OR_STIGMA: "Baja motivación o estigma",
  PREFERS_ALTERNATIVE: "Prefiere otra opción",
  THERAPIST_REFERRAL: "Derivación decidida por el terapeuta",
  RELOCATION_OR_ACCESS: "Cambio de ciudad o dificultad de acceso",
  HEALTH_ISSUE: "Problema de salud",
  OTHER_LIFE_EVENT: "Otro evento de vida",
  OTHER: "Otro",
  NO_CONTACT: "Sin contacto o sin información",
};

export const DISCHARGE_SOURCE_LABELS: Record<DischargeSource, string> = {
  GENERATED: "Generado por el sistema",
  UPLOADED: "PDF propio del terapeuta",
};

export interface TreatmentDischarge {
  id: string;
  patientId: string;
  groupId: string;
  version: number;
  correctsId: string | null;
  source: DischargeSource;
  status: DischargeStatus;
  closureReason: ClosureReason;
  dropoutReason: DropoutReason | null;
  dropoutNote: string | null;
  referralDestination: string | null;
  admissionDate: string;
  dischargeDate: string;
  sessionCount: number;
  consultReason: string;
  diagnosis: string | null;
  evolutionSummary: string;
  statusAtDischarge: string;
  recommendations: string;
  issuedAt: string | null;
  contentHash: string | null;
  documentId: string | null;
  pdfSha256: string | null;
  createdAt?: string;
}

export interface ClosurePayload {
  closureReason: ClosureReason;
  dropoutReason?: DropoutReason;
  dropoutNote?: string;
  referralDestination?: string;
}

// PATCH /discharges/:id. null clears the optional fields.
export interface UpdateDischargePayload {
  closureReason?: ClosureReason;
  dropoutReason?: DropoutReason | null;
  dropoutNote?: string | null;
  referralDestination?: string | null;
  admissionDate?: string;
  dischargeDate?: string;
  sessionCount?: number;
  consultReason?: string;
  diagnosis?: string | null;
  evolutionSummary?: string;
  statusAtDischarge?: string;
  recommendations?: string;
}

export interface UploadDischargePayload extends ClosurePayload {
  file: File;
  dischargeDate?: string;
}

export interface CancellationPreview {
  count: number;
  consultations: { id: string; groupId: string; sessionDate: string }[];
}

export interface IssueDischargeResult extends TreatmentDischarge {
  cancelledConsultations: number;
}

export interface DischargeVerification {
  valid: boolean;
  dischargeId: string;
  groupId: string;
  version: number;
  status: DischargeStatus;
  issuedAt: string | null;
  contentHash: string | null;
  isCurrent: boolean;
  pdf: { present: boolean; intact: boolean | null };
  source: DischargeSource;
  providedByTherapist: boolean;
  // CONTENT: el hash cubre el contenido del informe. FILE_ONLY: solo los bytes
  // del PDF subido (los datos del cierre quedan fuera).
  hashScope: "CONTENT" | "FILE_ONLY";
}

// Entrega del informe de alta (T4c). Mirrors backend model DischargeDelivery.
export type DischargeRecipientType = "PATIENT" | "GUARDIAN" | "THIRD_PARTY";
export type DischargeDeliveryChannel = "IN_PERSON" | "EMAIL" | "POSTAL" | "OTHER";

export const RECIPIENT_TYPE_LABELS: Record<DischargeRecipientType, string> = {
  PATIENT: "Paciente",
  GUARDIAN: "Representante legal",
  THIRD_PARTY: "Tercero",
};

export const DELIVERY_CHANNEL_LABELS: Record<DischargeDeliveryChannel, string> = {
  IN_PERSON: "En persona",
  EMAIL: "Email",
  POSTAL: "Correo postal",
  OTHER: "Otro",
};

export const DELIVERY_PURPOSE_MAX = 200;
export const DELIVERY_RECIPIENT_NAME_MAX = 120;

export interface DischargeDelivery {
  id: string;
  dischargeId: string;
  recipientType: DischargeRecipientType;
  recipientName: string;
  guardianId: string | null;
  authorizationDocumentId: string | null;
  // Fecha en que se anuló la autorización, si ocurrió después de la entrega.
  authorizationVoidedAt?: string | null;
  authorizationAttested: boolean;
  purpose: string;
  channel: DischargeDeliveryChannel;
  deliveredAt: string;
}

export interface RecordDeliveryPayload {
  recipientType: DischargeRecipientType;
  // Solo con THIRD_PARTY.
  recipientName?: string;
  // Solo con GUARDIAN.
  guardianId?: string;
  // Solo con THIRD_PARTY (obligatoria).
  authorizationDocumentId?: string;
  // Solo con THIRD_PARTY (obligatoria, true): el terapeuta declara que revisó
  // la autorización. Umbral no comprueba el documento.
  authorizationAttested?: boolean;
  purpose: string;
  channel: DischargeDeliveryChannel;
}
