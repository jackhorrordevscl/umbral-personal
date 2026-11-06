import {
  ClinicalTextCryptoService,
  clinicalContext,
} from '../../../common/crypto/clinical-text-crypto.service';

// issue #634: la nota libre del asentimiento de un NNA es un texto clínico, así
// que se guarda cifrada igual que los de consulta e informe de alta (ADR 0004),
// ligada al paciente y al campo (enc:v4) y siempre sale en claro por la API.
export const ASSENT_TEXT_FIELDS = ['note'] as const;

export type AssentTextField = (typeof ASSENT_TEXT_FIELDS)[number];

export const assentTextContext = (patientId: string, field: AssentTextField) =>
  clinicalContext('patient', patientId, `assent.${field}`);

export function encryptAssentNote(
  note: string | null,
  crypto: ClinicalTextCryptoService,
  patientId: string,
): string | null {
  return crypto.encryptNullable(note, assentTextContext(patientId, 'note'));
}

export function decryptAssentRow<
  T extends { note: string | null; patientId: string },
>(row: T, crypto: ClinicalTextCryptoService): T {
  return {
    ...row,
    note: crypto.decryptNullable(
      row.note,
      assentTextContext(row.patientId, 'note'),
    ),
  };
}
