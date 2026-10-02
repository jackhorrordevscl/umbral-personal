import { computeRutCheckDigit, isValidRut, normalizeRut } from './rut.util';

describe('rut.util (issue #289)', () => {
  describe('computeRutCheckDigit', () => {
    it.each([
      ['12345678', '5'],
      ['11111111', '1'],
      ['6', 'K'],
      ['10000013', 'K'],
      ['76086428', '5'],
    ])('calcula el dígito de %s', (body, dv) => {
      expect(computeRutCheckDigit(body)).toBe(dv);
    });

    it('devuelve 0 cuando el resto es 11', () => {
      expect(computeRutCheckDigit('14')).toBe('0');
    });
  });

  describe('normalizeRut', () => {
    it.each([
      ['12.345.678-5', '12345678-5'],
      ['12345678-5', '12345678-5'],
      ['012345678-5', '12345678-5'],
      ['01.234.567-4', '1234567-4'],
      [' 10.000.013-k ', '10000013-K'],
    ])('normaliza "%s" a "%s"', (input, expected) => {
      expect(normalizeRut(input)).toBe(expected);
    });

    it('formas distintas del mismo RUT convergen al mismo string', () => {
      const forms = ['12.345.678-5', '12345678-5', '012345678-5'];
      expect(new Set(forms.map(normalizeRut)).size).toBe(1);
    });
  });

  describe('isValidRut', () => {
    it.each(['12345678-5', '12.345.678-5', '10000013-K', '10.000.013-k'])(
      'acepta %s',
      (rut) => {
        expect(isValidRut(rut)).toBe(true);
      },
    );

    it.each(['12345678-9', '12345678-K', '11111111-2', '', 'abc', '12345678'])(
      'rechaza "%s"',
      (rut) => {
        expect(isValidRut(rut)).toBe(false);
      },
    );

    it('rechaza valores que no son string', () => {
      expect(isValidRut(undefined)).toBe(false);
      expect(isValidRut(123456785)).toBe(false);
    });
  });
});
