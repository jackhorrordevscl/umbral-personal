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

const SNAPSHOT_TEXT_KEYS = [
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

// Solo transforma los tres textos clínicos de un snapshot con forma de objeto;
// cualquier otro valor (null, arreglo, escalar) se devuelve sin tocar.
function mapSnapshotTexts<T>(
  snapshot: T,
  transform: (value: string) => string,
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
  for (const key of SNAPSHOT_TEXT_KEYS) {
    const value = mapped[key];
    if (typeof value === 'string') mapped[key] = transform(value);
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
