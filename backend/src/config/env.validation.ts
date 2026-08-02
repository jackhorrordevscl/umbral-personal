import { createHash } from 'crypto';

// SHA-256 de los valores de ejemplo que aparecen en README.md e install.sh
// (nunca el valor en claro, para no gatillar escaneo de secretos en el repo):
// si alguien copia el .env de ejemplo tal cual a producción, JWT_SECRET
// quedaría en un valor público y conocido por cualquiera que lea el repo.
const KNOWN_EXAMPLE_SECRET_HASHES = new Set([
  'e7d778b255dad9e190ffa1b2118f5992eb2b74f21ed7ed74bdf5fe2299c0d2fa', // README.md
  '051dcc7f90a515a2d0674da7f13d78fa71a183a2b5526ec995dc98c3d8add684', // install.sh
]);

// Mismo criterio que arriba, pero para DOCUMENT_ENCRYPTION_KEY (T8.1, issue
// #58): el valor de ejemplo de README.md/.env.example/install.sh es público,
// así que en producción se rechaza igual que un JWT_SECRET de ejemplo.
const KNOWN_EXAMPLE_DOCUMENT_KEY_HASHES = new Set([
  'bfd70f22ed33a32b2847176ccf1508589f36b5a53d6a9cb009cf991b25e6245a', // README.md / install.sh
]);

const MIN_JWT_SECRET_LENGTH = 32;
const DOCUMENT_ENCRYPTION_KEY_BYTE_LENGTH = 32;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.NODE_ENV === 'production') {
    const secret =
      typeof config.JWT_SECRET === 'string' ? config.JWT_SECRET : '';

    if (
      secret.length < MIN_JWT_SECRET_LENGTH ||
      KNOWN_EXAMPLE_SECRET_HASHES.has(sha256(secret))
    ) {
      throw new Error(
        `JWT_SECRET inválido: en producción debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres y no puede ser el valor de ejemplo de README.md/install.sh.`,
      );
    }

    const documentKeyRaw =
      typeof config.DOCUMENT_ENCRYPTION_KEY === 'string'
        ? config.DOCUMENT_ENCRYPTION_KEY
        : '';
    const documentKeyBytes = Buffer.from(documentKeyRaw, 'base64');

    if (
      documentKeyBytes.length !== DOCUMENT_ENCRYPTION_KEY_BYTE_LENGTH ||
      KNOWN_EXAMPLE_DOCUMENT_KEY_HASHES.has(sha256(documentKeyRaw))
    ) {
      throw new Error(
        `DOCUMENT_ENCRYPTION_KEY inválida: en producción debe decodificar a ${DOCUMENT_ENCRYPTION_KEY_BYTE_LENGTH} bytes en base64 y no puede ser el valor de ejemplo de README.md/.env.example/install.sh. Generala con: openssl rand -base64 32`,
      );
    }
  }

  return config;
}
