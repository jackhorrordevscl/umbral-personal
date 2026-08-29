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

// sdd/google-calendar-integration PR 1: mismo criterio que
// DOCUMENT_ENCRYPTION_KEY -- el valor de ejemplo de README.md/install.sh es
// público, así que se rechaza igual en producción.
const readmeExampleGoogleTokenKey = extractExample(
  readmePath,
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
);
const installShExampleGoogleTokenKey = extractExample(
  installShPath,
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
);

// sdd/online-payment-integration PR 1: mismo criterio que
// GOOGLE_TOKEN_ENCRYPTION_KEY -- el valor de ejemplo del README es público,
// así que se rechaza igual en producción.
const readmeExamplePaymentKey = extractExample(
  readmePath,
  'PAYMENT_CREDENTIALS_ENCRYPTION_KEY',
);

// Clave válida (32 bytes en base64) para no interferir con los tests de
// JWT_SECRET, que no le conciernen a DOCUMENT_ENCRYPTION_KEY.
const validDocumentKey = Buffer.alloc(32, 7).toString('base64');

// Idem para GOOGLE_TOKEN_ENCRYPTION_KEY -- valor distinto al de
// validDocumentKey para no confundir cuál validación falla si un test se
// rompe.
const validGoogleTokenKey = Buffer.alloc(32, 11).toString('base64');

// Idem para PAYMENT_CREDENTIALS_ENCRYPTION_KEY -- valor distinto a los
// anteriores.
const validPaymentKey = Buffer.alloc(32, 13).toString('base64');

