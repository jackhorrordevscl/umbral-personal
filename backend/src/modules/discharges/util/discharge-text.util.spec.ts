import { buildTestClinicalCrypto } from '../../../common/crypto/clinical-text-crypto.testing';
import {
  decryptDischargeRow,
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
});
