import { readFileSync } from 'fs';
import { join } from 'path';
import { validateEnv } from './env.validation';

// Se extraen del archivo real en vez de copiarlas como literales para (a) no
// gatillar escaneo de secretos con un string con forma de credencial y (b)
// detectar si README.md/install.sh cambian su valor de ejemplo sin actualizar
// env.validation.ts.
function extractExample(filePath: string, varName: string): string {
  const content = readFileSync(filePath, 'utf-8');
  const pattern = new RegExp(`${varName}="([^"]+)"`, 'g');
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Se esperaba exactamente un ${varName} de ejemplo en ${filePath}, se encontraron ${matches.length}`,
    );
  }
  return matches[0][1];
}

const readmePath = join(__dirname, '../../../README.md');
const installShPath = join(__dirname, '../../../install.sh');

const readmeExampleSecret = extractExample(readmePath, 'JWT_SECRET');
const installShExampleSecret = extractExample(installShPath, 'JWT_SECRET');

const readmeExampleDocumentKey = extractExample(
  readmePath,
  'DOCUMENT_ENCRYPTION_KEY',
);
const installShExampleDocumentKey = extractExample(
  installShPath,
  'DOCUMENT_ENCRYPTION_KEY',
);

// Clave válida (32 bytes en base64) para no interferir con los tests de
// JWT_SECRET, que no le conciernen a DOCUMENT_ENCRYPTION_KEY.
const validDocumentKey = Buffer.alloc(32, 7).toString('base64');

describe('validateEnv', () => {
  it('permite un JWT_SECRET largo y no genérico en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un JWT_SECRET demasiado corto en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'corto',
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('rechaza el valor de ejemplo de README.md en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: readmeExampleSecret,
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('rechaza el valor de ejemplo de install.sh en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: installShExampleSecret,
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('rechaza JWT_SECRET ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(/JWT_SECRET inválido/);
  });

  it('no valida JWT_SECRET fuera de producción', () => {
    const config = { NODE_ENV: 'test', JWT_SECRET: 'corto' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite un DOCUMENT_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un DOCUMENT_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString('base64'),
    };

    expect(() => validateEnv(config)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza el valor de ejemplo de README.md/install.sh para DOCUMENT_ENCRYPTION_KEY en producción', () => {
    expect(readmeExampleDocumentKey).toBe(installShExampleDocumentKey);

    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: readmeExampleDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza DOCUMENT_ENCRYPTION_KEY ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
    };

    expect(() => validateEnv(config)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY inválida/,
    );
  });

  it('no valida DOCUMENT_ENCRYPTION_KEY fuera de producción', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });
});
