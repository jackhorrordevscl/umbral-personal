// Issue #196: CreatePatientDto valida el formato del RUT, así que las
// fixtures e2e ya no pueden usar strings arbitrarios. Patient.rut es único,
// por eso cada llamada devuelve un valor distinto (formato válido, dígito
// verificador no comprobado: el DTO solo valida forma).
let counter = 0;

export function uniqueTestRut(): string {
  counter += 1;
  const body = String(
    10_000_000 + ((Date.now() + counter * 7919) % 89_999_999),
  );
  return `${body}-${counter % 10}`;
}
