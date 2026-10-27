import {
  ClinicalTextCryptoService,
  clinicalContext,
} from '../../../common/crypto/clinical-text-crypto.service';

// ADR 0004 (opción B): textos libres de un informe de alta. Se guardan cifrados
// en la fila; hacia fuera (API, PDF, hash de contenido) siempre salen en claro.
export const DISCHARGE_TEXT_FIELDS = [
  'consultReason',
  'diagnosis',
  'evolutionSummary',
  'statusAtDischarge',
  'recommendations',
  'dropoutNote',
  'referralDestination',
] as const;

export type DischargeTextField = (typeof DISCHARGE_TEXT_FIELDS)[number];

// issue #486: cada texto se cifra ligado al paciente y al campo (enc:v4). El
// campo lleva el tipo de registro: una consulta también tiene `consultReason` y
// no debe poder intercambiarse con el del informe.
export const dischargeTextContext = (
  patientId: string,
  field: DischargeTextField,
) => clinicalContext('patient', patientId, `discharge.${field}`);

// Cifra solo los textos presentes: `undefined` se omite (no tocar la columna)
// y `null` se conserva (limpiar un campo nullable).
export function encryptDischargeTexts<T extends object>(
  data: T,
  crypto: ClinicalTextCryptoService,
  patientId: string,
): T {
  const out = { ...data } as Record<string, unknown>;
  for (const field of DISCHARGE_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') {
      out[field] = crypto.encrypt(
        value,
        dischargeTextContext(patientId, field),
      );
    }
  }
  return out as T;
}

// Lectura tolerante, solo para respuestas que no calculan hashes ni reescriben
// el texto: un campo que no se puede descifrar (valor alterado, movido de
// paciente o campo, o clave ausente del llavero) queda en null y se informa su
// nombre, sin tumbar el resto de la fila. Nunca la uses para emitir o corregir:
// ahí un texto a medias sería un hash que no corresponde al contenido.
export function decryptDischargeRowLenient<T extends { patientId: string }>(
  row: T,
  crypto: ClinicalTextCryptoService,
): { row: T; unreadableFields: DischargeTextField[] } {
  const out = { ...row } as Record<string, unknown>;
  const unreadableFields: DischargeTextField[] = [];
  for (const field of DISCHARGE_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value !== 'string') continue;
    try {
      out[field] = crypto.decrypt(
        value,
        dischargeTextContext(row.patientId, field),
      );
    } catch {
      out[field] = null;
      unreadableFields.push(field);
    }
  }
  return { row: out as T, unreadableFields };
}

export function decryptDischargeRow<T extends { patientId: string }>(
  row: T,
  crypto: ClinicalTextCryptoService,
): T {
  const out = { ...row } as Record<string, unknown>;
  for (const field of DISCHARGE_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') {
      out[field] = crypto.decrypt(
        value,
        dischargeTextContext(row.patientId, field),
      );
    }
  }
  return out as T;
}
