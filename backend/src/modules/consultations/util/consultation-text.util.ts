import { Prisma } from '@prisma/client';
import {
  ClinicalTextCryptoService,
  clinicalContext,
} from '../../../common/crypto/clinical-text-crypto.service';

// ADR 0004 (opción B): textos clínicos libres de una consulta. Se guardan
// cifrados en la fila y dentro de ConsultationHistory.snapshot; hacia fuera
// (API, PDF) siempre salen en claro.
//
// issue #486: cada texto se cifra ligado al paciente y al campo (enc:v4). La
// fila de una consulta trae su `patientId`; un snapshot no, así que quien lo
// cifra o descifra lo pasa (es el mismo de la consulta a la que pertenece).
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

export type ConsultationTextKey = (typeof CONSULTATION_TEXT_KEYS)[number];

// Contexto de cifrado de un campo de texto de una consulta (fila o snapshot).
// El campo lleva el tipo de registro: un informe de alta también tiene
// `consultReason` y no debe poder intercambiarse con el de una consulta.
export const consultationTextContext = (
  patientId: string,
  field: ConsultationTextKey,
) => clinicalContext('patient', patientId, `consultation.${field}`);

export function encryptConsultationTexts(
  texts: ConsultationTexts,
  crypto: ClinicalTextCryptoService,
  patientId: string,
): ConsultationTexts & { agreements: string | null } {
  return {
    consultReason: crypto.encrypt(
      texts.consultReason,
      consultationTextContext(patientId, 'consultReason'),
    ),
    intervention: crypto.encrypt(
      texts.intervention,
      consultationTextContext(patientId, 'intervention'),
    ),
    agreements: crypto.encryptNullable(
      texts.agreements,
      consultationTextContext(patientId, 'agreements'),
    ),
  };
}

export function decryptConsultationRow<
  T extends ConsultationTexts & { patientId: string },
>(row: T, crypto: ClinicalTextCryptoService): T {
  return {
    ...row,
    consultReason: crypto.decrypt(
      row.consultReason,
      consultationTextContext(row.patientId, 'consultReason'),
    ),
    intervention: crypto.decrypt(
      row.intervention,
      consultationTextContext(row.patientId, 'intervention'),
    ),
    agreements: crypto.decryptNullable(
      row.agreements,
      consultationTextContext(row.patientId, 'agreements'),
    ),
  };
}

// Lectura tolerante, solo para respuestas que no reescriben el texto: un campo
// que no se puede descifrar (valor alterado, movido de paciente o campo, o clave
// ausente del llavero) queda en null y se informa su nombre, sin tumbar el resto
// de la fila. Nunca la uses antes de corregir: re-cifrar un texto a medias
// pisaría el original.
export function decryptConsultationRowLenient<
  T extends ConsultationTexts & { patientId: string },
>(
  row: T,
  crypto: ClinicalTextCryptoService,
): { row: T; unreadableFields: ConsultationTextKey[] } {
  const out = { ...row } as Record<string, unknown>;
  const unreadableFields: ConsultationTextKey[] = [];
  for (const key of CONSULTATION_TEXT_KEYS) {
    const value = out[key];
    if (typeof value !== 'string') continue;
    try {
      out[key] = crypto.decrypt(
        value,
        consultationTextContext(row.patientId, key),
      );
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
  patientId: string,
): T {
  return mapSnapshotTexts(snapshot, (value, key) =>
    crypto.encrypt(value, consultationTextContext(patientId, key)),
  );
}

export function decryptHistoryEntry<
  T extends { snapshot: Prisma.JsonValue | null },
>(entry: T, crypto: ClinicalTextCryptoService, patientId: string): T {
  return {
    ...entry,
    snapshot: mapSnapshotTexts(entry.snapshot, (value, key) =>
      crypto.decrypt(value, consultationTextContext(patientId, key)),
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
  patientId: string,
): { entry: T; unreadableFields: ConsultationTextKey[] } {
  const unreadableFields: ConsultationTextKey[] = [];
  const snapshot = mapSnapshotTexts(entry.snapshot, (value, key) => {
    try {
      return crypto.decrypt(value, consultationTextContext(patientId, key));
    } catch {
      unreadableFields.push(key);
      return null;
    }
  });
  return { entry: { ...entry, snapshot }, unreadableFields };
}