describe('validateEnv', () => {
  it('permite un JWT_SECRET largo y no genérico en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
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
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
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

  // sdd/google-calendar-integration PR 1: GOOGLE_TOKEN_ENCRYPTION_KEY sigue
  // exactamente el mismo criterio que DOCUMENT_ENCRYPTION_KEY (design.md
  // "Dedicated GOOGLE_TOKEN_ENCRYPTION_KEY, not DOCUMENT_ENCRYPTION_KEY") --
  // clave AES-256-GCM propia, distinta, requerida en producción.
  it('permite un GOOGLE_TOKEN_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un GOOGLE_TOKEN_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 11).toString('base64'),
    };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza el valor de ejemplo de README.md/install.sh para GOOGLE_TOKEN_ENCRYPTION_KEY en producción', () => {
    expect(readmeExampleGoogleTokenKey).toBe(installShExampleGoogleTokenKey);

    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: readmeExampleGoogleTokenKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza GOOGLE_TOKEN_ENCRYPTION_KEY ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_TOKEN_ENCRYPTION_KEY inválida/,
    );
  });

  it('no valida GOOGLE_TOKEN_ENCRYPTION_KEY fuera de producción', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite PORT/FRONTEND_URL/LAN_DEV_URL/RUN_MIGRATIONS válidos', () => {
    const config = {
      NODE_ENV: 'test',
      PORT: '3001',
      FRONTEND_URL: 'https://umbral.example.com',
      LAN_DEV_URL: 'http://192.168.1.100:5173',
      RUN_MIGRATIONS: 'true',
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un PORT que no es un puerto válido', () => {
    const config = { NODE_ENV: 'test', PORT: 'abc' };

    expect(() => validateEnv(config)).toThrow(/PORT inválido/);
  });

  it('rechaza un PORT fuera de rango', () => {
    const config = { NODE_ENV: 'test', PORT: '70000' };

    expect(() => validateEnv(config)).toThrow(/PORT inválido/);
  });

  it('rechaza un FRONTEND_URL que no es una URL válida', () => {
    const config = { NODE_ENV: 'test', FRONTEND_URL: 'no-es-una-url' };

    expect(() => validateEnv(config)).toThrow(/FRONTEND_URL inválida/);
  });

  it('rechaza un LAN_DEV_URL que no es una URL válida', () => {
    const config = { NODE_ENV: 'test', LAN_DEV_URL: 'no-es-una-url' };

    expect(() => validateEnv(config)).toThrow(/LAN_DEV_URL inválida/);
  });

  it('rechaza un RUN_MIGRATIONS que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', RUN_MIGRATIONS: 'ture' };

    expect(() => validateEnv(config)).toThrow(/RUN_MIGRATIONS inválido/);
  });

  it('permite RUN_MIGRATIONS="false"', () => {
    const config = { NODE_ENV: 'test', RUN_MIGRATIONS: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/session-reminders PR 2 (T4.5): REMINDERS_ENABLED es opcional
  // (RemindersService trata "ausente" como habilitado por default), pero si
  // está presente debe ser exactamente "true" o "false" -- mismo criterio
  // que RUN_MIGRATIONS, para que un typo falle rápido en el arranque en vez
  // de silenciosamente desactivar el cron.
  it('rechaza un REMINDERS_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', REMINDERS_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(/REMINDERS_ENABLED inválido/);
  });

  it('permite REMINDERS_ENABLED="false"', () => {
    const config = { NODE_ENV: 'test', REMINDERS_ENABLED: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite REMINDERS_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/google-calendar-integration PR 1 (design.md, "Migration / Rollout"):
  // mismo criterio que REMINDERS_ENABLED -- opcional, GOOGLE_CALENDAR_SYNC_ENABLED
  // ausente lo trata CalendarSyncService (PR 2) como habilitado por default,
  // pero un typo en el valor debe fallar rápido en el arranque.
  it('rechaza un GOOGLE_CALENDAR_SYNC_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', GOOGLE_CALENDAR_SYNC_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(
      /GOOGLE_CALENDAR_SYNC_ENABLED inválido/,
    );
  });

  it('permite GOOGLE_CALENDAR_SYNC_ENABLED="false"', () => {
    const config = { NODE_ENV: 'test', GOOGLE_CALENDAR_SYNC_ENABLED: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite GOOGLE_CALENDAR_SYNC_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/online-payment-integration PR 1: mismo criterio que
  // REMINDERS_ENABLED/GOOGLE_CALENDAR_SYNC_ENABLED -- opcional, PaymentsService
  // (PR 2) trata "ausente" como habilitado por default, pero un typo en el
  // valor debe fallar rápido en el arranque en vez de desactivar el flujo de
  // pagos en silencio.
  it('rechaza un PAYMENTS_ENABLED que no es "true" ni "false"', () => {
    const config = { NODE_ENV: 'test', PAYMENTS_ENABLED: 'nope' };

    expect(() => validateEnv(config)).toThrow(/PAYMENTS_ENABLED inválido/);
  });

  it('permite PAYMENTS_ENABLED="false"', () => {
    const config = { NODE_ENV: 'test', PAYMENTS_ENABLED: 'false' };

    expect(validateEnv(config)).toBe(config);
  });

  it('permite PAYMENTS_ENABLED ausente', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });

  // sdd/online-payment-integration PR 1: mismo criterio que
  // GOOGLE_TOKEN_ENCRYPTION_KEY -- clave AES-256-GCM propia (cifra
  // PaymentAccount.credentialEncrypted, PR 2), requerida siempre en
  // producción sin importar si ya hay una cuenta Flow conectada.
  it('permite un PAYMENT_CREDENTIALS_ENCRYPTION_KEY válido en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: validPaymentKey,
    };

    expect(validateEnv(config)).toBe(config);
  });

  it('rechaza un PAYMENT_CREDENTIALS_ENCRYPTION_KEY que no decodifica a 32 bytes en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(16, 13).toString(
        'base64',
      ),
    };

    expect(() => validateEnv(config)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza el valor de ejemplo de README.md para PAYMENT_CREDENTIALS_ENCRYPTION_KEY en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
      PAYMENT_CREDENTIALS_ENCRYPTION_KEY: readmeExamplePaymentKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('rechaza PAYMENT_CREDENTIALS_ENCRYPTION_KEY ausente en producción', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(32),
      DOCUMENT_ENCRYPTION_KEY: validDocumentKey,
      GOOGLE_TOKEN_ENCRYPTION_KEY: validGoogleTokenKey,
    };

    expect(() => validateEnv(config)).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY inválida/,
    );
  });

  it('no valida PAYMENT_CREDENTIALS_ENCRYPTION_KEY fuera de producción', () => {
    const config = { NODE_ENV: 'test' };

    expect(validateEnv(config)).toBe(config);
  });
});
