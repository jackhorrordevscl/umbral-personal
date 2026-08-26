import { createHash } from 'crypto';

// design.md "Patient code = truncated domain-separated SHA-256 of
// patient.id, keyless": el código deriva únicamente de patient.id (uuid v4,
// 122 bits de entropía, sin PII) -- nunca de rut (prohibido por regla de
// negocio, baja entropía) ni de fullName (PatientsService.update puede
// mutarlo, lo que rompería la estabilidad del código ya publicado en
// Google). Un dominio fijo ("umbral/patient-code/v1|") evita que este hash
// colisione con cualquier otro uso de sha256(id) en el resto del sistema.
const INITIALS_SEP = '-';
const PATIENT_CODE_DOMAIN = 'umbral/patient-code/v1|';
const SHORT_CODE_LENGTH = 6;

// Crockford base32: 32 símbolos, excluye I/L/O/U a propósito -- I/l y O/0 se
// confunden visualmente, y U se reserva para evitar palabras accidentales.
// Los códigos quedan legibles/dictables en voz alta sin ambigüedad.
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

function stripDiacritics(value: string): string {
  // NFD separa cada letra acentuada en base + marca diacrítica combinante
  // (rango U+0300-U+036F); eliminar esas marcas deja "Martínez" ->
  // "Martinez" sin tocar el resto del string.
  return value.normalize('NFD').replace(COMBINING_DIACRITICAL_MARKS, '');
}

// design.md: "Diacritics are NFD-folded, non-letters dropped." -- cada token
// queda reducido a sus letras ASCII; tokens que quedan vacíos (p. ej. un
// guion suelto) se descartan.
function tokenize(fullName: string): string[] {
  return stripDiacritics(fullName)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z]/g, ''))
    .filter((token) => token.length > 0);
}

// Convención chilena "Nombre [Nombre2] Apellido1 [Apellido2]": con 4+ tokens
// el primer apellido es token[2] (segundo nombre presente); con menos, es
// token[1]. Una adivinanza incorrecta (p. ej. nombre compuesto de 3 tokens
// sin segundo apellido) es inofensiva -- el código, no las iniciales, es lo
// que desambigua a dos pacientes (design.md).
function initials(fullName: string): string {
  const tokens = tokenize(fullName);
  if (tokens.length === 0) return '??';

  const surnameIndex = tokens.length >= 4 ? 2 : Math.min(1, tokens.length - 1);
  const first = tokens[0][0];
  const second = tokens[surnameIndex][0];
  return `${first}${second}`.toUpperCase();
}

// Codifica los primeros `length` grupos de 5 bits del buffer en Crockford
// base32. 6 caracteres = 30 bits, cubiertos íntegramente por los primeros 4
// bytes del hash (32 bits) -- nunca se necesita más que un prefijo del
// digest completo de 32 bytes.
function encodeCrockfordBase32(buffer: Buffer, length: number): string {
  let bits = '';
  for (let i = 0; bits.length < length * 5 && i < buffer.length; i++) {
    bits += buffer[i].toString(2).padStart(8, '0');
  }

  let result = '';
  for (let i = 0; i < length; i++) {
    const chunk = bits.slice(i * 5, i * 5 + 5).padEnd(5, '0');
    result += CROCKFORD_ALPHABET[parseInt(chunk, 2)];
  }
  return result;
}

function shortCode(patientId: string): string {
  const hash = createHash('sha256')
    .update(PATIENT_CODE_DOMAIN + patientId)
    .digest();
  return encodeCrockfordBase32(hash, SHORT_CODE_LENGTH);
}

export function patientLabel(patient: {
  id: string;
  fullName: string;
}): string {
  return `${initials(patient.fullName)}${INITIALS_SEP}${shortCode(patient.id)}`;
}
