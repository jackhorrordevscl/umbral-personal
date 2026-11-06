import {
  ClinicalTextCryptoService,
  clinicalContext,
} from '../../../common/crypto/clinical-text-crypto.service';

// issue #634: la evidencia de un consentimiento y el motivo de anulación de un
// documento son textos libres que pueden nombrar al paciente o a su familia, así
// que se guardan cifrados como los demás textos clínicos (ADR 0004), ligados al
// paciente y al campo (enc:v4), y siempre salen en claro por la API.
export const CONSENT_TEXT_FIELDS = ['evidence'] as const;
export type ConsentTextField = (typeof CONSENT_TEXT_FIELDS)[number];

export const DOCUMENT_TEXT_FIELDS = ['voidReason'] as const;
export type DocumentTextField = (typeof DOCUMENT_TEXT_FIELDS)[number];

export const consentTextContext = (
  patientId: string,
  field: ConsentTextField,
) => clinicalContext('patient', patientId, `consent.${field}`);

export const documentTextContext = (
  patientId: string,
  field: DocumentTextField,
) => clinicalContext('patient', patientId, `document.${field}`);

export const encryptConsentEvidence = (
  evidence: string,
  crypto: ClinicalTextCryptoService,
  patientId: string,
): string =>
  crypto.encrypt(evidence, consentTextContext(patientId, 'evidence'));

export function decryptConsentRow<
  T extends { evidence: string; patientId: string },
>(row: T, crypto: ClinicalTextCryptoService): T {
  return {
    ...row,
    evidence: crypto.decrypt(
      row.evidence,
      consentTextContext(row.patientId, 'evidence'),
    ),
  };
}

export const encryptDocumentVoidReason = (
  reason: string,
  crypto: ClinicalTextCryptoService,
  patientId: string,
): string =>
  crypto.encrypt(reason, documentTextContext(patientId, 'voidReason'));

export function decryptDocumentRow<
  T extends { voidReason?: string | null; patientId: string },
>(row: T, crypto: ClinicalTextCryptoService): T {
  if (row.voidReason === undefined || row.voidReason === null) return row;
  return {
    ...row,
    voidReason: crypto.decryptNullable(
      row.voidReason,
      documentTextContext(row.patientId, 'voidReason'),
    ),
  };
}
