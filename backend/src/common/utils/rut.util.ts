// Issue #289: RUT chileno. Forma canónica: sin puntos, con guion, dígito
// verificador K en mayúscula y sin ceros iniciales (ej. "12345678-5"), para
// que un mismo RUT escrito de distintas formas no genere fichas duplicadas.

export function computeRutCheckDigit(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

export function normalizeRut(rut: string): string {
  const compact = rut.replace(/\./g, '').trim().toUpperCase();
  const match = /^(\d+)-([\dK])$/.exec(compact);
  if (!match) return compact;
  const body = match[1].replace(/^0+(?=\d)/, '');
  return `${body}-${match[2]}`;
}

// Valida el dígito verificador (módulo 11) de un RUT en cualquier formato
// aceptado (con o sin puntos). La forma de los puntos la valida RUT_FORMAT
// en el DTO.
export function isValidRut(rut: unknown): boolean {
  if (typeof rut !== 'string') return false;
  const match = /^(\d+)-([\dK])$/.exec(normalizeRut(rut));
  if (!match) return false;
  return computeRutCheckDigit(match[1]) === match[2];
}
