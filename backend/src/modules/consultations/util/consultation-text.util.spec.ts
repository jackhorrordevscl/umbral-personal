import {
  buildTestClinicalCrypto,
  buildTestLegacyV3Text,
} from '../../../common/crypto/clinical-text-crypto.testing';
import {
  decryptConsultationRow,
  decryptConsultationRowLenient,
  decryptHistoryEntry,
  decryptHistoryEntryLenient,
  encryptConsultationTexts,
  encryptSnapshotTexts,
} from './consultation-text.util';

// ADR 0004 (opción B): consultReason/intervention/agreements se guardan
// cifrados, tanto en la fila como dentro de ConsultationHistory.snapshot.
// issue #486: cada texto queda ligado al paciente y al campo (enc:v4).
describe('consultation-text util', () => {
  const crypto = buildTestClinicalCrypto();
  const patientId = 'patient-1';
  const texts = {
    consultReason: '<p>Motivo</p>',
    intervention: '<p>Intervención</p>',
    agreements: '<p>Acuerdos</p>',
  };

  it('encryptConsultationTexts cifra los tres textos y conserva agreements null', () => {
    const encrypted = encryptConsultationTexts(texts, crypto, patientId);
    const withoutAgreements = encryptConsultationTexts(
      { ...texts, agreements: null },
      crypto,
      patientId,
    );

    expect(encrypted.consultReason.startsWith('enc:v4:')).toBe(true);
    expect(encrypted.intervention.startsWith('enc:v4:')).toBe(true);
    expect(encrypted.agreements?.startsWith('enc:v4:')).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain('Motivo');
    expect(withoutAgreements.agreements).toBeNull();
  });

  it('decryptConsultationRow descifra los tres textos y conserva el resto de la fila', () => {
    const row = {
      id: 'c1',
      patientId,
      sessionType: 'IN_PERSON',
      ...encryptConsultationTexts(texts, crypto, patientId),
    };

    expect(decryptConsultationRow(row, crypto)).toEqual({
      id: 'c1',
      patientId,
      sessionType: 'IN_PERSON',
      ...texts,
    });
  });

  it('decryptConsultationRow deja pasar el texto plano heredado', () => {
    const row = { ...texts, patientId };

    expect(decryptConsultationRow(row, crypto)).toEqual({
      ...texts,
      patientId,
    });
  });

  it('decryptConsultationRow lee un enc:v3 heredado sin ligar al paciente', () => {
    const legacy = {
      ...texts,
      patientId,
      consultReason: buildTestLegacyV3Text(texts.consultReason),
    };

    expect(decryptConsultationRow(legacy, crypto).consultReason).toBe(
      texts.consultReason,
    );
  });

  it('decryptConsultationRow no descifra una fila movida a otro paciente (issue #486)', () => {
    const row = {
      patientId: 'patient-2',
      ...encryptConsultationTexts(texts, crypto, patientId),
    };

    expect(() => decryptConsultationRow(row, crypto)).toThrow();
  });

  it('decryptConsultationRow no descifra un texto copiado a otro campo (issue #486)', () => {
    const encrypted = encryptConsultationTexts(texts, crypto, patientId);
    const row = {
      patientId,
      ...encrypted,
      intervention: encrypted.consultReason,
    };

    expect(() => decryptConsultationRow(row, crypto)).toThrow();
  });

  it('encryptSnapshotTexts cifra solo los textos clínicos del snapshot', () => {
    const snapshot = encryptSnapshotTexts(
      {
        sessionDate: '2026-10-01T12:00:00.000Z',
        sessionType: 'IN_PERSON',
        ...texts,
      },
      crypto,
      patientId,
    ) as Record<string, unknown>;

    expect(snapshot.sessionDate).toBe('2026-10-01T12:00:00.000Z');
    expect(snapshot.sessionType).toBe('IN_PERSON');
    expect(String(snapshot.consultReason).startsWith('enc:v4:')).toBe(true);
    expect(String(snapshot.intervention).startsWith('enc:v4:')).toBe(true);
    expect(String(snapshot.agreements).startsWith('enc:v4:')).toBe(true);
  });

  it('decryptHistoryEntry descifra el snapshot y conserva el resto de la entrada', () => {
    const snapshot = encryptSnapshotTexts(
      { sessionType: 'ONLINE', ...texts },
      crypto,
      patientId,
    );
    const entry = { id: 'h1', editedBy: { name: 'Ana' }, snapshot };

    expect(decryptHistoryEntry(entry, crypto, patientId)).toEqual({
      id: 'h1',
      editedBy: { name: 'Ana' },
      snapshot: { sessionType: 'ONLINE', ...texts },
    });
  });

  it('decryptHistoryEntry respeta un snapshot con agreements null y uno que no es objeto', () => {
    const withNull = encryptSnapshotTexts(
      { ...texts, agreements: null },
      crypto,
      patientId,
    );

    expect(
      decryptHistoryEntry({ snapshot: withNull }, crypto, patientId).snapshot,
    ).toEqual({ ...texts, agreements: null });
    expect(
      decryptHistoryEntry({ snapshot: null }, crypto, patientId).snapshot,
    ).toBeNull();
  });

  it('decryptHistoryEntry no descifra un snapshot de otro paciente (issue #486)', () => {
    const snapshot = encryptSnapshotTexts({ ...texts }, crypto, 'patient-2');

    expect(() =>
      decryptHistoryEntry({ snapshot }, crypto, patientId),
    ).toThrow();
  });

  describe('lectura tolerante (issue #486)', () => {
    const corrupt = 'enc:v3:0:AAAA';

    it('decryptConsultationRowLenient deja en null solo el texto ilegible y lo informa', () => {
      const encrypted = encryptConsultationTexts(texts, crypto, patientId);
      const row = { id: 'c1', patientId, ...encrypted, intervention: corrupt };

      const result = decryptConsultationRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual(['intervention']);
      expect(result.row).toEqual({
        id: 'c1',
        patientId,
        consultReason: texts.consultReason,
        intervention: null,
        agreements: texts.agreements,
      });
    });

    it('decryptConsultationRowLenient aísla una fila copiada de otro paciente', () => {
      const row = {
        patientId: 'patient-2',
        ...encryptConsultationTexts(texts, crypto, patientId),
      };

      const result = decryptConsultationRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual([
        'consultReason',
        'intervention',
        'agreements',
      ]);
    });

    it('decryptConsultationRowLenient no marca como ilegible un agreements null ni el texto plano heredado', () => {
      const result = decryptConsultationRowLenient(
        { ...texts, agreements: null, patientId },
        crypto,
      );

      expect(result.unreadableFields).toEqual([]);
      expect(result.row).toEqual({ ...texts, agreements: null, patientId });
    });

    it('decryptHistoryEntryLenient deja en null el texto ilegible del snapshot y conserva el resto', () => {
      const snapshot = {
        ...encryptSnapshotTexts(
          { sessionType: 'ONLINE', ...texts },
          crypto,
          patientId,
        ),
        consultReason: corrupt,
      };

      const result = decryptHistoryEntryLenient(
        { id: 'h1', snapshot },
        crypto,
        patientId,
      );

      expect(result.unreadableFields).toEqual(['consultReason']);
      expect(result.entry).toEqual({
        id: 'h1',
        snapshot: { sessionType: 'ONLINE', ...texts, consultReason: null },
      });
    });

    it('decryptHistoryEntryLenient respeta un snapshot que no es objeto', () => {
      const result = decryptHistoryEntryLenient(
        { snapshot: null },
        crypto,
        patientId,
      );

      expect(result.unreadableFields).toEqual([]);
      expect(result.entry.snapshot).toBeNull();
    });
  });
});
