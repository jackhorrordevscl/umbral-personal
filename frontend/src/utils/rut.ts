// Formatea RUT mientras se escribe: 12345678-9 → 12.345.678-9
export function formatRut(value: string): string {
  const clean = value.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted}-${dv}`;
}

// Normaliza RUT para guardar en BD: 12.345.678-9 → 12345678-9
export function normalizeRut(rut: string): string {
  return rut.replace(/\./g, '').trim().toUpperCase();
}

// Valida RUT chileno
export function validateRut(rut: string): boolean {
  const clean = normalizeRut(rut).replace(/-/g, '');
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected =
    remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);

  return dv === expected;
}