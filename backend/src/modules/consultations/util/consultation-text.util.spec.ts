import { buildTestClinicalCrypto } from '../../../common/crypto/clinical-text-crypto.testing';
import {
  decryptConsultationRow,
  decryptHistoryEntry,
  encryptConsultationTexts,
  encryptSnapshotTexts,
} from './consultation-text.util';

// ADR 0004 (opción B): consultReason/intervention/agreements se guardan
// cifrados, tanto en la fila como dentro de ConsultationHistory.snapshot.
describe('consultation-text util', () => {
  const crypto = buildTestClinicalCrypto();
  const texts = {
    consultReason: '<p>Motivo</p>',
    intervention: '<p>Intervención</p>',
    agreements: '<p>Acuerdos</p>',
  };

  it('encryptConsultationTexts cifra los tres textos y conserva agreements null', () => {
    const encrypted = encryptConsultationTexts(texts, crypto);
    const withoutAgreements = encryptConsultationTexts(
      { ...texts, agreements: null },
      crypto,
    );

    expect(encrypted.consultReason.startsWith('enc:v3:')).toBe(true);
    expect(encrypted.intervention.startsWith('enc:v3:')).toBe(true);
    expect(encrypted.agreements?.startsWith('enc:v3:')).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain('Motivo');
    expect(withoutAgreements.agreements).toBeNull();
  });

  it('decryptConsultationRow descifra los tres textos y conserva el resto de la fila', () => {
    const row = {
      id: 'c1',
      sessionType: 'IN_PERSON',
      ...encryptConsultationTexts(texts, crypto),
    };

    expect(decryptConsultationRow(row, crypto)).toEqual({
      id: 'c1',
      sessionType: 'IN_PERSON',
      ...texts,
    });
  });

  it('decryptConsultationRow deja pasar el texto plano heredado', () => {
    const row = { ...texts };

    expect(decryptConsultationRow(row, crypto)).toEqual(texts);
  });

  it('encryptSnapshotTexts cifra solo los textos clínicos del snapshot', () => {
    const snapshot = encryptSnapshotTexts(
      {
        sessionDate: '2026-10-01T12:00:00.000Z',
        sessionType: 'IN_PERSON',
        ...texts,
      },
      crypto,
    ) as Record<string, unknown>;

    expect(snapshot.sessionDate).toBe('2026-10-01T12:00:00.000Z');
    expect(snapshot.sessionType).toBe('IN_PERSON');
    expect(String(snapshot.consultReason).startsWith('enc:v3:')).toBe(true);
    expect(String(snapshot.intervention).startsWith('enc:v3:')).toBe(true);
    expect(String(snapshot.agreements).startsWith('enc:v3:')).toBe(true);
  });

  it('decryptHistoryEntry descifra el snapshot y conserva el resto de la entrada', () => {
    const snapshot = encryptSnapshotTexts(
      { sessionType: 'ONLINE', ...texts },
      crypto,
    );
    const entry = { id: 'h1', editedBy: { name: 'Ana' }, snapshot };

    expect(decryptHistoryEntry(entry, crypto)).toEqual({
      id: 'h1',
      editedBy: { name: 'Ana' },
      snapshot: { sessionType: 'ONLINE', ...texts },
    });
  });

  it('decryptHistoryEntry respeta un snapshot con agreements null y uno que no es objeto', () => {
    const withNull = encryptSnapshotTexts(
      { ...texts, agreements: null },
      crypto,
    );

    expect(
      decryptHistoryEntry({ snapshot: withNull }, crypto).snapshot,
    ).toEqual({ ...texts, agreements: null });
    expect(decryptHistoryEntry({ snapshot: null }, crypto).snapshot).toBeNull();
  });
});
