import {
  buildTestClinicalCrypto,
  buildTestLegacyV3Text,
} from '../../../common/crypto/clinical-text-crypto.testing';
import {
  decryptDischargeRow,
  decryptDischargeRowLenient,
  DISCHARGE_TEXT_FIELDS,
  encryptDischargeTexts,
} from './discharge-text.util';

// ADR 0004 (opción B): los textos libres del informe de alta se guardan
// cifrados; hacia fuera (API, PDF, hash) siempre salen en claro. issue #486:
// cada texto queda ligado al paciente y al campo (enc:v4).
describe('discharge-text util', () => {
  const crypto = buildTestClinicalCrypto();
  const patientId = 'patient-1';

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
      patientId,
    );

    for (const field of DISCHARGE_TEXT_FIELDS) {
      expect(String(encrypted[field]).startsWith('enc:v4:')).toBe(true);
    }
    expect(JSON.stringify(encrypted)).not.toContain('reservad');
    expect(encrypted.closureReason).toBe('DISCHARGED');
    expect(encrypted.sessionCount).toBe(4);
  });

  it('encryptDischargeTexts omite los campos ausentes y conserva null', () => {
    const encrypted = encryptDischargeTexts(
      { consultReason: 'Motivo', dropoutNote: null },
      crypto,
      patientId,
    );

    expect(Object.keys(encrypted).sort()).toEqual([
      'consultReason',
      'dropoutNote',
    ]);
    expect(encrypted.dropoutNote).toBeNull();
    expect(String(encrypted.consultReason).startsWith('enc:v4:')).toBe(true);
  });

  it('encryptDischargeTexts cifra también la cadena vacía', () => {
    const encrypted = encryptDischargeTexts(
      { diagnosis: '' },
      crypto,
      patientId,
    );

    expect(String(encrypted.diagnosis).startsWith('enc:v4:')).toBe(true);
    expect(
      decryptDischargeRow({ patientId, ...encrypted }, crypto).diagnosis,
    ).toBe('');
  });

  it('decryptDischargeRow devuelve los textos en claro y conserva el resto de la fila', () => {
    const row = {
      id: 'd1',
      patientId,
      version: 2,
      correctedBy: { id: 'd2' },
      ...encryptDischargeTexts(allTexts, crypto, patientId),
    };

    expect(decryptDischargeRow(row, crypto)).toEqual({
      id: 'd1',
      patientId,
      version: 2,
      correctedBy: { id: 'd2' },
      ...allTexts,
    });
  });

  it('decryptDischargeRow deja pasar el texto plano heredado y el valor vacío por defecto', () => {
    const row = {
      patientId,
      consultReason: '',
      diagnosis: null,
      recommendations: 'Plano',
    };

    expect(decryptDischargeRow(row, crypto)).toEqual(row);
  });

  it('decryptDischargeRow lee un enc:v3 heredado sin ligar al paciente', () => {
    const row = { patientId, diagnosis: buildTestLegacyV3Text('Heredado') };

    expect(decryptDischargeRow(row, crypto).diagnosis).toBe('Heredado');
  });

  // issue #486: copiar un texto cifrado a otro paciente o campo lo invalida.
  it('decryptDischargeRow no descifra un informe movido a otro paciente', () => {
    const row = {
      patientId: 'patient-2',
      ...encryptDischargeTexts(allTexts, crypto, patientId),
    };

    expect(() => decryptDischargeRow(row, crypto)).toThrow();
  });

  it('decryptDischargeRow no descifra un texto copiado a otro campo', () => {
    const encrypted = encryptDischargeTexts(allTexts, crypto, patientId);

    expect(() =>
      decryptDischargeRow(
        { patientId, ...encrypted, diagnosis: encrypted.consultReason },
        crypto,
      ),
    ).toThrow();
  });

  describe('decryptDischargeRowLenient', () => {
    const tampered = (value: string) => `${value.slice(0, -4)}AAAA`;

    it('descifra todo y no informa campos ilegibles cuando la fila está sana', () => {
      const row = {
        id: 'd1',
        patientId,
        ...encryptDischargeTexts(allTexts, crypto, patientId),
      };

      expect(decryptDischargeRowLenient(row, crypto)).toEqual({
        row: { id: 'd1', patientId, ...allTexts },
        unreadableFields: [],
      });
    });

    it('deja en null solo el campo alterado, informa su nombre y descifra el resto', () => {
      const encrypted = encryptDischargeTexts(allTexts, crypto, patientId);
      const row = {
        id: 'd1',
        patientId,
        ...encrypted,
        diagnosis: tampered(encrypted.diagnosis),
      };

      const result = decryptDischargeRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual(['diagnosis']);
      expect(result.row).toEqual({
        id: 'd1',
        patientId,
        ...allTexts,
        diagnosis: null,
      });
    });

    it('aísla un texto copiado de otro paciente sin tumbar el resto de la fila', () => {
      const foreign = encryptDischargeTexts(
        { diagnosis: 'De otro paciente' },
        crypto,
        'patient-2',
      );
      const row = {
        patientId,
        ...encryptDischargeTexts(allTexts, crypto, patientId),
        diagnosis: foreign.diagnosis,
      };

      const result = decryptDischargeRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual(['diagnosis']);
      expect(result.row.consultReason).toBe(allTexts.consultReason);
    });

    it('trata como ilegible un valor enc:v3 con una clave ausente del llavero', () => {
      const row = {
        patientId,
        consultReason: 'enc:v3:99:AAAAAAAAAAAAAAAAAAAAAAAA',
      };

      const result = decryptDischargeRowLenient(row, crypto);

      expect(result.unreadableFields).toEqual(['consultReason']);
      expect(result.row.consultReason).toBeNull();
    });

    it('decryptDischargeRow estricto sigue lanzando ante un campo alterado', () => {
      const encrypted = encryptDischargeTexts(allTexts, crypto, patientId);

      expect(() =>
        decryptDischargeRow(
          { patientId, ...encrypted, diagnosis: tampered(encrypted.diagnosis) },
          crypto,
        ),
      ).toThrow();
    });
  });
});
