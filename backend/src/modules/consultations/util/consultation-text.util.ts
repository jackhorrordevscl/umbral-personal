import { Prisma } from '@prisma/client';
import { ClinicalTextCryptoService } from '../../../common/crypto/clinical-text-crypto.service';

// ADR 0004 (opción B): textos clínicos libres de una consulta. Se guardan
// cifrados en la fila y dentro de ConsultationHistory.snapshot; hacia fuera
// (API, PDF) siempre salen en claro.
export interface ConsultationTexts {
  consultReason: string;
  intervention: string;
  agreements?: string | null;
}

export const CONSULTATION_TEXT_KEYS = [
  'consultReason',
  'intervention',
  'agreements',
] as const;

export function encryptConsultationTexts(
  texts: ConsultationTexts,
  crypto: ClinicalTextCryptoService,
): ConsultationTexts & { agreements: string | null } {
  return {
    consultReason: crypto.encrypt(texts.consultReason),
    intervention: crypto.encrypt(texts.intervention),
    agreements: crypto.encryptNullable(texts.agreements),
  };
}

export function decryptConsultationRow<T extends ConsultationTexts>(
  row: T,
  crypto: ClinicalTextCryptoService,
): T {
  return {
    ...row,
    consultReason: crypto.decrypt(row.consultReason),
    intervention: crypto.decrypt(row.intervention),
    agreements: crypto.decryptNullable(row.agreements),
  };
}

export type ConsultationTextKey = (typeof CONSULTATION_TEXT_KEYS)[number];

// Lectura tolerante, solo para respuestas que no reescriben el texto: un campo
// que no se puede descifrar (valor alterado o clave ausente del llavero) queda
// en null y se informa su nombre, sin tumbar el resto de la fila. Nunca la uses
// antes de corregir: re-cifrar un texto a medias pisaría el original.
export function decryptConsultationRowLenient<T extends ConsultationTexts>(
  row: T,
  crypto: ClinicalTextCryptoService,
): { row: T; unreadableFields: ConsultationTextKey[] } {
  const out = { ...row } as Record<string, unknown>;
  const unreadableFields: ConsultationTextKey[] = [];
  for (const key of CONSULTATION_TEXT_KEYS) {
    const value = out[key];
    if (typeof value !== 'string') continue;
    try {
      out[key] = crypto.decrypt(value);
    } catch {
      out[key] = null;
      unreadableFields.push(key);
    }
  }
  return { row: out as T, unreadableFields };
}

// Solo transforma los tres textos clínicos de un snapshot con forma de objeto;
// cualquier otro valor (null, arreglo, escalar) se devuelve sin tocar.
function mapSnapshotTexts<T>(
  snapshot: T,
  transform: (value: string, key: ConsultationTextKey) => string | null,
): T {
  if (
    snapshot === null ||
    snapshot === undefined ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return snapshot;
  }
  const mapped = { ...snapshot } as Record<string, unknown>;
  for (const key of CONSULTATION_TEXT_KEYS) {
    const value = mapped[key];
    if (typeof value === 'string') mapped[key] = transform(value, key);
  }
  return mapped as T;
}

export function encryptSnapshotTexts<T extends Prisma.InputJsonValue>(
  snapshot: T,
  crypto: ClinicalTextCryptoService,
): T {
  return mapSnapshotTexts(snapshot, (value) => crypto.encrypt(value));
}

export function decryptHistoryEntry<
  T extends { snapshot: Prisma.JsonValue | null },
>(entry: T, crypto: ClinicalTextCryptoService): T {
  return {
    ...entry,
    snapshot: mapSnapshotTexts(entry.snapshot, (value) =>
      crypto.decrypt(value),
    ),
  };
}

// Variante tolerante de decryptHistoryEntry (ver decryptConsultationRowLenient):
// el texto ilegible del snapshot queda en null y su nombre en `unreadableFields`.
export function decryptHistoryEntryLenient<
  T extends { snapshot: Prisma.JsonValue | null },
>(
  entry: T,
  crypto: ClinicalTextCryptoService,
): { entry: T; unreadableFields: ConsultationTextKey[] } {
  const unreadableFields: ConsultationTextKey[] = [];
  const snapshot = mapSnapshotTexts(entry.snapshot, (value, key) => {
    try {
      return crypto.decrypt(value);
    } catch {
      unreadableFields.push(key);
      return null;
    }
  });
  return { entry: { ...entry, snapshot }, unreadableFields };
}
