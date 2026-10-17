import { ClinicalTextCryptoService } from '../../../common/crypto/clinical-text-crypto.service';

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

// Cifra solo los textos presentes: `undefined` se omite (no tocar la columna)
// y `null` se conserva (limpiar un campo nullable).
export function encryptDischargeTexts<T extends object>(
  data: T,
  crypto: ClinicalTextCryptoService,
): T {
  const out = { ...data } as Record<string, unknown>;
  for (const field of DISCHARGE_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = crypto.encrypt(value);
  }
  return out as T;
}

export function decryptDischargeRow<T extends object>(
  row: T,
  crypto: ClinicalTextCryptoService,
): T {
  const out = { ...row } as Record<string, unknown>;
  for (const field of DISCHARGE_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = crypto.decrypt(value);
  }
  return out as T;
}
