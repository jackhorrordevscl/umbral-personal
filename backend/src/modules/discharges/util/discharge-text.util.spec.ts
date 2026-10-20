import { buildTestClinicalCrypto } from '../../../common/crypto/clinical-text-crypto.testing';
import {
  decryptDischargeRow,
  decryptDischargeRowLenient,
  DISCHARGE_TEXT_FIELDS,
  encryptDischargeTexts,
} from './discharge-text.util';

// ADR 0004 (opción B): los textos libres del informe de alta se guardan
// cifrados; hacia fuera (API, PDF, hash) siempre salen en claro.
describe('discharge-text util', () => {
  const crypto = buildTestClinicalCrypto();

  const allTexts = {
    consultReason: 'Motivo reservado',
    diagnosis: 'Diagnóstico reservado',
    evolutionSummary: 'Evolución reservada',
    statusAtDischarge: 'Estado reservado',
    recommendations: 'Recomendaciones reservadas',
    dropoutNote: 'Nota reservada',
    referralDestination: 'Destino reservado',
  };

  it('cubre los siete textos libres del informe', () => {
    expect([...DISCHARGE_TEXT_FIELDS].sort()).toEqual(
      Object.keys(allTexts).sort(),
    );
  });

  it('encryptDischargeTexts cifra los textos presentes y no toca el resto', () => {
    const encrypted = encryptDischargeTexts(
      { ...allTexts, closureReason: 'DISCHARGED', sessionCount: 4 },
      crypto,
    );

    for (const field of DISCHARGE_TEXT_FIELDS) {
      expect(String(encrypted[field]).startsWith('enc:v3:')).toBe(true);
    }
    expect(JSON.stringify(encrypted)).not.toContain('reservad');
    expect(encrypted.closureReason).toBe('DISCHARGED');
    expect(encrypted.sessionCount).toBe(4);
  });

  it('encryptDischargeTexts omite los campos ausentes y conserva null', () => {
    const encrypted = encryptDischargeTexts(
      { consultReason: 'Motivo', dropoutNote: null },
      crypto,
    );

    expect(Object.keys(encrypted).sort()).toEqual([
      'consultReason',
      'dropoutNote',
    ]);
    expect(encrypted.dropoutNote).toBeNull();
    expect(String(encrypted.consultReason).startsWith('enc:v3:')).toBe(true);
  });

  it('encryptDischargeTexts cifra también la cadena vacía', () => {
    const encrypted = encryptDischargeTexts({ diagnosis: '' }, crypto);

    expect(String(encrypted.diagnosis).startsWith('enc:v3:')).toBe(true);
    expect(decryptDischargeRow(encrypted, crypto).diagnosis).toBe('');
  });

  it('decryptDischargeRow devuelve los textos en claro y conserva el resto de la fila', () => {
    const row = {
      id: 'd1',
      version: 2,
      correctedBy: { id: 'd2' },
      ...encryptDischargeTexts(allTexts, crypto),
    };

    expect(decryptDischargeRow(row, crypto)).toEqual({
      id: 'd1',
      version: 2,
      correctedBy: { id: 'd2' },
      ...allTexts,
    });
  });

  it('decryptDischargeRow deja pasar el texto plano heredado y el valor vacío por defecto', () => {
    const row = {
      consultReason: '',
      diagnosis: null,
      recommendations: 'Plano',
    };

    expect(decryptDischargeRow(row, crypto)).toEqual(row);
  });

  describe('decryptDischargeRowLenient', () => {
    const tampered = (value: string) => `${value.slice(0, -4)}AAAA`;

    it('descifra todo y no informa campos ilegibles cuando la fila está sana', () => {
      const row = { id: 'd1', ...encryptDischargeTexts(allTexts, crypto) };

      expect(decryptDischargeRowLenient(row, crypto)).toEqual({
        row: { id: 'd1', ...allTexts },
        unreadableFields: [],
      });
    });

    it('deja en null solo el campo alterado, informa su nombre y descifra el resto', () => {
      const encrypted = encryptDischargeTexts(allTexts, crypto);
      const row = {
        id: 'd1',
        ...encrypted,
        diagnosis: tampered(encrypted.diagnosis),
      };

      const result = decryptDischargeRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual(['diagnosis']);
      expect(result.row).toEqual({ id: 'd1', ...allTexts, diagnosis: null });
    });

    it('trata como ilegible un valor enc:v3 con una clave ausente del llavero', () => {
      const row = { consultReason: 'enc:v3:99:AAAAAAAAAAAAAAAAAAAAAAAA' };

      const result = decryptDischargeRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual(['consultReason']);
      expect(result.row.consultReason).toBeNull();
    });

    it('decryptDischargeRow estricto sigue lanzando ante un campo alterado', () => {
      const encrypted = encryptDischargeTexts(allTexts, crypto);

      expect(() =>
        decryptDischargeRow(
          { ...encrypted, diagnosis: tampered(encrypted.diagnosis) },
          crypto,
        ),
      ).toThrow();
    });
  });
});
