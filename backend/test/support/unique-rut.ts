import { computeRutCheckDigit } from '../../src/common/utils/rut.util';

// Issue #196/#289: CreatePatientDto valida forma y dígito verificador del RUT,
// así que las fixtures e2e deben ser RUT válidos. Patient.rut es único por
// terapeuta, por eso cada llamada devuelve un valor distinto.
let counter = 0;

export function uniqueTestRut(): string {
  counter += 1;
  const body = String(
    10_000_000 + ((Date.now() + counter * 7919) % 89_999_999),
  );
  return `${body}-${computeRutCheckDigit(body)}`;
}
