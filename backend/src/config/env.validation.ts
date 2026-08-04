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

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Los valores de env var son siempre string | undefined en la práctica, pero
// el tipo declarado es unknown -- este helper evita el "[object Object]" que
// String() produciría si alguna vez no lo son.
function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// main.ts lee estas cuatro env vars directo de process.env (CORS, puerto,
// flag de migraciones) sin pasar por ConfigService -- se validan acá igual,
// porque ConfigModule.forRoot ejecuta este validate() antes de que main.ts
// llegue a usarlas, así que un typo revienta el arranque con un mensaje
// claro en vez de un 500/CORS roto/puerto inválido en runtime.
function validateMainTsEnvVars(config: Record<string, unknown>): void {
  if (config.PORT !== undefined) {
    const port = Number(config.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `PORT inválido: "${describeValue(config.PORT)}" no es un puerto válido (1-65535).`,
      );
    }
  }

  for (const varName of ['FRONTEND_URL', 'LAN_DEV_URL'] as const) {
    const value = config[varName];
    if (
      value !== undefined &&
      (typeof value !== 'string' || !isValidUrl(value))
    ) {
      throw new Error(
        `${varName} inválida: "${describeValue(value)}" no es una URL válida.`,
      );
    }
  }

  if (
    config.RUN_MIGRATIONS !== undefined &&
    config.RUN_MIGRATIONS !== 'true' &&
    config.RUN_MIGRATIONS !== 'false'
  ) {
    throw new Error(
      `RUN_MIGRATIONS inválido: "${describeValue(config.RUN_MIGRATIONS)}" -- debe ser exactamente "true" o "false".`,
    );
  }
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  validateMainTsEnvVars(config);

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
