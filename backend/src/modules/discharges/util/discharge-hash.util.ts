import { createHash, timingSafeEqual } from 'node:crypto';

// Hash de integridad del informe de alta (firma simple + hash, decisión del
// 2026-10-08). SHA-256 sobre un JSON canónico: claves ordenadas
// recursivamente, fechas en ISO UTC y undefined tratado como null, de modo que
// el resultado no depende del orden de inserción ni del motor que serialice.
//
// El hash cubre el contenido del informe, el snapshot del firmante, la versión
// (posición en la cadena), issuedAt y los identificadores que lo anclan
// (informe, paciente, terapeuta y grupo). Alterar cualquiera de esos campos en
// la base hace fallar la verificación.

export interface DischargeHashContent {
  source: string;
  closureReason: string;
  dropoutReason: string | null;
  dropoutNote: string | null;
  referralDestination: string | null;
  admissionDate: Date;
  dischargeDate: Date;
  sessionCount: number;
  consultReason: string;
  diagnosis: string | null;
  evolutionSummary: string;
  statusAtDischarge: string;
  recommendations: string;
}

export interface DischargeHashInput {
  dischargeId: string;
  patientId: string;
  therapistId: string;
  groupId: string;
  version: number;
  issuedAt: Date;
  content: DischargeHashContent;
  signer: {
    name: string | null;
    rut: string | null;
    professionalRegistration: string | null;
  };
}

// Subconjunto de la fila TreatmentDischarge que alimenta el hash.
export interface DischargeHashRow {
  id: string;
  patientId: string;
  therapistId: string;
  groupId: string;
  version: number;
  source: string;
  closureReason: string;
  dropoutReason: string | null;
  dropoutNote: string | null;
  referralDestination: string | null;
  admissionDate: Date;
  dischargeDate: Date;
  sessionCount: number;
  consultReason: string;
  diagnosis: string | null;
  evolutionSummary: string;
  statusAtDischarge: string;
  recommendations: string;
  signerName: string | null;
  signerRut: string | null;
  signerProfessionalRegistration: string | null;
  issuedAt: Date | null;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeDischargeHash(input: DischargeHashInput): string {
  return createHash('sha256')
    .update(canonicalJson(input), 'utf8')
    .digest('hex');
}

export function dischargeHashInputFromRow(
  row: DischargeHashRow,
): DischargeHashInput {
  if (!row.issuedAt) {
    throw new Error(
      'El informe no tiene issuedAt: no se puede calcular el hash',
    );
  }
  return {
    dischargeId: row.id,
    patientId: row.patientId,
    therapistId: row.therapistId,
    groupId: row.groupId,
    version: row.version,
    issuedAt: row.issuedAt,
    content: {
      source: row.source,
      closureReason: row.closureReason,
      dropoutReason: row.dropoutReason,
      dropoutNote: row.dropoutNote,
      referralDestination: row.referralDestination,
      admissionDate: row.admissionDate,
      dischargeDate: row.dischargeDate,
      sessionCount: row.sessionCount,
      consultReason: row.consultReason,
      diagnosis: row.diagnosis,
      evolutionSummary: row.evolutionSummary,
      statusAtDischarge: row.statusAtDischarge,
      recommendations: row.recommendations,
    },
    signer: {
      name: row.signerName,
      rut: row.signerRut,
      professionalRegistration: row.signerProfessionalRegistration,
    },
  };
}

// Comparación en tiempo constante; un hash ausente o de otro largo nunca coincide.
export function hashesMatch(
  expected: string,
  actual: string | null | undefined,
): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
